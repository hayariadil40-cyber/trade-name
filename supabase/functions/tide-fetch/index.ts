// tide-fetch - Edge Function
// Schedule: pg_cron daily 05:00 UTC = 06:00 Casablanca
// Fetches today's low tides for Rabat from Stormglass.io (lat 34.02, lng -6.83)
// Picks the one OUTSIDE trading sessions (London 09:00-11:00 + NY 14:30-16:30 Casa) when possible
// Updates giornate.marea with HH:MM (Casablanca time) for today's row (creates row if missing)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Trading sessions in Casablanca local time (UTC+1)
// London 09:00-11:00, NY 14:30-16:30
function isInTradingSession(hh: number, mm: number): boolean {
  const minutes = hh * 60 + mm;
  const inLondon = minutes >= 9 * 60 && minutes <= 11 * 60;
  const inNY = minutes >= 14 * 60 + 30 && minutes <= 16 * 60 + 30;
  return inLondon || inNY;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const STORMGLASS_API_KEY = Deno.env.get("STORMGLASS_API_KEY");
    if (!STORMGLASS_API_KEY) {
      return new Response(JSON.stringify({ error: "STORMGLASS_API_KEY non configurata" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rabat, Morocco
    const lat = 34.02;
    const lng = -6.83;

    // "Today" in Casablanca (UTC+1 fisso, no DST)
    const nowUtc = new Date();
    const casaNow = new Date(nowUtc.getTime() + 60 * 60 * 1000);
    const today = casaNow.toISOString().split("T")[0]; // YYYY-MM-DD

    // Window: 36h forward from now to be sure to catch all low tides for "today" Casablanca
    const startUtc = nowUtc.toISOString();
    const endUtc = new Date(nowUtc.getTime() + 36 * 60 * 60 * 1000).toISOString();

    const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${startUtc}&end=${endUtc}`;
    const resp = await fetch(url, { headers: { "Authorization": STORMGLASS_API_KEY } });
    const sgData = await resp.json();

    if (!resp.ok || !sgData.data) {
      return new Response(JSON.stringify({ error: "Stormglass API error", status: resp.status, detail: sgData }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter low tides for today (Casablanca date), convert to Casa HH:MM
    const lowToday = (sgData.data as Array<{ time: string; height: number; type: string }>)
      .filter(t => t.type === "low")
      .map(t => {
        const utc = new Date(t.time);
        const casa = new Date(utc.getTime() + 60 * 60 * 1000);
        const date = casa.toISOString().split("T")[0];
        const hh = casa.getUTCHours();
        const mm = casa.getUTCMinutes();
        const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        return { date, time, hh, mm, height: t.height };
      })
      .filter(t => t.date === today);

    if (lowToday.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "Nessuna bassa marea oggi a Rabat", today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer low tide OUTSIDE trading sessions (London 09-11 + NY 14:30-16:30 Casa)
    const outside = lowToday.filter(t => !isInTradingSession(t.hh, t.mm));
    const chosen = outside.length > 0 ? outside[0] : lowToday[0];

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Update if row exists, else insert (trigger seeds the 3 sessioni rows automaticamente)
    const { data: existing } = await supabase.from("giornate").select("id").eq("data", today).maybeSingle();
    let action: string;
    if (existing) {
      const { error } = await supabase.from("giornate").update({ marea: chosen.time }).eq("data", today);
      if (error) throw new Error("update giornate: " + error.message);
      action = "updated";
    } else {
      const { error } = await supabase.from("giornate").insert({ data: today, marea: chosen.time, stato: "nuovo" });
      if (error) throw new Error("insert giornate: " + error.message);
      action = "inserted";
    }

    return new Response(JSON.stringify({
      ok: true,
      today,
      marea: chosen.time,
      chosen_outside_sessions: outside.length > 0,
      all_lows_today: lowToday.map(t => ({ time: t.time, height: t.height })),
      action,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
