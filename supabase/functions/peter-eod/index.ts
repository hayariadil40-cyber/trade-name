// Peter EOD — Edge Function
// pg_cron: `15 16 * * 1-5` UTC = 17:15 Casablanca
// Digest disciplinare fine giornata: catena bias→ipotesi→trade, checklist, metriche, confronto baseline.

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

// Midnight Casablanca = UTC-1 (Africa/Casablanca è UTC+1)
function startOfDayCasablanca(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, -1, 0, 0)).toISOString();
}

function endOfDayCasablanca(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 22, 59, 59, 999)).toISOString();
}

function hhmmCasablanca(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

async function callClaude(system: string, user: string, apiKey: string, maxTokens = 1800): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "";
}

async function sendTelegram(text: string, botToken: string, chatId: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text, disable_web_page_preview: true }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description };
    return { ok: true, messageId: data.result?.message_id as number };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

const SYSTEM_PROMPT = `Sei Peter. Analista comportamentale del trading dell'utente. Italiano. Clinico, distaccato, obiettivo. Zero motivazione, zero coaching da palestra, zero parolacce.

Ragioni esclusivamente sui dati ricevuti. Se segnali un pattern, dichiara sempre la dimensione del campione (es. "n=4, campione debole" / "n=18, segnale robusto"). Non presumere mai correlazioni senza evidenza numerica.

CONTESTO: EOD, 17:15 Casablanca. Ricevi in JSON tutti i dati della giornata operativa appena chiusa.

---

CATENA OPERATIVA — leggi sempre in questo ordine: BIAS → IPOTESI → TRADE

BIAS: lettura direzionale scritta prima di operare.
- "commenti_giornata": array cronologico {ora, testo} — note generali della giornata senza direzione.
- "coin_data.<ASSET>.aggiornamenti": array {ora, testo, direzione?} — timeline per-asset. La direzione CORRENTE è l'ultima "direzione" non-null (long/short/neutro).
- Un flip long→short è un evento cognitivo: analizzalo nel contesto temporale (prima/dopo un trade? prima/dopo una notizia macro?).

IPOTESI: piano pre-trade formulato prima di entrare.
- "stato": ipotesi / eseguita / invalidata / scaduta
- "note": razionale del setup scritto prima di entrare
- "check_list_flagged": voci della checklist ingresso spuntate pre-entrata
- "strategia_nome": playbook di riferimento
- "trade_collegato": true se almeno un trade ha questo ipotesi_id

TRADE: esecuzione.
- "note": commento del trader — cerca giustificazioni retroattive, FOMO, revenge, forcing
- "mood": stato emotivo al momento
- "rr_reale" vs "rr_teorico": scarto dal piano teorico
- "ha_ipotesi": true se collegato a un'ipotesi pre-formulata

ASIAN BOX (sessioni_oggi):
- sessioni_oggi.asia.coin_data.<ASSET>.low e .high = range di riferimento della giornata
- Negli aggiornamenti di london/newyork, "direzione" = "sopra"/"dentro"/"sotto" indica dove il prezzo era rispetto al box asiatico durante la sessione

---

ANELLI ROTTI — conta e segnala SOLO questi tre:
1. Trade con ha_ipotesi=false → esecuzione impulsiva senza piano
2. Ipotesi con stato="ipotesi" ancora a EOD → piano formulato e poi abbandonato senza aggiornamento
3. Bias e trade sullo stesso asset con direzioni opposte senza flip documentato in coin_data

NON è un anello rotto:
- Ipotesi stato="invalidata" o "scaduta" → gestione normale
- Ipotesi formulata ma non eseguita con stato aggiornato → prudenza, non errore

---

CHECKLIST DISCIPLINA:
- "checklist_score": X/Y voci completate stamattina
- "checklist_mancanti": voci specifiche saltate — citale per nome, non solo il numero

---

OUTPUT — struttura fissa, 8-14 righe totali, HTML Telegram (<b>, <i>), niente markdown asterischi:

1. <b>Catena</b>: "X/Y anelli completi" + descrizione di quelli rotti se esistono. 1-2 righe.
2. <b>Disciplina</b>: checklist score + voci mancanti rilevanti. 1 riga.
3. <b>Sessione</b>: n trade, WR%, PnL netto. Poi analisi note trade: cita testualmente (max 10 parole per trade) le parti che rivelano giustificazioni o bias cognitivi. Se le note mancano, segnalalo esplicitamente. 2-3 righe.
4. <b>Baseline</b>: confronto WR e PnL medio vs 30gg. Solo se n_oggi ≥ 3 e baseline_n ≥ 10. 1 riga. Ometti se condizioni non soddisfatte.
5. <b>Compilazione</b>: screenshot/note/strategia mancanti. 1 riga. Ometti completamente se tutto compilato.
6. <b>Voto</b>: X/10 su disciplina e processo (NON sul PnL) + 1 motivazione tecnica concisa. 1 riga.
7. <b>Domani</b>: 1 regola operativa concreta derivata da oggi. Neutra, non motivazionale. 1 riga.

Eccezioni:
- n_trade = 0: 3-4 righe. Riconosci l'assenza (day off dichiarato? no setup validi? rispetto piano?). Non servono tutte le sezioni.
- baseline_n < 10: ometti sezione Baseline, aggiungi "(campione ancora piccolo)" nel Voto.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
    const ANTHROPIC_API_KEYS = Deno.env.get("ANTHROPIC_API_KEYS")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const today = todayCasablanca();
    const startToday = startOfDayCasablanca(today);
    const endToday = endOfDayCasablanca(today);
    const start30 = new Date(Date.now() - 30 * 86400000).toISOString();

    // ── 1. Trade di oggi ──────────────────────────────────────────────────────
    const { data: tradesRaw } = await supabase
      .from("trades")
      .select("id, asset, direzione, esito, pnl, rr_reale, rr_teorico, note, mood, screenshot_url, strategia_id, ipotesi_id, data")
      .gte("data", startToday).lte("data", endToday)
      .order("data", { ascending: true });
    const trades = tradesRaw || [];

    // ── 2. Ipotesi di oggi ────────────────────────────────────────────────────
    const { data: ipotesiRaw } = await supabase
      .from("ipotesi_trading")
      .select("id, asset, direzione, sessione, stato, note, check_list_flagged, strategia_id, strategia:strategie(nome)")
      .gte("created_at", startToday).lte("created_at", endToday)
      .order("created_at", { ascending: true });
    const ipotesi = (ipotesiRaw || []) as any[];
    const ipotesiIdsLinkedToTrade = new Set(trades.map((t: any) => t.ipotesi_id).filter(Boolean));

    // ── 3. Bias di oggi (aggiornamenti completi) ──────────────────────────────
    const { data: biasRaw } = await supabase
      .from("bias")
      .select("commenti_giornata, coin_data, stato, data")
      .eq("data", today);
    const bias = biasRaw || [];

    // ── 4. Giornata + checklist decodificata ──────────────────────────────────
    const { data: checklistSetting } = await supabase
      .from("user_settings").select("valore").eq("chiave", "td_checklist").maybeSingle();
    const checklistVoci: string[] = (checklistSetting?.valore as string[]) || [];

    const { data: giornata } = await supabase
      .from("giornate")
      .select("mindset, volatilita, checklist_stato, note, day_tags, note_domani")
      .eq("data", today).maybeSingle();

    let checklistScore: string | null = null;
    let checklistMancanti: string[] = [];
    if (giornata?.checklist_stato && checklistVoci.length) {
      const stati = giornata.checklist_stato as boolean[];
      checklistScore = `${stati.filter(Boolean).length}/${stati.length}`;
      checklistMancanti = stati
        .map((v, i) => v ? null : (checklistVoci[i] || `item_${i}`))
        .filter(Boolean) as string[];
    }

    // ── 5. Sessioni di oggi (strip screenshot) ────────────────────────────────
    const { data: sessioniRaw } = await supabase
      .from("sessioni")
      .select("nome, mood, note, coin_data")
      .eq("data", today);
    const sessioni = (sessioniRaw || []).map((s: any) => ({
      nome: s.nome,
      mood: s.mood,
      note: s.note,
      coin_data: Object.fromEntries(
        Object.entries(s.coin_data || {}).map(([coin, d]: [string, any]) => {
          const { screenshot, ...rest } = d || {};
          return [coin, rest];
        })
      ),
    }));

    // ── 6. Baseline 30gg (solo aggregati) ────────────────────────────────────
    const { data: trades30Raw } = await supabase
      .from("trades").select("esito, pnl")
      .gte("data", start30).lt("data", startToday);
    const trades30 = trades30Raw || [];
    const dec30 = trades30.filter((t: any) => t.esito === "win" || t.esito === "loss");
    const wins30 = dec30.filter((t: any) => t.esito === "win").length;
    const pnl30sum = trades30.reduce((s: number, t: any) => s + (Number(t.pnl) || 0), 0);

    // ── Metriche oggi ─────────────────────────────────────────────────────────
    const completed = trades.filter((t: any) => t.esito === "win" || t.esito === "loss");
    const wins = completed.filter((t: any) => t.esito === "win").length;
    const netPnl = trades.reduce((s: number, t: any) => s + (Number(t.pnl) || 0), 0);

    const payload = {
      data: today,
      metriche: {
        n_trade: trades.length,
        wins,
        losses: completed.length - wins,
        winrate_pct: completed.length > 0 ? Math.round((wins / completed.length) * 1000) / 10 : null,
        net_pnl: Math.round(netPnl * 100) / 100,
        senza_screenshot: trades.filter((t: any) => !t.screenshot_url).length,
        senza_note: trades.filter((t: any) => !t.note?.trim()).length,
        senza_ipotesi: trades.filter((t: any) => !t.ipotesi_id).length,
        senza_strategia: trades.filter((t: any) => !t.strategia_id).length,
      },
      giornata: giornata ? {
        mindset: giornata.mindset,
        volatilita: giornata.volatilita,
        checklist_score: checklistScore,
        checklist_mancanti: checklistMancanti,
        note: giornata.note || null,
        day_tags: giornata.day_tags || [],
        note_domani_scritte: !!(giornata.note_domani),
      } : null,
      bias_oggi: bias.map((b: any) => ({
        assets: Object.keys(b.coin_data || {}),
        commenti_giornata: b.commenti_giornata || [],
      })),
      sessioni_oggi: sessioni,
      ipotesi_oggi: ipotesi.map((ip: any) => ({
        asset: ip.asset,
        direzione: ip.direzione,
        sessione: ip.sessione,
        stato: ip.stato,
        strategia_nome: (ip.strategia as any)?.nome || null,
        note: ip.note || null,
        check_list_flagged: ip.check_list_flagged || [],
        trade_collegato: ipotesiIdsLinkedToTrade.has(ip.id),
      })),
      trade_oggi: trades.map((t: any) => ({
        asset: t.asset,
        direzione: t.direzione,
        ora: hhmmCasablanca(t.data),
        esito: t.esito,
        pnl: t.pnl,
        rr_reale: t.rr_reale,
        rr_teorico: t.rr_teorico,
        note: t.note || null,
        mood: t.mood || null,
        ha_screenshot: !!t.screenshot_url,
        ha_ipotesi: !!t.ipotesi_id,
        ha_strategia: !!t.strategia_id,
      })),
      baseline_30gg: {
        n_trade: trades30.length,
        winrate_pct: dec30.length > 0 ? Math.round((wins30 / dec30.length) * 1000) / 10 : null,
        pnl_medio_per_trade: trades30.length > 0 ? Math.round((pnl30sum / trades30.length) * 100) / 100 : null,
      },
    };

    const text = await callClaude(
      SYSTEM_PROMPT,
      `Dati EOD in JSON:\n${JSON.stringify(payload)}`,
      ANTHROPIC_API_KEYS,
      1800,
    );

    const msg = `🌙 <b>Peter - EOD ${today}</b>\n\n${text}`;
    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    await supabase.from("assistant_messages").insert({
      assistente: "peter", ruolo: "assistant", sorgente: "routine", slot: "peter-eod",
      contenuto: text,
      metadata: {
        data: today,
        n_oggi: trades.length,
        wr_oggi: payload.metriche.winrate_pct,
        pnl_oggi: payload.metriche.net_pnl,
        telegram_message_id: (tg as any).messageId,
      },
    });

    await supabase.from("routine_events").insert({
      slot: "peter-eod", tipo: "ai-debrief", assistente: "peter",
      payload: {
        n_oggi: trades.length,
        wr_oggi: payload.metriche.winrate_pct,
        pnl_oggi: payload.metriche.net_pnl,
        n_30gg: trades30.length,
        output: text,
      },
      telegram_sent: !!(tg as any).ok,
      telegram_message_id: (tg as any).messageId ?? null,
    });

    return new Response(JSON.stringify({
      ok: true, data: today,
      metriche: payload.metriche,
      baseline: payload.baseline_30gg,
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
