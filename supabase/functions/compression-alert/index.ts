// compression-alert
// Gira ogni 15 min (a :03/:18/:33/:48) dopo compute_watchlist_volatility().
// Trova asset appena entrati in compressione → manda Telegram Rodrigo.
// Dedup: non manda se ha già mandato negli ultimi 45 minuti per lo stesso asset.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_TOKEN      = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_CHAT       = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "Markdown" }),
  });
}

Deno.serve(async () => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 45 * 60 * 1000).toISOString();

    // Trova asset compressi che non hanno ricevuto alert nelle ultime 45 min
    const { data: compressi } = await supabase
      .from("watchlist")
      .select("simbolo, high_15m, low_15m, volatilita_auto, volatilita_auto_prev, compression_alert_sent_at")
      .eq("active", true)
      .eq("volatilita_auto", "low")
      .or(`compression_alert_sent_at.is.null,compression_alert_sent_at.lt.${cutoff}`);

    if (!compressi || compressi.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const linee: string[] = [];


    for (const row of compressi) {
      const h = Number(row.high_15m) || 0;
      const l = Number(row.low_15m)  || 0;
      const range = h > 0 && l > 0 ? (h - l).toFixed(2) : "n.d.";
      linee.push(`• *${row.simbolo}* — range 15m: ${range} pip`);

      // Aggiorna timestamp e salva prev
      await supabase
        .from("watchlist")
        .update({
          compression_alert_sent_at: now.toISOString(),
          volatilita_auto_prev: row.volatilita_auto,
        })
        .eq("simbolo", row.simbolo);

      // Log in allert_prezzo per storico grafico
      await supabase
        .from("allert_prezzo")
        .insert({
          coin: row.simbolo,
          prezzo: String(h > 0 ? ((h + l) / 2).toFixed(2) : "0"),
          descrizione: `Compressione M15 | range ${range} pip`,
          stato: "nuovo",
        });
    }

    const msg =
      `📉 *COMPRESSIONE RILEVATA*\n` +
      `${linee.join("\n")}\n\n` +
      `Range stretto rispetto alle ultime 2 ore. Attenzione all'esplosione — aspetta la rottura, non anticipare.`;

    await sendTelegram(msg);

    return new Response(JSON.stringify({ sent: compressi.length }), { status: 200 });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
