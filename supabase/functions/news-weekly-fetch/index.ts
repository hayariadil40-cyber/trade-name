import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

const IMPACT_MAP: Record<string, string> = {
  High: "alto",
  Medium: "medio",
  Low: "basso",
  Holiday: "basso",
};

const CURRENCY_FILTER = new Set(["USD", "EUR"]);

function makeFFId(ev: { date: string; country: string; title: string }): string {
  return `${ev.date}|${ev.country}|${ev.title}`;
}

function parseFFDateToCasa(ffDate: string): { data_evento: string; ora_evento: string } {
  const d = new Date(ffDate);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Casablanca",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return {
    data_evento: `${get("year")}-${get("month")}-${get("day")}`,
    ora_evento: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

async function generateRodrigoAnalysis(ev: {
  title: string; country: string; data_evento: string; ora_evento: string;
  forecast: string | null; previous: string | null; impatto: string;
}, apiKey: string): Promise<string> {
  const prompt = `Sei Rodrigo, analista macro per un trader scalper specializzato in XAU/USD, US30, NASDAQ, EURUSD, USDJPY (sessioni Londra/New York).

Analisi sintetica dell'evento macro "${ev.title}" (${ev.country}) previsto per il ${ev.data_evento} alle ${ev.ora_evento.substring(0, 5)} (Africa/Casablanca).

Forecast: ${ev.forecast || "n.d."}
Precedente: ${ev.previous || "n.d."}
Impatto atteso: ${ev.impatto}

Struttura (max 5 righe totali, una per punto, niente liste markdown):
- Cos'è il dato in 1 riga concreta
- Influenza sui mercati (alta/media/bassa) e perche
- Scenario "sopra le attese": cosa succede a USD/oro/indici US
- Scenario "sotto le attese": cosa succede
- Asset piu reattivo

Italiano. Diretto. Niente motivazione vuota. Niente parolacce.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
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

    const ffRes = await fetch(FF_URL, { headers: { "User-Agent": "Mozilla/5.0 TradeDesk" } });
    if (!ffRes.ok) throw new Error(`ForexFactory fetch failed: ${ffRes.status}`);
    const events: Array<{
      title: string; country: string; date: string; impact: string;
      forecast: string; previous: string; actual: string;
    }> = await ffRes.json();

    let inserted = 0, skipped_low = 0, skipped_currency = 0, skipped_dup = 0, analyzed = 0, errors = 0;

    for (const ev of events) {
      const impatto = IMPACT_MAP[ev.impact] || "basso";
      if (impatto === "basso") { skipped_low++; continue; }
      if (!CURRENCY_FILTER.has(ev.country)) { skipped_currency++; continue; }

      const ffId = makeFFId(ev);
      const { data_evento, ora_evento } = parseFFDateToCasa(ev.date);

      const { data: existing } = await supabase
        .from("allert").select("id").eq("ff_id", ffId).maybeSingle();
      if (existing) { skipped_dup++; continue; }

      let note = "";
      try {
        note = await generateRodrigoAnalysis({
          title: ev.title, country: ev.country, data_evento, ora_evento,
          forecast: ev.forecast || null, previous: ev.previous || null, impatto,
        }, ANTHROPIC_API_KEYS);
        analyzed++;
      } catch {
        errors++;
      }

      const { error } = await supabase.from("allert").insert({
        ff_id: ffId,
        titolo: ev.title,
        valuta: ev.country,
        data_evento,
        ora_evento,
        impatto,
        valore_atteso: ev.forecast || null,
        valore_precedente: ev.previous || null,
        valore_effettivo: ev.actual || null,
        note: note || null,
        stato: "nuovo",
        tipo: "calendario",
      });
      if (error) { errors++; continue; }
      inserted++;
    }

    return new Response(JSON.stringify({
      ok: true, total_events: events.length, inserted,
      skipped_low, skipped_currency, skipped_dup, analyzed, errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
