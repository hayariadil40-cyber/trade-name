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

function formatPrezziCorrenti(coinData: Record<string, any> | null): string {
  if (!coinData || typeof coinData !== "object") return "";
  const wanted = ["XAUUSD", "US30", "NAS100", "GER30", "BTCUSD", "EURUSD"];
  const rows: string[] = [];
  for (const k of wanted) {
    const d = coinData[k];
    if (!d) continue;
    const low = d.low ?? "?";
    const high = d.high ?? "?";
    const close = d.close ?? d.open ?? "?";
    const pct = d.percentuale ?? "";
    rows.push(`- ${k}: last ${close} | range ${low}-${high}${pct ? ` (${pct}%)` : ""}`);
  }
  return rows.length ? rows.join("\n") : "";
}

// Aggrega low/high di tutte le sessioni del giorno per asset, in fallback se cronache.coin_data e' vuoto.
function formatPrezziDaSessioni(sessioni: Array<{ coin_data: Record<string, any> | null }> | null): string {
  if (!sessioni || !sessioni.length) return "";
  const wanted = ["XAUUSD", "US30", "NAS100", "GER30", "BTCUSD", "EURUSD"];
  const agg = new Map<string, { low: number; high: number }>();
  for (const s of sessioni) {
    const cd = s.coin_data || {};
    for (const k of wanted) {
      const d = cd[k];
      if (!d) continue;
      const lo = parseFloat(d.low);
      const hi = parseFloat(d.high);
      if (!isFinite(lo) || !isFinite(hi)) continue;
      const cur = agg.get(k);
      if (!cur) agg.set(k, { low: lo, high: hi });
      else { cur.low = Math.min(cur.low, lo); cur.high = Math.max(cur.high, hi); }
    }
  }
  if (!agg.size) return "";
  return [...agg.entries()].map(([k, v]) => `- ${k}: range giornaliero ${v.low}-${v.high}`).join("\n");
}

async function getPrezziCorrenti(supabase: any, todayStr: string): Promise<string> {
  const { data: cron } = await supabase
    .from("cronache").select("coin_data").eq("data", todayStr).maybeSingle();
  const fromCron = formatPrezziCorrenti(cron?.coin_data ?? null);
  if (fromCron) return fromCron;
  const { data: sess } = await supabase
    .from("sessioni").select("coin_data").eq("data", todayStr);
  const fromSess = formatPrezziDaSessioni(sess ?? null);
  return fromSess || "(prezzi correnti non disponibili nel DB)";
}

