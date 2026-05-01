// Ordine del giorno — Edge Function
// Schedule: pg_cron 0 6 * * * UTC = 07:00 Casablanca (UTC+1, no DST)
// Blocchi:
// 1) Macro eventi oggi (allert)
// 2) Ultimi 5 trade
// 3) Forza USD intraday (apertura giornata Casablanca → ora)
// 4) Letture del giorno (commento Claude/Rodrigo se gia disponibili)
// 5) Allert prezzo dall'apertura giornata Casablanca (commento Claude/Rodrigo)
// Output: UPSERT su giornate.ordine_del_giorno + Telegram

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

// 00:00 Casablanca (UTC+1) di "today" come ISO UTC.
// Esempio: today=2026-04-25 → 2026-04-24T23:00:00.000Z
function startOfDayCasablancaIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  // -1 ora per la differenza UTC+1 fisso
  return new Date(Date.UTC(y, m - 1, d, -1, 0, 0)).toISOString();
}

function hhmmCasablanca(iso: string): string {
  const fmt = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Africa/Casablanca",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return fmt.format(new Date(iso));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callClaude(prompt: string, apiKey: string, maxTokens = 400): Promise<string> {
  // Retry su 429 (rate limit org tpm). Backoff: 5s, 15s, 30s.
  const backoffMs = [5000, 15000, 30000];
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (response.status === 429 && attempt < backoffMs.length) {
      await sleep(backoffMs[attempt]);
      continue;
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.content?.[0]?.text || "";
  }
  throw new Error("rate limit dopo retry");
}

