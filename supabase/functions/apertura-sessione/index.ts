// Apertura Sessione - Edge Function
// Schedule:
//   pg_cron `0 7 * * *` UTC   body: { sessione: "londra" }
//   pg_cron `30 13 * * *` UTC  body: { sessione: "ny" }
// Blocchi:
//   1. bias da attenzionare (Claude)
//   2. forza USD intraday
//   3. allert prezzo non lavorati (lista cruda manuali) — sempre nel JSON
//   3b. allert EA — sintesi narrativa Claude (SOLO NY: a 14:30 abbiamo flusso Asia+London;
//       per London troppo poco materiale, lì resta la lista cruda)
//   4. promemoria Rodrigo
// Output: UPSERT sessioni.apertura_brief + Telegram

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// IMPORTANTE: nomeDb deve allinearsi allo schema canonico ('asia','london','newyork')
// usato dall'EA MT4 e dal resto del codice (sessioni.html, ordine-del-giorno, chat-ai).
const SESSIONE_INFO: Record<string, { label: string; emoji: string; nomeDb: string }> = {
  londra: { label: "Londra", emoji: "🇬🇧", nomeDb: "london" },
  ny:     { label: "New York", emoji: "🇺🇸", nomeDb: "newyork" },
};


async function callClaude(prompt: string, apiKey: string, maxTokens = 500): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "";
}

// Riconosce gli allert prodotti dall'EA MT4 dal prefisso della descrizione (% / FVG / EMA).
// Identica a isEaAllert() in index.html / allert.html / dettaglio_giornata.html.
function isEaAllert(a: { descrizione?: string | null }): boolean {
  const d = a?.descrizione || "";
  return /^(?:Superato|Si avvicina a)\s*[+-]?[0-9]+(?:\.[0-9]+)?%/.test(d)
    || /^FVG\s+(?:long|short)\s/i.test(d)
    || /^EMA\d+\s/i.test(d);
}

