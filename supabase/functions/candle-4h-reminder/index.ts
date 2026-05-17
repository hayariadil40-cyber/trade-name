// Candle 4H Reminder - Edge Function
// Invia messaggio Telegram da Rodrigo 5 minuti prima della chiusura candela 4H.
//
// pg_cron (UTC): `55 1,5,9,13,17 * * 1-5`
// = 02:55, 06:55, 10:55, 14:55, 18:55 Casablanca — solo lun-ven

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOSE_HOURS_CASA = [3, 7, 11, 15, 19];

function currentCasaHour(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Casablanca",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
}

async function sendTelegram(text: string, botToken: string, chatId: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text, disable_web_page_preview: true }),
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    if (CRON_SECRET) {
      const provided = req.headers.get("x-cron-secret");
      if (provided !== CRON_SECRET) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return new Response(JSON.stringify({ error: "secrets missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hourNow = currentCasaHour();
    const nextClose = CLOSE_HOURS_CASA.find((h) => h - 1 === hourNow);
    const closeTime = nextClose !== undefined
      ? String(nextClose).padStart(2, "0") + ":00"
      : "??:00";

    const message = `⏰ <b>Rodrigo</b>\nCandela 4H chiude alle <b>${closeTime}</b>. Dai un'occhiata al grafico.`;

    const tg = await sendTelegram(message, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    return new Response(JSON.stringify({ ok: true, close_time: closeTime, telegram: tg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