async function sendTelegram(text: string, botToken: string, chatId: string): Promise<{ ok: boolean; messageId?: number; error?: string }> {
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
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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

    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
    const ANTHROPIC_API_KEYS = Deno.env.get("ANTHROPIC_API_KEYS");
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID non configurati" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ANTHROPIC_API_KEYS) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEYS non configurata" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const today = todayCasablanca();
    const nowIso = new Date().toISOString();
    const startOfDayIso = startOfDayCasablancaIso(today);

    // ===== 1. Macro eventi oggi =====
    const { data: macroRaw } = await supabase
      .from("allert")
      .select("titolo, ora_evento, impatto, valuta, note")
      .eq("data_evento", today)
      .order("ora_evento", { ascending: true });
    const macro = macroRaw || [];

    // ===== 2. Ultimi 5 trade =====
    const { data: tradesRaw } = await supabase
      .from("trades")
      .select("asset, direzione, data, pnl, esito, rr_reale")
      .order("data", { ascending: false })
      .limit(5);
    const trades = tradesRaw || [];

    // ===== 2b. Sessione asiatica di oggi (range MT4) =====
    const { data: asiaTodayRaw } = await supabase
      .from("sessioni")
      .select("nome, data, mood, coin_data, auto_data")
      .eq("data", today)
      .ilike("nome", "asia%");
    const asiaToday = asiaTodayRaw || [];

    // Estrai range high/low/pips per coin (auto_data prevale su coin_data)
    function extractRanges(
      session: { coin_data?: Record<string, unknown>; auto_data?: Record<string, unknown> },
    ): Record<string, { high: number; low: number; range: number }> {
      const result: Record<string, { high: number; low: number; range: number }> = {};
      const sources = [session.auto_data, session.coin_data].filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && Object.keys(s).length > 0);
      for (const src of sources) {
        for (const [coin, raw] of Object.entries(src)) {
          if (result[coin]) continue;
          const d = raw as { high?: string | number; low?: string | number } | null;
          if (d && d.high != null && d.low != null) {
            const high = Number(d.high);
            const low = Number(d.low);
            if (!isNaN(high) && !isNaN(low) && high > low) {
              result[coin] = { high, low, range: high - low };
            }
          }
        }
      }
      return result;
    }

    // Aggrega range di tutte le righe asia di oggi
    const todayRanges: Record<string, { high: number; low: number; range: number }> = {};
    for (const sess of asiaToday) {
      const r = extractRanges(sess);
      for (const [coin, v] of Object.entries(r)) {
        if (!todayRanges[coin]) todayRanges[coin] = v;
      }
    }

    const asiaBlock: { count_today: number; ranges_today: Record<string, { high: number; low: number; range: number }> } = {
      count_today: asiaToday.length,
      ranges_today: todayRanges,
    };

    // ===== Checklist Reminder Rodrigo (statica) =====
    const reminderRodrigo = [
      "Compila il fajr",
      "Compila la marea",
      "Sistema i monitor in modalita analisi: Telegram + Claude Desktop / TradingView + Bull Clock / MT4 panoramica mercato",
      "Apri nuova giornata dalla dashboard",
      "Compila le cronache di ieri",
    ];

    // ===== 3. Forza USD intraday (dall'apertura giornata Casablanca a ora) =====
    const { data: usdSeriesRaw } = await supabase
      .from("forza_usd")
      .select("usd_strength, created_at")
      .gte("created_at", startOfDayIso)
      .order("created_at", { ascending: true });
    const usdSeries = usdSeriesRaw || [];

    let usdBlock: {
      apertura: number | null;
      attuale: number | null;
      max: number | null;
      min: number | null;
      max_ora: string | null;
      min_ora: string | null;
      delta_intraday: number | null;
      trend_intraday: string;
      descrizione: string;
    } = {
      apertura: null, attuale: null, max: null, min: null,
      max_ora: null, min_ora: null,
      delta_intraday: null, trend_intraday: "n/d",
      descrizione: "Nessun dato di forza USD disponibile per oggi.",
    };

    if (usdSeries.length >= 1) {
      const values = usdSeries.map((r) => Number(r.usd_strength));
      const apertura = values[0];
      const attuale = values[values.length - 1];
      const max = Math.max(...values);
      const min = Math.min(...values);
      const maxIdx = values.indexOf(max);
      const minIdx = values.indexOf(min);
      const delta = attuale - apertura;
      let trend = "laterale";
      if (delta > 0.005) trend = "in rafforzamento";
      else if (delta < -0.005) trend = "in indebolimento";

      const maxOra = hhmmCasablanca(usdSeries[maxIdx].created_at);
      const minOra = hhmmCasablanca(usdSeries[minIdx].created_at);

      let descr = `Apertura a ${apertura.toFixed(4)}, ora a ${attuale.toFixed(4)} (${trend}, delta ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}).`;
      if (max !== min) {
        descr += ` Range giornaliero: max ${max.toFixed(4)} alle ${maxOra}, min ${min.toFixed(4)} alle ${minOra}.`;
      }

      usdBlock = {
        apertura, attuale, max, min,
        max_ora: maxOra, min_ora: minOra,
        delta_intraday: delta,
        trend_intraday: trend,
        descrizione: descr,
      };
    }

    // ===== 4. Letture del giorno =====
    const { data: articoliRaw } = await supabase
      .from("articoli_daily")
      .select("titolo, sommario, fonte, tag_tema, rilevanza, created_at")
      .gte("created_at", startOfDayIso)
      .order("rilevanza", { ascending: false, nullsFirst: false })
      .limit(10);
    const articoli = articoliRaw || [];

    let lettureBlock: { count: number; commento: string } = {
      count: articoli.length,
      commento: "Letture non ancora disponibili a quest'ora.",
    };

    if (articoli.length > 0) {
      try {
        const articoliText = articoli.map((a, i) =>
          `${i + 1}. "${a.titolo}" (${a.fonte || "fonte n.d."})${a.sommario ? " — " + a.sommario : ""}`
        ).join("\n");
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk. Ecco le letture macro/finanziarie selezionate stamattina:

${articoliText}

Genera un commento generale (2-3 righe, italiano, asciutto, niente motivazione vuota, niente parolacce) sul filo conduttore della giornata che emerge da queste letture. NON riassumere ogni articolo. NON dare segnali operativi. Solo il tema dominante e cosa significa per il rischio sui mercati USD/oro/indici.`;
        lettureBlock.commento = (await callClaude(prompt, ANTHROPIC_API_KEYS, 350)).trim();
      } catch (e) {
        lettureBlock.commento = `Errore generazione commento letture: ${(e as Error).message}`;
      }
    }

    // ===== 5. Allert prezzo dall'apertura giornata Casablanca =====
    const { data: allertPrezzoRaw } = await supabase
      .from("allert_prezzo")
      .select("coin, prezzo, ora, descrizione, commento, stato, created_at")
      .gte("created_at", startOfDayIso)
      .order("created_at", { ascending: false })
      .limit(40);
    const allertPrezzo = allertPrezzoRaw || [];

    let allertPrezzoBlock: { count: number; commento: string } = {
      count: allertPrezzo.length,
      commento: "Nessun allert prezzo dall'apertura della giornata.",
    };

    if (allertPrezzo.length > 0) {
      // Spalma le 2 chiamate Claude per non saturare il limite tpm dell'org.
      await sleep(2000);
      try {
        const apText = allertPrezzo.map((a, i) =>
          `${i + 1}. ${a.coin || "?"} a ${a.prezzo || "?"} (${a.descrizione || "n.d."})${a.commento ? " — note: " + a.commento : ""}`
        ).join("\n");
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk. Ecco gli allert di prezzo registrati dall'apertura della giornata corrente (00:00 Casablanca a ora):

${apText}

Genera un commento generale (2-3 righe, italiano, asciutto, niente parolacce) su cosa stanno facendo i livelli toccati e a cosa serve fare attenzione oggi. NON dare segnali operativi. Concentrati su: livelli rotti vs respinti, asset piu attivi, rischio di volatilita su quei livelli.`;
        allertPrezzoBlock.commento = (await callClaude(prompt, ANTHROPIC_API_KEYS, 350)).trim();
      } catch (e) {
        allertPrezzoBlock.commento = `Errore generazione commento allert: ${(e as Error).message}`;
      }
    }

    // ===== Narrativa di apertura =====
    const narrativaParts: string[] = [`Giornata del ${today}.`];
    const isHigh = (i: string | null) => i === "High" || i === "high" || i === "alto" || i === "Alto";
    const macroHigh = macro.filter((m) => isHigh(m.impatto));
    if (macroHigh.length > 0) {
      const nUsd = macroHigh.filter((m) => m.valuta === "USD").length;
      const extra = nUsd > 0
        ? `, ${nUsd} su USD (riflesso atteso su XAUUSD inverso e indici USA).`
        : ".";
      narrativaParts.push(`In agenda ${macroHigh.length} eventi ad alto impatto${extra}`);
    } else {
      narrativaParts.push("Nessun evento macro ad alto impatto in calendario oggi.");
    }
    if (usdBlock.trend_intraday !== "n/d") {
      narrativaParts.push(`Dollaro ${usdBlock.trend_intraday} dall'apertura.`);
    }

    // Streak ultimi trade
    let streakWin = 0, streakLoss = 0;
    for (const t of trades) {
      if (t.esito === "win") {
        if (streakLoss > 0) break;
        streakWin++;
      } else if (t.esito === "loss") {
        if (streakWin > 0) break;
        streakLoss++;
      } else break;
    }
    if (streakLoss >= 3) {
      narrativaParts.push(`ATTENZIONE: ${streakLoss} loss consecutivi negli ultimi trade - valuta riduzione size e pausa.`);
    } else if (streakWin >= 3) {
      narrativaParts.push(`Momentum positivo (${streakWin} win consecutivi). Attenzione all'overconfidence.`);
    }
    const narrativaText = narrativaParts.join(" ");

    // ===== Costruisci JSON ordine_del_giorno =====
    const ordineDelGiorno = {
      generato_alle: nowIso,
      narrativa: narrativaText,
      macro_oggi: macro.map((m) => ({
        titolo: m.titolo,
        ora: m.ora_evento ? m.ora_evento.substring(0, 5) : "",
        impatto: m.impatto,
        valuta: m.valuta,
        note: m.note,
      })),
      ultimi_trade: trades.map((t) => ({
        asset: t.asset,
        direzione: t.direzione,
        pnl: t.pnl,
        esito: t.esito,
      })),
      sessione_asia: asiaBlock,
      usd_strength: usdBlock,
      letture: lettureBlock,
      allert_prezzo: allertPrezzoBlock,
      reminder: reminderRodrigo,
    };

    // ===== UPSERT su giornate =====
    const { data: existingRow } = await supabase
      .from("giornate").select("id").eq("data", today).maybeSingle();

    let recordId: string | null = null;
    if (existingRow) {
      const { error } = await supabase.from("giornate")
        .update({ ordine_del_giorno: ordineDelGiorno })
        .eq("id", existingRow.id);
      if (error) throw error;
      recordId = existingRow.id;
    } else {
      const { data: created, error } = await supabase.from("giornate")
        .insert({ data: today, stato: "nuovo", ordine_del_giorno: ordineDelGiorno })
        .select("id").single();
      if (error) throw error;
      recordId = created?.id || null;
    }

    // ===== Telegram =====
    const macroLines = macro.length > 0
      ? macro.map((m) => {
          const ora = m.ora_evento ? m.ora_evento.substring(0, 5) : "--:--";
          return `- ${ora} <b>${m.titolo}</b> [${m.impatto}/${m.valuta}]`;
        }).join("\n")
      : "<i>nessun evento</i>";

    const tradeNetPnl = trades.length > 0
      ? trades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0).toFixed(2)
      : "0.00";
    const tradeLines = trades.length > 0
      ? trades.map((t) => {
          const p = Number(t.pnl) >= 0 ? `+${t.pnl}` : `${t.pnl}`;
          return `- ${t.asset} ${t.direzione} <b>${p}</b> (${t.esito})`;
        }).join("\n")
      : "<i>nessun trade</i>";

    const asiaRangeLines = Object.keys(asiaBlock.ranges_today).length > 0
      ? Object.entries(asiaBlock.ranges_today).map(([coin, v]) =>
          `- <b>${coin}</b>: ${v.range.toFixed(2)} pts | L ${v.low.toFixed(2)} / H ${v.high.toFixed(2)}`
        ).join("\n")
      : "<i>nessun dato MT4</i>";

    const reminderLines = reminderRodrigo.map((r) => `▢ ${r}`).join("\n");

    const msg =
      `🌅 <b>Ordine del Giorno</b> - <i>${today}</i>\n\n` +
      `${narrativaText}\n\n` +
      `📊 <b>Macro Oggi</b>: ${macro.length} eventi\n` +
      `${macroLines}\n\n` +
      `🌏 <b>Sessione Asiatica</b>\n` +
      `${asiaRangeLines}\n\n` +
      `💵 <b>Forza USD</b> (intraday)\n` +
      `${usdBlock.descrizione}\n\n` +
      `📈 <b>Ultimi 5 trade</b>: net PnL <b>${tradeNetPnl}</b>\n` +
      `${tradeLines}\n\n` +
      `📰 <b>Letture del Giorno</b> (${lettureBlock.count})\n` +
      `${lettureBlock.commento}\n\n` +
      `🚨 <b>Allert Prezzo</b> (${allertPrezzoBlock.count} dall'apertura giornata)\n` +
      `${allertPrezzoBlock.commento}\n\n` +
      `🔔 <b>Promemoria Rodrigo</b>\n` +
      `${reminderLines}`;

    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    return new Response(JSON.stringify({
      ok: true,
      data: today,
      record_id: recordId,
      counts: {
        macro: macro.length,
        ultimi_trade: trades.length,
        usd_punti: usdSeries.length,
        letture: articoli.length,
        allert_prezzo: allertPrezzo.length,
        asia_today_rows: asiaToday.length,
        asia_coins: Object.keys(todayRanges).length,
      },
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
