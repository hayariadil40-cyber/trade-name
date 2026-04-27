// Nudge - Edge Function
// Schedule: pg_cron multipli, body { slot: "<slot-name>" }
// Slot disponibili: pre-london, london-open, london-30, london-stop,
//                   pre-ny, ny-open, ny-30, ny-stop, hard-stop
// Output: messaggio Telegram statico breve + INSERT su routine_events.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESSAGES: Record<string, { text: string; emoji: string }> = {
  "pre-london": {
    emoji: "⏳",
    text: "<b>PRE LONDRA</b> - 30 min\n\nHai creato la scheda sessione Londra? Bias scritto? Alert TV impostati?",
  },
  "london-open": {
    emoji: "\u{1F7E2}",
    text: "<b>LONDON OPEN</b>\n\nStop 11:00 - Max 3 trade\nStato emotivo OK prima di operare?",
  },
  "london-30": {
    emoji: "⏰",
    text: "30 min al <b>STOP LONDRA</b> (11:00). Se hai operato, compila trade (screenshot + strategia).",
  },
  "london-stop": {
    emoji: "\u{1F534}",
    text: "<b>STOP LONDRA</b>\n\nGestisci solo aperti. Nessun nuovo trade.\nCompila gli ultimi trade ora.",
  },
  "pre-ny": {
    emoji: "⏳",
    text: "<b>PRE NY</b> - 60 min\n\nScheda sessione NY creata? Bias NY? Monitor pre-NY completato? Alert TV?",
  },
  "ny-open": {
    emoji: "\u{1F7E2}",
    text: "<b>NY OPEN</b>\n\nStop 16:30 - Max 3 trade\nStato emotivo OK prima di operare?",
  },
  "ny-30": {
    emoji: "⏰",
    text: "30 min al <b>STOP NY</b> (16:30). Compila i trade gia fatti (screenshot + strategia).",
  },
  "ny-stop": {
    emoji: "\u{1F534}",
    text: "<b>STOP NY</b>\n\nGestisci solo aperti. Nessun nuovo trade.\nCompila gli ultimi trade ora.",
  },
  "hard-stop": {
    emoji: "\u{1F6D1}",
    text: "<b>HARD STOP 17:00</b>\n\nChiudi le carte. Nessuna occhiata al mercato.\n\n- Giornaliero completato?\n- Mindset registrato?\n- Note per domani scritte?\n- Venerdi: Weekly review!",
  },
};

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

    const body = await req.json().catch(() => ({}));
    const slot = String(body.slot || "").trim();
    if (!MESSAGES[slot]) {
      return new Response(JSON.stringify({ error: `slot non valido: '${slot}'. Disponibili: ${Object.keys(MESSAGES).join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const m = MESSAGES[slot];
    const fullText = `${m.emoji} ${m.text}`;
    const tg = await sendTelegram(fullText, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabase.from("routine_events").insert({
      slot, tipo: "nudge", assistente: null,
      payload: { text: m.text },
      telegram_sent: !!tg.ok, telegram_message_id: tg.messageId ?? null,
    });

    return new Response(JSON.stringify({ ok: true, slot, telegram: tg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
