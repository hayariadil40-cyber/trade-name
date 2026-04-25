// TradingView Alert Webhook - Edge Function
// Riceve i webhook degli alert TradingView Pro e li scrive nella tabella allert_prezzo.
// Endpoint pubblico (verify_jwt=false) protetto da TRADINGVIEW_WEBHOOK_SECRET.
//
// CONFIGURAZIONE LATO TRADINGVIEW (Alert -> Notifications -> Webhook URL):
//   URL:     https://fzxjbxeadiqwfpctiyom.supabase.co/functions/v1/tradingview-alert
//   Message: JSON come questo (mantieni il secret identico a env TRADINGVIEW_WEBHOOK_SECRET)
//
//   {
//     "secret": "TUO_SECRET_QUI",
//     "coin": "{{ticker}}",
//     "prezzo": "{{close}}",
//     "descrizione": "{{strategy.order.alert_message}}"
//   }
//
// In alternativa al campo "secret" nel body si puo passare:
//   - header X-Webhook-Secret: <secret>
//   - querystring ?secret=<secret>

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hhmmCasablanca(): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Africa/Casablanca",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

function parseBody(raw: string): Record<string, unknown> {
  // 1. Tenta JSON
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch { /* not JSON, fall through */ }

  // 2. Fallback plain-text (es: "EURUSD price 1.0850 broke EMA")
  // Estrae nelle 3 categorie: coin (primo token alfanumerico), prezzo (primo numero decimale), descrizione (resto)
  const tokens = raw.trim().split(/\s+/);
  const coinMatch = tokens.find((t) => /^[A-Z]{3,8}(USD|USDT|JPY|EUR|GBP)?$/i.test(t)) || tokens[0] || "";
  const priceMatch = (raw.match(/\d+(?:[.,]\d+)?/) || [""])[0];
  return {
    raw_text: raw,
    coin: coinMatch,
    prezzo: priceMatch,
    descrizione: raw.length > 200 ? raw.substring(0, 200) + "..." : raw,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const WEBHOOK_SECRET = Deno.env.get("TRADINGVIEW_WEBHOOK_SECRET");

    const rawBody = await req.text();
    const payload = parseBody(rawBody);

    // Verifica secret
    if (WEBHOOK_SECRET) {
      const fromBody = typeof payload.secret === "string" ? payload.secret : null;
      const fromHeader = req.headers.get("x-webhook-secret");
      const fromQuery = new URL(req.url).searchParams.get("secret");
      const provided = fromBody || fromHeader || fromQuery;
      if (provided !== WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Mapping campi (accetta sinonimi: ticker/symbol/asset, close/price)
    const coin = String(
      payload.coin ?? payload.ticker ?? payload.symbol ?? payload.asset ?? ""
    ).trim().toUpperCase();
    const prezzo = String(
      payload.prezzo ?? payload.price ?? payload.close ?? ""
    ).trim();
    const descrizione = String(
      payload.descrizione ?? payload.message ?? payload.alert_message ?? payload.condition ?? payload.note ?? ""
    ).trim().substring(0, 500);
    const ora = String(payload.ora ?? hhmmCasablanca());

    if (!coin && !prezzo) {
      return new Response(JSON.stringify({ error: "missing coin and prezzo (need at least one)", received: payload }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.from("allert_prezzo").insert({
      coin: coin || "?",
      prezzo: prezzo || "?",
      ora,
      descrizione: descrizione || "Alert TradingView",
      stato: "nuovo",
    }).select("id, coin, prezzo, created_at").single();

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, alert: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
