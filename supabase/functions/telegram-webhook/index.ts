// telegram-webhook - Edge Function (verify_jwt=false: la chiama Telegram)
// Registrata con setWebhook + secret_token. Riceve gli update del bot.
// Oggi gestisce SOLO callback_query dei bottoni inline:
//   fajr:si:YYYY-MM-DD / fajr:no:YYYY-MM-DD  -> giornate.fajr = true/false,
//   toglie i bottoni dal messaggio, manda il feedback di Rodrigo, logga routine_events.
// Sicurezza: header X-Telegram-Bot-Api-Secret-Token == TELEGRAM_WEBHOOK_SECRET (se impostato)
//            + chat.id deve essere TELEGRAM_CHAT_ID.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function tg(method: string, body: Record<string, unknown>, token: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function feedbackRodrigo(apiKey: string, fatto: boolean, oggi: string): Promise<string> {
  const richiesta = fatto
    ? `Il trader ha confermato di aver pregato il Fajr oggi (${oggi}). Scrivi un messaggio motivazionale breve (max 4 righe) attinente SOLO al Fajr: il valore di essersi alzato prima dell'alba, la luce che porta nella giornata, la costanza. Niente riferimenti al trading o ai mercati. Tono caldo ma sobrio, zero emoji. Firma "— Rodrigo".`
    : `Il trader ha ammesso di NON aver pregato il Fajr oggi (${oggi}). L'ho segnato come non eseguito. Scrivi un rimprovero breve (max 5 righe) attinente SOLO al Fajr: il peso reale di quello che ha saltato. Niente riferimenti al trading o ai mercati. Niente "sei forte", niente "domani puoi farcela". Firma "— Rodrigo".`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 220,
        system: `Sei Rodrigo, assistente personale di un trader musulmano. Parli del Fajr e solo del Fajr. Diretto, sincero, mai volgare, mai retorico. Niente markdown, niente grassetti. Scrivi in italiano.`,
        messages: [{ role: "user", content: richiesta }],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.content?.[0]?.text ?? "";
  } catch (e) {
    console.error("feedbackRodrigo error:", e);
    return fatto ? "Fajr fatto. Segnato. — Rodrigo" : "Fajr non fatto. Segnato. — Rodrigo";
  }
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEYS")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

  if (WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let update: any;
  try { update = await req.json(); } catch { return new Response("ok"); }

  const cq = update?.callback_query;
  // Rispondo sempre 200 a Telegram, altrimenti ritenta all'infinito
  if (!cq) return new Response("ok");

  const chatId = String(cq.message?.chat?.id ?? "");
  if (chatId !== String(TELEGRAM_CHAT_ID)) {
    console.warn("telegram-webhook: chat non autorizzata", chatId);
    return new Response("ok");
  }

  const m = String(cq.data ?? "").match(/^fajr:(si|no):(\d{4}-\d{2}-\d{2})$/);
  if (!m) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id }, TELEGRAM_BOT_TOKEN);
    return new Response("ok");
  }
  const fatto = m[1] === "si";
  const giorno = m[2];

  EdgeRuntime.waitUntil((async () => {
    try {
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: fatto ? "Segnato: Fajr fatto" : "Segnato: Fajr non fatto" }, TELEGRAM_BOT_TOKEN);

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: g } = await supabase.from("giornate").select("id").eq("data", giorno).maybeSingle();
      const { error: errW } = g
        ? await supabase.from("giornate").update({ fajr: fatto }).eq("id", g.id)
        : await supabase.from("giornate").insert({ data: giorno, fajr: fatto });
      if (errW) console.error("telegram-webhook giornate write:", errW);

      // Tolgo i bottoni e fisso la risposta nel messaggio originale
      const testoOrig: string = cq.message?.text ?? "Fajr";
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: cq.message.message_id,
        text: `${testoOrig}\n→ ${fatto ? "✅ Sì" : "❌ No"}`,
      }, TELEGRAM_BOT_TOKEN);

      const feedback = await feedbackRodrigo(ANTHROPIC_API_KEY, fatto, giorno);
      const r = await tg("sendMessage", { chat_id: chatId, text: feedback, disable_web_page_preview: true }, TELEGRAM_BOT_TOKEN);

      await supabase.from("routine_events").insert({
        slot: "fajr-answer", tipo: "fajr", assistente: "rodrigo",
        payload: { risposta: fatto ? "si" : "no", data_giornata: giorno, testo: feedback, db_ok: !errW },
        telegram_sent: !!r.ok, telegram_message_id: r.result?.message_id ?? null,
      });
      await supabase.from("assistant_messages").insert({ assistente: "rodrigo", ruolo: "assistant", sorgente: "telegram-webhook", slot: "fajr-answer", contenuto: feedback, metadata: { data_giornata: giorno, risposta: fatto ? "si" : "no" } }).then(({ error }) => { if (error) console.warn("assistant_messages:", error.message); });
    } catch (e) {
      console.error("telegram-webhook error:", e);
    }
  })());

  return new Response("ok");
});
