import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REMINDER_MIN_AHEAD = 4;   // notifica eventi tra 4 min
const REMINDER_MAX_AHEAD = 9;   // e 9 min da adesso (tolleranza per cron ogni 5 min)

const IMPACT_EMOJI: Record<string, string> = {
  alto: "🔴",
  medio: "🟡",
  basso: "⚪",
};

function nowInCasa(): { dateStr: string; hhmm: string; minutes: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Casablanca",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const dateStr = `${get("year")}-${get("month")}-${get("day")}`;
  const hh = parseInt(get("hour"), 10);
  const mm = parseInt(get("minute"), 10);
  return { dateStr, hhmm: `${get("hour")}:${get("minute")}`, minutes: hh * 60 + mm };
}

function timeToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(":").map((s) => parseInt(s, 10));
  return hh * 60 + mm;
}

async function sendTelegram(text: string, botToken: string, chatId: string): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        parse_mode: "HTML",
        text,
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || "telegram error" };
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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
      return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID non configurati" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { dateStr, minutes: nowMin } = nowInCasa();
    const minMin = nowMin + REMINDER_MIN_AHEAD;
    const maxMin = nowMin + REMINDER_MAX_AHEAD;

    // Eventi di oggi non ancora compilati e non ancora notificati
    const { data: rows } = await supabase
      .from("allert")
      .select("id, titolo, valuta, ora_evento, impatto, valore_atteso, valore_precedente")
      .eq("data_evento", dateStr)
      .is("valore_effettivo", null)
      .eq("reminder_sent", false);

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, due: 0, reason: "no events" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const due = rows.filter((r) => {
      if (!r.ora_evento) return false;
      const evMin = timeToMinutes(r.ora_evento.substring(0, 5));
      return evMin >= minMin && evMin <= maxMin;
    });

    if (due.length === 0) {
      return new Response(JSON.stringify({ ok: true, due: 0, candidates: rows.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0, errors = 0;
    for (const ev of due) {
      const ora = ev.ora_evento.substring(0, 5);
      const emoji = IMPACT_EMOJI[ev.impatto] || "⚪";
      const text =
`${emoji} <b>${ev.titolo}</b> (${ev.valuta}) tra 5 min — ore ${ora}

Forecast: <b>${ev.valore_atteso || "n.d."}</b>
Precedente: ${ev.valore_precedente || "n.d."}

Ricordati di compilare l'attuale dopo l'uscita.
— Rodrigo`;

      const tg = await sendTelegram(text, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
      if (tg.ok) {
        sent++;
        await supabase.from("allert").update({ reminder_sent: true }).eq("id", ev.id);
      } else {
        errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, due: due.length, sent, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
