// fajr-reminder - Edge Function
// Chiamata dal frontend (dettaglio_giornata.html) quando fajr è null dopo le 05:40 UTC.
// Genera una ramanzina via Claude Haiku e la manda su Telegram.
// Il flag fajr=false viene già salvato dal frontend prima di chiamare questa function.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function nowUtc(): string {
  const now = new Date();
  const giorni = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${giorni[now.getUTCDay()]} ${hh}:${mm}`;
}

async function generateRamanzina(apiKey: string): Promise<string> {
  const ora = nowUtc();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 220,
      system: `Sei Rodrigo, assistente operativo di un trader. Tono: diretto, asciutto, senza fronzoli. Puoi essere duro ma mai volgare. Zero frasi motivazionali da palestra. Scrivi in italiano.`,
      messages: [{
        role: "user",
        content: `Sono le ${ora} UTC. Il trader non ha fatto il Fajr — l'ho segnato automaticamente come "non eseguito". Scrivi una ramanzina breve (max 5 righe) che faccia pesare il gesto. Niente "sei forte", niente "domani puoi farcela". Solo il peso reale di quello che ha saltato. Firma come — Rodrigo`,
      }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text ?? `🌙 Fajr non fatto. Segnato. — Rodrigo`;
}

async function sendTelegram(text: string, botToken: string, chatId: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const data = await res.json();
  return { ok: data.ok as boolean, messageId: data.result?.message_id as number | undefined };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEYS")!;
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  EdgeRuntime.waitUntil((async () => {
    try {
      const msg = await generateRamanzina(ANTHROPIC_API_KEY);
      const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from("routine_events").insert({
        slot: "fajr-reminder",
        tipo: "fajr",
        assistente: "rodrigo",
        payload: { testo: msg },
        telegram_sent: tg.ok,
        telegram_message_id: tg.messageId ?? null,
      });
    } catch (e) {
      console.error("fajr-reminder error:", e);
    }
  })());

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
