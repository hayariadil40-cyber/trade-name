// Peter EOD - Edge Function
// Schedule: pg_cron `15 16 * * *` UTC = 17:15 Casablanca
// Digest fine giornata Peter con metriche oggi + baseline 30gg per confronto.
// Output: messaggio Telegram firmato Peter + INSERT su routine_events e assistant_messages.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function todayCasablanca(): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Casablanca",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function startOfDayCasablancaIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, -1, 0, 0)).toISOString();
}

function endOfDayCasablancaIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  // Fine giornata Casablanca = 23:00 UTC dello stesso giorno
  return new Date(Date.UTC(y, m - 1, d, 22, 59, 59, 999)).toISOString();
}

async function callClaude(systemPrompt: string, userPrompt: string, apiKey: string, maxTokens = 1800): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "";
}

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

const SYSTEM_PROMPT = `Sei PETER, analista comportamentale del trading dell'utente. Scrivi in italiano.

IDENTITA: analitico, clinico, obiettivo. Zero toni motivazionali, zero coaching da palestra, zero parolacce.
Commenti i FATTI. Non presumere pattern. Se suggerisci una tendenza, cita il campione (n).

CONTESTO: chiusura giornata (17:15 Casablanca). Ti do i dati di oggi + baseline ultimi 30 giorni (escluso oggi) per confronto oggettivo.

OUTPUT:
- 8-14 righe. HTML Telegram: <b>, <i>. Max 1 emoji all'inizio se serve.
- Struttura:
  1) Riepilogo numerico giornata (n trade, WR, net PnL).
  2) Confronto con baseline 30gg (solo se n >= 10, altrimenti salta il confronto).
  3) Compilazione: screenshot/strategia mancanti. Segnalali.
  4) Coerenza con reperti/bias scritti oggi.
  5) 1 riga operativa finale (es. "prima di chiudere: completa giornaliero e note domani"). Neutra, non motivazionale.

Se nOggi = 0: riconoscilo e chiedi riflessione breve (senza giudizio).
Se baseline n < 10: nota che il confronto non e ancora statisticamente robusto.`;

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
    const ANTHROPIC_API_KEYS = Deno.env.get("ANTHROPIC_API_KEYS")!;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = todayCasablanca();
    const startToday = startOfDayCasablancaIso(today);
    const endToday = endOfDayCasablancaIso(today);

    const { data: tradesOggiRaw } = await supabase
      .from("trades")
      .select("asset, direzione, esito, pnl, pips, screenshot_url, strategia_id, data")
      .gte("data", startToday).lte("data", endToday)
      .order("data", { ascending: true });
    const tradesOggi = tradesOggiRaw || [];

    const { data: giornataRows } = await supabase
      .from("giornate").select("mindset, volatilita, note_domani, fajr, stato")
      .eq("data", today).limit(1);
    const giornata = giornataRows && giornataRows.length > 0 ? giornataRows[0] : null;

    const { data: repertiRaw } = await supabase
      .from("bias").select("asset, direzione, tipo").eq("data", today);
    const reperti = repertiRaw || [];

    // Baseline 30gg (escluso oggi) - dal -30 a startToday
    const inizio30gg = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: trades30Raw } = await supabase
      .from("trades").select("esito, pnl")
      .gte("data", inizio30gg).lt("data", startToday);
    const trades30 = trades30Raw || [];

    const nOggi = tradesOggi.length;
    const winsOggi = tradesOggi.filter((t) => t.esito === "win").length;
    const lossOggi = tradesOggi.filter((t) => t.esito === "loss").length;
    const decOggi = winsOggi + lossOggi;
    const wrOggi = decOggi > 0 ? Math.round((winsOggi / decOggi) * 1000) / 10 : null;
    const pnlOggi = nOggi > 0 ? Math.round(tradesOggi.reduce((s, t) => s + (Number(t.pnl) || 0), 0) * 100) / 100 : 0;
    const noScrOggi = tradesOggi.filter((t) => !t.screenshot_url).length;
    const noStratOggi = tradesOggi.filter((t) => !t.strategia_id).length;

    const n30 = trades30.length;
    const wins30 = trades30.filter((t) => t.esito === "win").length;
    const loss30 = trades30.filter((t) => t.esito === "loss").length;
    const dec30 = wins30 + loss30;
    const wr30 = dec30 > 0 ? Math.round((wins30 / dec30) * 1000) / 10 : null;
    const pnl30 = n30 > 0 ? Math.round(trades30.reduce((s, t) => s + (Number(t.pnl) || 0), 0) * 100) / 100 : 0;
    const avgPnl30 = n30 > 0 ? Math.round((pnl30 / n30) * 100) / 100 : 0;

    const payload = {
      data: today,
      oggi: {
        n_trade: nOggi, wins: winsOggi, losses: lossOggi, winrate_pct: wrOggi, net_pnl: pnlOggi,
        senza_screenshot: noScrOggi, senza_strategia: noStratOggi,
        mindset: giornata?.mindset ?? null,
        stato_giornata: giornata?.stato ?? "non_aperta",
        note_domani_scritte: !!(giornata?.note_domani),
        reperti_creati: reperti.length,
      },
      baseline_30gg: { n_trade: n30, winrate_pct: wr30, net_pnl: pnl30, pnl_medio_per_trade: avgPnl30 },
      trade_dettaglio_oggi: tradesOggi.map((t) => ({ asset: t.asset, direzione: t.direzione, esito: t.esito, pnl: t.pnl, pips: t.pips })),
    };

    const text = await callClaude(SYSTEM_PROMPT, `Dati in JSON:\n${JSON.stringify(payload)}`, ANTHROPIC_API_KEYS, 1800);

    const msg = `\u{1F319} <b>Peter - EOD ${today}</b>\n\n${text}`;
    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    await supabase.from("assistant_messages").insert({
      assistente: "peter", ruolo: "assistant", sorgente: "routine", slot: "peter-eod",
      contenuto: text, metadata: { data: today, n_oggi: nOggi, wr_oggi: wrOggi, pnl_oggi: pnlOggi, telegram_message_id: tg.messageId },
    });

    await supabase.from("routine_events").insert({
      slot: "peter-eod", tipo: "ai-debrief", assistente: "peter",
      payload: { n_oggi: nOggi, wr_oggi: wrOggi, pnl_oggi: pnlOggi, n_30gg: n30, wr_30gg: wr30, output: text },
      telegram_sent: !!tg.ok, telegram_message_id: tg.messageId ?? null,
    });

    return new Response(JSON.stringify({
      ok: true, data: today,
      oggi: { n: nOggi, wr: wrOggi, pnl: pnlOggi },
      baseline: { n: n30, wr: wr30, pnl: pnl30 },
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
