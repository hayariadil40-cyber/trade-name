import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

function makeFFId(ev: { date: string; country: string; title: string }): string {
  return `${ev.date}|${ev.country}|${ev.title}`;
}

async function generateRodrigoComment(ev: {
  titolo: string; valuta: string; valore_atteso: string | null;
  valore_precedente: string | null; valore_effettivo: string;
}, apiKey: string): Promise<string> {
  const prompt = `Sei Rodrigo, analista macro per un trader scalper (XAU/USD, US30, NASDAQ, EURUSD, USDJPY).

L'evento "${ev.titolo}" (${ev.valuta}) e appena uscito.
Forecast: ${ev.valore_atteso || "n.d."}
Precedente: ${ev.valore_precedente || "n.d."}
ATTUALE: ${ev.valore_effettivo}

Commento sintetico (max 4 righe, una per punto, niente liste markdown):
- Il dato e sopra/sotto/in linea con le attese (calcola lo scostamento se possibile)
- Cosa significa per USD, oro, indici US
- Direzione attesa di breve sui principali asset
- Eventuale rischio di reversal o follow-through

Italiano. Diretto. Zero motivazione vuota. Zero parolacce.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "";
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

    const ANTHROPIC_API_KEYS = Deno.env.get("ANTHROPIC_API_KEYS");
    if (!ANTHROPIC_API_KEYS) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEYS non configurata" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Body opzionale: { id } per processare una singola riga gia con valore_effettivo (uso da DB trigger)
    let body: { id?: string } = {};
    try { body = await req.json(); } catch { /* body vuoto = scan generale */ }

    // === MODE A: chiamata da trigger DB su una riga specifica ===
    if (body.id) {
      const { data: row, error: readErr } = await supabase
        .from("allert").select("*").eq("id", body.id).maybeSingle();
      if (readErr || !row) {
        return new Response(JSON.stringify({ error: "row not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!row.valore_effettivo || row.commento_rodrigo) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const commento = await generateRodrigoComment({
        titolo: row.titolo, valuta: row.valuta,
        valore_atteso: row.valore_atteso, valore_precedente: row.valore_precedente,
        valore_effettivo: row.valore_effettivo,
      }, ANTHROPIC_API_KEYS);
      const { error } = await supabase.from("allert")
        .update({ commento_rodrigo: commento || null }).eq("id", body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, id: body.id, commented: 1 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE B: scan generale (per quando in futuro aggiungeremo scraping FF con actual) ===
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStr = today.toISOString().split("T")[0];
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

    const { data: pending } = await supabase
      .from("allert")
      .select("*")
      .is("valore_effettivo", null)
      .not("ff_id", "is", null)
      .gte("data_evento", sevenDaysAgoStr)
      .lte("data_evento", todayStr);

    if (!pending || !pending.length) {
      return new Response(JSON.stringify({ ok: true, pending: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ffRes = await fetch(FF_URL, { headers: { "User-Agent": "Mozilla/5.0 TradeDesk" } });
    if (!ffRes.ok) throw new Error(`ForexFactory fetch failed: ${ffRes.status}`);
    const events: Array<{
      title: string; country: string; date: string; actual: string;
    }> = await ffRes.json();

    const byFFId = new Map<string, typeof events[number]>();
    for (const e of events) byFFId.set(makeFFId(e), e);

    let updated = 0, commented = 0, no_actual_yet = 0, errors = 0;

    for (const a of pending) {
      const ff = byFFId.get(a.ff_id);
      if (!ff || !ff.actual) { no_actual_yet++; continue; }

      let commento_rodrigo = "";
      try {
        commento_rodrigo = await generateRodrigoComment({
          titolo: a.titolo, valuta: a.valuta,
          valore_atteso: a.valore_atteso, valore_precedente: a.valore_precedente,
          valore_effettivo: ff.actual,
        }, ANTHROPIC_API_KEYS);
        commented++;
      } catch {
        errors++;
      }

      const { error } = await supabase.from("allert").update({
        valore_effettivo: ff.actual,
        commento_rodrigo: commento_rodrigo || null,
      }).eq("id", a.id);
      if (error) errors++;
      else updated++;
    }

    return new Response(JSON.stringify({
      ok: true, pending: pending.length, updated, commented, no_actual_yet, errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
