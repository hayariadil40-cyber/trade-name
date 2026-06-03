// h4-bias-snap — scatta 10 min dopo ogni chiusura H4
// Calcola L/S/N per ogni asset e scrive in bias di oggi + h4_snaps.
//
// pg_cron (UTC): h4-bias-0210/0610/1010/1410/1810/2210
// = 02:10, 06:10, 10:10, 14:10, 18:10, 22:10 UTC

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Chiusure H4 in minuti da mezzanotte UTC
const H4_CLOSE_MINS = [120, 360, 600, 840, 1080, 1320]; // 02,06,10,14,18,22 UTC

function getUtcMinutes(): number {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function getUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Quale slot ha appena chiuso? (finestra 0-20 min dopo la chiusura)
function getJustClosedSlot(): number {
  const totalMin = getUtcMinutes();
  for (let i = 0; i < H4_CLOSE_MINS.length; i++) {
    const diff = totalMin - H4_CLOSE_MINS[i];
    if (diff >= 0 && diff <= 20) return i;
  }
  // 00:00-00:20: lo slot 5 (23:00) ha appena chiuso
  if (totalMin < 20) return 5;
  return -1;
}

function calcBias(
  h4Close: number,
  h4High: number,
  h4Low: number,
  prev: { is_inside: boolean; bias: string } | null
): { bias: string; is_inside: boolean } {
  // Breakout: confronto close vs range della candela appena chiusa (self-contained)
  if (h4Close > h4High) return { bias: "long",  is_inside: false };
  if (h4Close < h4Low)  return { bias: "short", is_inside: false };

  // Inside range: usa prevSnap solo per la regola "2 consecutive inside"
  if (prev?.is_inside) return { bias: "neutro", is_inside: true };
  return { bias: prev?.bias ?? "neutro", is_inside: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const slotIdx = getJustClosedSlot();
    if (slotIdx === -1) {
      return new Response(
        JSON.stringify({ ok: false, reason: "nessuno slot in chiusura ora" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const todayDate   = getUtcDate();
    const prevSlotIdx = (slotIdx - 1 + 6) % 6;

    const { data: watchlist } = await db
      .from("watchlist")
      .select("simbolo, prezzo, h4_high, h4_low")
      .eq("active", true);

    if (!watchlist?.length) {
      return new Response(
        JSON.stringify({ ok: false, reason: "watchlist vuota" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: biasRecord } = await db
      .from("bias")
      .select("id, coin_data")
      .eq("data", todayDate)
      .maybeSingle();

    const results: Record<string, string> = {};
    const coinData: Record<string, any> = biasRecord?.coin_data ?? {};

    for (const w of watchlist) {
      const { simbolo } = w;
      const price  = parseFloat(w.prezzo  ?? "0");
      const h4High = parseFloat(w.h4_high ?? "0");
      const h4Low  = parseFloat(w.h4_low  ?? "0");
      if (!price || !h4High || !h4Low) continue;

      // Snap precedente per questo asset
      const { data: prevSnap } = await db
        .from("h4_snaps")
        .select("h4_high, h4_low, bias, is_inside")
        .eq("simbolo", simbolo)
        .eq("slot_idx", prevSlotIdx)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { bias, is_inside } = calcBias(price, h4High, h4Low, prevSnap ? {
        is_inside: prevSnap.is_inside,
        bias:      prevSnap.bias,
      } : null);

      results[simbolo] = bias;

      await db.from("h4_snaps").insert({
        simbolo,
        slot_idx:        slotIdx,
        slot_close_time: new Date().toISOString(),
        h4_high:         h4High,
        h4_low:          h4Low,
        h4_close:        price,
        bias,
        is_inside,
      });

      // Aggiorna coinData sempre, sia per update che per insert
      if (!coinData[simbolo]) coinData[simbolo] = { aggiornamenti: [] };
      if (!Array.isArray(coinData[simbolo].bias_h4)) coinData[simbolo].bias_h4 = Array(6).fill(null);
      coinData[simbolo].bias_h4[slotIdx] = bias;
    }

    if (biasRecord) {
      await db.from("bias").update({ coin_data: coinData }).eq("id", biasRecord.id);
    } else {
      // Crea il record bias del giorno se non esiste ancora (es. snap 03:10 e 07:10 quando utente dorme)
      await db.from("bias").insert({ data: todayDate, stato: "aperto", coin_data: coinData });
    }

    return new Response(
      JSON.stringify({ ok: true, slot: slotIdx, date: todayDate, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
