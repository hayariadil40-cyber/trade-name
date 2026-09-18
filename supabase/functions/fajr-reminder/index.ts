// fajr-reminder - Edge Function
// Cron: 0 5 * * * (UTC = 06:00 Casablanca fisso) in modalita' "ask", 0 9 * * * in modalita' "fallback".
//
// ask:      se giornate.fajr e' NULL -> manda su Telegram la domanda "Hai pregato Fajr?" con bottoni Si/No.
//           L'orario del Fajr (AlAdhan, Casablanca) serve solo per il testo del messaggio.
//           Idempotente: una sola domanda al giorno (routine_events slot 'fajr-ask').
//           La risposta ai bottoni arriva alla function telegram-webhook che scrive giornate.fajr.
// fallback: se alle 09:00 UTC giornate.fajr e' ancora NULL -> segna false + nota secca su Telegram.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TZ = "Africa/Casablanca";

function dataCasablanca(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Orario Fajr (minuti dalla mezzanotte, ora locale Casablanca). Fallback 05:30 se l'API non risponde.
async function fajrMinuti(oggi: string): Promise<{ min: number; hhmm: string }> {
  try {
    const [y, m, d] = oggi.split("-");
    const res = await fetch(`https://api.aladhan.com/v1/timingsByCity/${d}-${m}-${y}?city=Casablanca&country=Morocco&method=21`);
    const j = await res.json();
    const t: string = j?.data?.timings?.Fajr ?? "";
    const mt = t.match(/^(\d{1,2}):(\d{2})/);
    if (mt) return { min: parseInt(mt[1]) * 60 + parseInt(mt[2]), hhmm: `${mt[1].padStart(2, "0")}:${mt[2]}` };
  } catch (e) {
    console.error("aladhan error:", e);
  }
  return { min: 5 * 60 + 30, hhmm: "05:30" };
}

async function tg(method: string, body: Record<string, unknown>, token: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let mode = "ask";
  try {
    const b = await req.json();
    if (b?.mode === "fallback") mode = "fallback";
  } catch { /* body vuoto */ }

  EdgeRuntime.waitUntil((async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const oggi = dataCasablanca();

      // Riga giornata: se manca la creo (seed_giornata_oggi gira alle 23 UTC solo dom-gio)
      const { data: g0 } = await supabase.from("giornate").select("id, fajr").eq("data", oggi).maybeSingle();
      let g = g0;
      if (!g) {
        const { data: ins, error: errIns } = await supabase.from("giornate").insert({ data: oggi }).select("id, fajr").single();
        if (errIns) { console.error("fajr-reminder insert giornata:", errIns); return; }
        g = ins;
      }

      if (g.fajr === true || g.fajr === false) {
        console.log(`fajr-reminder(${mode}): fajr=${g.fajr} per ${oggi}, skip`);
        return;
      }

      if (mode === "fallback") {
        await supabase.from("giornate").update({ fajr: false }).eq("data", oggi);
        const testo = `🌙 Fajr: nessuna risposta entro le 10:00. Segnato come non eseguito. Se non e' cosi', correggi dalla giornata.\n— Rodrigo`;
        const r = await tg("sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: testo }, TELEGRAM_BOT_TOKEN);
        await supabase.from("routine_events").insert({
          slot: "fajr-fallback", tipo: "fajr", assistente: "rodrigo",
          payload: { testo, data_giornata: oggi },
          telegram_sent: !!r.ok, telegram_message_id: r.result?.message_id ?? null,
        });
        return;
      }

      // mode ask: una sola domanda al giorno
      const { data: already } = await supabase
        .from("routine_events").select("id")
        .eq("slot", "fajr-ask").eq("payload->>data_giornata", oggi)
        .limit(1);
      if (already && already.length) { console.log("fajr-reminder: domanda gia' inviata oggi"); return; }

      const fajr = await fajrMinuti(oggi);

      const testo = `🌙 Fajr oggi alle ${fajr.hhmm}. Hai pregato?`;
      const r = await tg("sendMessage", {
        chat_id: TELEGRAM_CHAT_ID,
        text: testo,
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Sì", callback_data: `fajr:si:${oggi}` },
            { text: "❌ No", callback_data: `fajr:no:${oggi}` },
          ]],
        },
      }, TELEGRAM_BOT_TOKEN);

      await supabase.from("routine_events").insert({
        slot: "fajr-ask", tipo: "fajr", assistente: "rodrigo",
        payload: { testo, data_giornata: oggi, fajr_ora: fajr.hhmm },
        telegram_sent: !!r.ok, telegram_message_id: r.result?.message_id ?? null,
      });
      console.log(`fajr-reminder: domanda inviata per ${oggi} (fajr ${fajr.hhmm})`);
    } catch (e) {
      console.error("fajr-reminder error:", e);
    }
  })());

  return new Response(JSON.stringify({ ok: true, mode }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