async function generateRodrigoComment(ev: {
  titolo: string; valuta: string; valore_atteso: string | null;
  valore_precedente: string | null; valore_effettivo: string;
}, prezziCorrenti: string, apiKey: string): Promise<string> {
  const prompt = `Sei Rodrigo, analista macro per un trader scalper (XAU/USD, US30, NASDAQ, EURUSD, USDJPY).

L'evento "${ev.titolo}" (${ev.valuta}) e appena uscito.
Forecast: ${ev.valore_atteso || "n.d."}
Precedente: ${ev.valore_precedente || "n.d."}
ATTUALE: ${ev.valore_effettivo}

QUOTAZIONI CORRENTI DEL MERCATO (giornata di oggi, da EA MT4):
${prezziCorrenti}

REGOLA CRITICA: i livelli di prezzo che citi devono essere DENTRO o IMMEDIATAMENTE ADIACENTI alla finestra "range" riportata sopra. NON inventare livelli storici (es. XAU a 2300, EUR a 1.07): quei numeri sono OBSOLETI. Se non hai un livello plausibile, parla solo di direzione attesa (sopra/sotto, breakout/reversal) senza numeri.

Commento sintetico (max 4 righe, una per punto, niente liste markdown):
- Il dato e sopra/sotto/in linea con le attese (calcola lo scostamento se possibile)
- Cosa significa per USD, oro, indici US
- Direzione attesa di breve sui principali asset (usa i livelli correnti sopra, MAI numeri inventati)
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

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegram(text: string, botToken: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
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
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function impactEmoji(imp: string | null | undefined): string {
  if (imp === "alto") return "🔴";
  if (imp === "medio") return "🟠";
  if (imp === "basso") return "🟡";
  return "📊";
}

function buildTelegramText(row: {
  titolo: string; valuta: string; impatto?: string | null;
  valore_atteso: string | null; valore_precedente: string | null; valore_effettivo: string;
  commento_rodrigo: string;
}): string {
  const emoji = impactEmoji(row.impatto);
  return `${emoji} <b>${escapeHtml(row.titolo)}</b> (${escapeHtml(row.valuta)})
Effettivo: <b>${escapeHtml(row.valore_effettivo)}</b>
Atteso: ${escapeHtml(row.valore_atteso) || "n.d."}  ·  Precedente: ${escapeHtml(row.valore_precedente) || "n.d."}

${escapeHtml(row.commento_rodrigo)}

— Rodrigo`;
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

    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

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
      const todayStrA = new Date().toISOString().split("T")[0];
      const prezzi = await getPrezziCorrenti(supabase, todayStrA);
      const commento = await generateRodrigoComment({
        titolo: row.titolo, valuta: row.valuta,
        valore_atteso: row.valore_atteso, valore_precedente: row.valore_precedente,
        valore_effettivo: row.valore_effettivo,
      }, prezzi, ANTHROPIC_API_KEYS);
      const { error } = await supabase.from("allert")
        .update({ commento_rodrigo: commento || null }).eq("id", body.id);
      if (error) throw error;

      let telegram_sent = false;
      let telegram_error: string | undefined;
      if (commento && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const tg = await sendTelegram(buildTelegramText({
          titolo: row.titolo, valuta: row.valuta, impatto: row.impatto,
          valore_atteso: row.valore_atteso, valore_precedente: row.valore_precedente,
          valore_effettivo: row.valore_effettivo, commento_rodrigo: commento,
        }), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
        telegram_sent = tg.ok;
        if (!tg.ok) telegram_error = tg.error;
      }

      return new Response(JSON.stringify({ ok: true, id: body.id, commented: 1, telegram_sent, telegram_error }), {
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

    let updated = 0, commented = 0, no_actual_yet = 0, errors = 0, telegram_sent = 0;

    // Fetch prezzi correnti una volta sola per tutto il batch (cronaca odierna, fallback su sessioni).
    const prezziBatch = await getPrezziCorrenti(supabase, todayStr);

    for (const a of pending) {
      const ff = byFFId.get(a.ff_id);
      if (!ff || !ff.actual) { no_actual_yet++; continue; }

      let commento_rodrigo = "";
      try {
        commento_rodrigo = await generateRodrigoComment({
          titolo: a.titolo, valuta: a.valuta,
          valore_atteso: a.valore_atteso, valore_precedente: a.valore_precedente,
          valore_effettivo: ff.actual,
        }, prezziBatch, ANTHROPIC_API_KEYS);
        commented++;
      } catch {
        errors++;
      }

      const { error } = await supabase.from("allert").update({
        valore_effettivo: ff.actual,
        commento_rodrigo: commento_rodrigo || null,
      }).eq("id", a.id);
      if (error) { errors++; continue; }
      updated++;

      if (commento_rodrigo && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const tg = await sendTelegram(buildTelegramText({
          titolo: a.titolo, valuta: a.valuta, impatto: a.impatto,
          valore_atteso: a.valore_atteso, valore_precedente: a.valore_precedente,
          valore_effettivo: ff.actual, commento_rodrigo,
        }), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
        if (tg.ok) telegram_sent++;
      }
    }

    return new Response(JSON.stringify({
      ok: true, pending: pending.length, updated, commented, no_actual_yet, errors, telegram_sent,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
