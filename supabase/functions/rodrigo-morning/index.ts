// Rodrigo Morning - Edge Function
// Schedule: pg_cron `35 6 * * *` UTC = 07:35 Casablanca
// Briefing operativo Rodrigo: stato giornata, reperti, allert macro, top articoli del giorno.
// Output: messaggio Telegram firmato Rodrigo + INSERT su routine_events e assistant_messages.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function todayCasablanca(): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Casablanca",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function startOfDayCasablancaIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, -1, 0, 0)).toISOString();
}

async function callClaude(systemPrompt: string, userPrompt: string, apiKey: string, maxTokens = 1200): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "";
}

async function sendTelegram(text: string, botToken: string, chatId: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text, disable_web_page_preview: true }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description };
    return { ok: true, messageId: data.result?.message_id as number };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

const SYSTEM_PROMPT = `Sei RODRIGO, assistente operativo giornaliero di un trader. Ti rivolgi all'utente in italiano.

IDENTITA:
- Compagno operativo pratico e sveglio. Mai lungo. Zero motivational speech, zero frasi fatte.
- Bacchetti con professionalita: "ti manca X", "hai Y aperto alle Z", "ricorda W prima delle H".
- Zero parolacce, zero termini volgari. Tono sempre rispettoso.

CONTESTO: sono le 07:35 Casablanca. La giornata di trading inizia a breve (apertura Londra alle 08:00).

OBIETTIVO DEL MESSAGGIO:
1. Saluto breve
2. Stato checklist / giornata (fajr, reperto creato, compilazione)
3. Segnale eventi macro rilevanti di oggi
4. Richiami operativi su cosa fare prima dell'apertura Londra

REGOLE OUTPUT:
- Massimo 8 righe.
- Usa HTML Telegram semplice: <b>bold</b>, <i>italic</i>. Niente markdown.
- Elenchi con trattini (-) brevi, max 1 riga ciascuno.
- Se mancano cose, segnalale chiaramente. Se tutto in ordine, di' "setup OK".
- Non firmare alla fine.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    if (CRON_SECRET) {
      const provided = req.headers.get("x-cron-secret");
      if (provided !== CRON_SECRET) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
    const ANTHROPIC_API_KEYS = Deno.env.get("ANTHROPIC_API_KEYS")!;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = todayCasablanca();
    const startOfDayIso = startOfDayCasablancaIso(today);

    const { data: giornataRows } = await supabase
      .from("giornate")
      .select("stato, mindset, note_domani, fajr, ordine_del_giorno, checklist_stato")
      .eq("data", today).limit(1);
    const giornata = giornataRows && giornataRows.length > 0 ? giornataRows[0] : null;

    const { data: repertiRaw } = await supabase
      .from("bias")
      .select("asset, direzione, tipo, created_at")
      .eq("data", today)
      .order("created_at", { ascending: false });
    const reperti = repertiRaw || [];

    const { data: allertRaw } = await supabase
      .from("allert")
      .select("titolo, ora_evento, impatto, valuta")
      .eq("data_evento", today)
      .in("impatto", ["alto", "high", "High", "Alto"])
      .order("ora_evento", { ascending: true });
    const allertOggi = allertRaw || [];

    const { data: articoliRaw } = await supabase
      .from("articoli_daily")
      .select("titolo, fonte, tag_tema, rilevanza")
      .gte("created_at", startOfDayIso)
      .order("rilevanza", { ascending: false, nullsFirst: false })
      .limit(5);
    const articoli = articoliRaw || [];

    const payload = {
      data_oggi: today,
      giornata_stato: giornata?.stato ?? "NON_APERTA",
      fajr: giornata?.fajr ?? null,
      note_domani_ieri: giornata?.note_domani ?? null,
      ordine_del_giorno_disponibile: !!(giornata?.ordine_del_giorno),
      reperti_oggi: reperti.map((r) => ({ asset: r.asset, direzione: r.direzione, tipo: r.tipo })),
      macro_high_impact_oggi: allertOggi.map((a) => ({ ora: a.ora_evento, titolo: a.titolo, valuta: a.valuta })),
      top_articoli: articoli.map((x) => ({ titolo: x.titolo, tema: x.tag_tema, rilevanza: x.rilevanza })),
    };

    const userPrompt = `Dati della giornata di oggi in JSON (usa questi, non inventare):\n${JSON.stringify(payload)}`;
    const text = await callClaude(SYSTEM_PROMPT, userPrompt, ANTHROPIC_API_KEYS, 1200);

    const msg = `\u{1F31E} <b>Buongiorno</b> - <i>Rodrigo</i>\n\n${text}`;
    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    await supabase.from("assistant_messages").insert({
      assistente: "rodrigo", ruolo: "assistant", sorgente: "routine", slot: "rodrigo-morning",
      contenuto: text, metadata: { data: today, telegram_message_id: tg.messageId },
    });

    await supabase.from("routine_events").insert({
      slot: "rodrigo-morning", tipo: "ai-nudge", assistente: "rodrigo",
      payload: { output: text, reperti: reperti.length, macro: allertOggi.length, articoli: articoli.length },
      telegram_sent: !!tg.ok, telegram_message_id: tg.messageId ?? null,
    });

    return new Response(JSON.stringify({ ok: true, data: today, telegram: tg, counts: { reperti: reperti.length, macro: allertOggi.length, articoli: articoli.length } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