async function sendTelegram(text: string, botToken: string, chatId: string): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text, disable_web_page_preview: true }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || "telegram error" };
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    if (CRON_SECRET) {
      const provided = req.headers.get("x-cron-secret");
      if (provided !== CRON_SECRET) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
    const ANTHROPIC_API_KEYS = Deno.env.get("ANTHROPIC_API_KEYS");
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return new Response(JSON.stringify({ error: "telegram secrets missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!ANTHROPIC_API_KEYS) return new Response(JSON.stringify({ error: "anthropic key missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const sessione = (body.sessione || "londra").toLowerCase();
    if (!SESSIONE_INFO[sessione]) {
      return new Response(JSON.stringify({ error: `sessione non valida: ${sessione}. Valori: londra | ny` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const info = SESSIONE_INFO[sessione];

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const startOfDayIso = `${today}T00:00:00Z`;

    // ===== 1. Bias (bias) - SOLO della giornata di oggi, tutti gli stati =====
    // Un bias e una lettura di mercato dell'utente per la giornata: aperto/chiuso indica
    // se ha finito di aggiornarlo, ma per Rodrigo conta comunque.
    const { data: biasRaw } = await supabase
      .from("bias")
      .select("data, stato, commenti_giornata, coin_data, created_at")
      .eq("data", today)
      .order("created_at", { ascending: true });
    const bias = biasRaw || [];

    let biasBlock = { count: bias.length, commento: "Nessun bias registrato per oggi." };
    if (bias.length > 0) {
      try {
        const biasText = bias.map((b, i) => {
          const assets = Object.keys(b.coin_data || {}).filter(k => Object.keys(b.coin_data[k] || {}).length > 0);
          const lastAgg = Array.isArray(b.commenti_giornata) && b.commenti_giornata.length
            ? b.commenti_giornata[b.commenti_giornata.length - 1]?.testo || ""
            : "";
          const preview = lastAgg.length > 200 ? lastAgg.substring(0, 200) + "..." : lastAgg;
          return `${i + 1}. asset: ${assets.join(",") || "?"}${preview ? " - " + preview : ""}`;
        }).join("\n");
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk per uno scalper su XAU/USD, US30, NASDAQ, GER40.

Sta per aprire la sessione di ${info.label} (${today}).

I BIAS qui sotto sono OSSERVAZIONI e LETTURE DI MERCATO che l'utente stesso ha annotato per la giornata di oggi. NON sono task da eseguire, NON sono cose da fare: sono cio che lui percepisce del mercato in questo momento.

BIAS di oggi:
${biasText}

Restituisci una sintesi (2-4 punti, una riga per punto) che RISPECCHI la lettura dell'utente per la sessione di ${info.label}. Esempio di tono: "Vedi XAU long: la sessione di ${info.label} e il primo banco di prova per questa lettura" oppure "Hai annotato compressione su NAS in pre-NY: osserva come si scarica all'apertura".

Regole:
- NON dire "verifica se ancora valido", "monitorare X", "attenzionare Y" - non sono task.
- Riferisciti alla lettura come se fosse SUA, perche lo e.
- Asciutto, italiano, zero motivational speech, zero parolacce, niente segnali operativi.`;
        biasBlock.commento = (await callClaude(prompt, ANTHROPIC_API_KEYS, 450)).trim();
      } catch (e) { biasBlock.commento = `Errore commento bias: ${(e as Error).message}`; }
    }

    // ===== 2. Forza USD intraday =====
    const { data: usdSeriesRaw } = await supabase.from("forza_usd")
      .select("usd_strength, created_at")
      .gte("created_at", startOfDayIso)
      .order("created_at", { ascending: true });
    const usdSeries = usdSeriesRaw || [];

    let usdBlock = {
      apertura: null as number | null, attuale: null as number | null,
      max: null as number | null, min: null as number | null,
      max_ora: null as string | null, min_ora: null as string | null,
      trend_intraday: "n/d", descrizione: "Nessun dato di forza USD disponibile.",
    };
    if (usdSeries.length >= 1) {
      const values = usdSeries.map((r) => Number(r.usd_strength));
      const apertura = values[0]; const attuale = values[values.length - 1];
      const max = Math.max(...values); const min = Math.min(...values);
      const maxIdx = values.indexOf(max); const minIdx = values.indexOf(min);
      const delta = attuale - apertura;
      let trend = "laterale";
      if (delta > 0.005) trend = "in rafforzamento"; else if (delta < -0.005) trend = "in indebolimento";
      const maxOra = new Date(usdSeries[maxIdx].created_at).toISOString().slice(11, 16);
      const minOra = new Date(usdSeries[minIdx].created_at).toISOString().slice(11, 16);
      let descr = `Apertura giornata a ${apertura.toFixed(4)}, ora a ${attuale.toFixed(4)} (${trend}, delta ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}).`;
      if (max !== min) descr += ` Range giornaliero finora: max ${max.toFixed(4)} alle ${maxOra}, min ${min.toFixed(4)} alle ${minOra}.`;
      usdBlock = { apertura, attuale, max, min, max_ora: maxOra, min_ora: minOra, trend_intraday: trend, descrizione: descr };
    }

    // ===== 3. Allert prezzo NON lavorati (stato=nuovo) — lista cruda manuali, persistita in apertura_brief =====
    const { data: allertRaw } = await supabase
      .from("allert_prezzo")
      .select("coin, prezzo, descrizione, created_at")
      .eq("stato", "nuovo")
      .order("created_at", { ascending: false })
      .limit(20);
    const allertNuovi = allertRaw || [];

    // raggruppa per coin (per il JSON apertura_brief e per il fallback London)
    const byCoin: Record<string, Array<{ prezzo: string; ora: string; descrizione: string }>> = {};
    for (const a of allertNuovi) {
      const c = a.coin || "?";
      if (!byCoin[c]) byCoin[c] = [];
      byCoin[c].push({ prezzo: a.prezzo || "", ora: new Date(a.created_at).toISOString().slice(11, 16), descrizione: a.descrizione || "" });
    }
    const allertBlock = { count: allertNuovi.length, by_coin: byCoin };

    // ===== 3b. Allert EA — sintesi narrativa (SOLO per NY: alle 14:30 Casa abbiamo accumulato
    // tutto il flusso Asia+London e ha senso analizzare il pattern. Per London troppo poco materiale). =====
    let allertEaSintesi = "";
    if (sessione === "ny") {
      const { data: eaRaw } = await supabase
        .from("allert_prezzo")
        .select("coin, prezzo, descrizione, created_at")
        .gte("created_at", startOfDayIso)
        .order("created_at", { ascending: true })
        .limit(500);
      const eaToday = (eaRaw || []).filter(isEaAllert);

      if (eaToday.length > 0) {
        // Compatto in righe testuali per il prompt
        const eaLines = eaToday.map((a) => {
          const ora = new Date(a.created_at).toISOString().slice(11, 16);
          return `${ora} ${a.coin || "?"} @ ${a.prezzo || "?"} | ${a.descrizione || ""}`;
        }).join("\n");

        const prompt = `Sei un analista di flusso ordini. Riceverai la lista cronologica di ${eaToday.length} allert generati oggi (${today}, fino all'apertura NY) da un EA MT4 su 6 asset (XAUUSD, US30, GER30, NAS100, BTCUSD, EURUSD).

I 3 tipi di allert che vedi:
- "Superato +/-X.X% | Attuale: ..." = soglie percentuali daily superate.
- "FVG long M15 | gap ..." / "FVG short M15 | gap ..." = Fair Value Gap M15 (segnali di flusso).
- "EMA60 M15 touch | dist ..." = il prezzo ha toccato l'EMA60 a 15min.

Restituisci una sintesi tattica in italiano, asciutta, leggibile su Telegram. Vincoli STRICT:
- **1 bullet per asset attivo** (max 6 asset). Ogni bullet UNA SOLA RIGA, max ~200 caratteri.
- Formato per asset: "• <ASSET> — <momentum 1-2 parole>: <dato chiave da percentuali, es. da +0.5% a +2% in 3h>; FVG <X long Y short>; EMA60 touch <N>x. <Osservazione tattica 1 riga>."
- Momentum etichette: accelerazione / consolidamento / esaurimento / lateralità / reversal.
- Aggiungi MAX 1 bullet finale "⚠️ <divergenza cross-asset>" SOLO se ne vedi una rilevante.
- NIENTE preamboli, NIENTE motivational, NIENTE segnali operativi, NIENTE markdown bold/italic. Solo i bullet.

DATI:
${eaLines}`;

        try {
          const reply = await callClaude(prompt, ANTHROPIC_API_KEYS, 1000);
          allertEaSintesi = (reply || "").trim();
        } catch (e) {
          console.error("[apertura-ny] sintesi allert EA fallita:", (e as Error).message);
          allertEaSintesi = ""; // fallback: lista cruda usata sotto
        }
      }
    }

    // ===== 4. Promemoria Rodrigo (statico) =====
    const reminderRodrigo = [
      "Sii paziente, ricordati del winrate",
      "Inverti gli schermi: TradingView al centro, MT4 sui laterali",
      "Crea ipotesi per attuare la strategia",
    ];

    // ===== Costruisci JSON apertura_brief =====
    const aperturaBrief = {
      generato_alle: nowIso,
      sessione,
      bias: biasBlock,
      usd_strength: usdBlock,
      allert_prezzo_nuovi: allertBlock,
      allert_ea_sintesi: allertEaSintesi || null, // popolato solo per NY se Claude ok
      reminder: reminderRodrigo,
    };

    // ===== UPSERT su sessioni =====
    // Vincolo UNIQUE (data, nome) garantisce dedup a livello DB.
    // Match esatto su (data, nome): niente ilike+wildcard.
    // Logica: se la riga esiste aggiorno SOLO apertura_brief (preservando stato/coin_data/etc.);
    // se non esiste la creo con stato="nuovo".
    const { data: existingSession, error: selErr } = await supabase
      .from("sessioni")
      .select("id")
      .eq("data", today)
      .eq("nome", info.nomeDb)
      .maybeSingle();
    if (selErr) throw selErr;

    let sessioneId: string | null = null;
    if (existingSession) {
      const { error } = await supabase.from("sessioni")
        .update({ apertura_brief: aperturaBrief })
        .eq("id", existingSession.id);
      if (error) throw error;
      sessioneId = existingSession.id;
    } else {
      const { data: created, error } = await supabase.from("sessioni")
        .insert({ data: today, nome: info.nomeDb, stato: "nuovo", apertura_brief: aperturaBrief })
        .select("id").single();
      if (error) throw error;
      sessioneId = created?.id || null;
    }

    // ===== Telegram =====
    // Per NY: sintesi narrativa Claude sugli allert EA della giornata (sostituisce la lista cruda).
    // Per London o se la sintesi fallisce: fallback alla lista raggruppata per coin.
    let allertSezione = "";
    if (sessione === "ny" && allertEaSintesi) {
      allertSezione =
        `🚨 <b>Allert EA - sintesi flusso</b>\n${allertEaSintesi}`;
    } else {
      let allertLines = "<i>nessun allert non lavorato</i>";
      if (allertNuovi.length > 0) {
        allertLines = Object.entries(byCoin).map(([coin, entries]) => {
          const top3 = entries.slice(0, 3);
          const lines = top3.map((e, i) => `${i + 1}. <b>${e.ora}</b>: ${e.prezzo}`).join("\n");
          const extra = entries.length > 3 ? `\n   <i>(+${entries.length - 3} piu vecchi)</i>` : "";
          return `<b>${coin}</b>\n${lines}${extra}`;
        }).join("\n\n");
      }
      allertSezione = `🚨 <b>Allert Prezzo non lavorati</b> (${allertBlock.count})\n\n${allertLines}`;
    }

    const reminderLines = reminderRodrigo.map((r) => `▢ ${r}`).join("\n");

    const msg =
      `${info.emoji} <b>Apertura ${info.label}</b> - <i>${today}</i>\n\n` +
      `🧠 <b>Bias di oggi</b>\n${biasBlock.commento}\n\n` +
      `💵 <b>Forza USD</b> (intraday)\n${usdBlock.descrizione}\n\n` +
      `${allertSezione}\n\n` +
      `🔔 <b>Promemoria Rodrigo</b>\n${reminderLines}`;

    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    return new Response(JSON.stringify({
      ok: true, sessione, data: today, sessione_id: sessioneId,
      counts: {
        bias: bias.length, usd_punti: usdSeries.length,
        allert_nuovi: allertNuovi.length,
      },
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
