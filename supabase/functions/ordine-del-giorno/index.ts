// Ordine del giorno — Edge Function
// Schedule: pg_cron 30 6 * * 1-5 UTC (lun-ven)
// Blocchi:
// 1) Macro eventi oggi (allert)
// 2) Sessione asiatica: range + prezzo corrente + posizione (sopra/dentro/sotto) da watchlist
// 3) Forza USD intraday (apertura giornata Casablanca → ora)
// 4) Letture del giorno (commento Claude/Rodrigo se gia disponibili)
// 5) Allert prezzo dall'apertura giornata Casablanca (commento Claude/Rodrigo)
// 6) Promemoria operativi statici
// Output: UPSERT su giornate.ordine_del_giorno + Telegram

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


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

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const startOfDayIso = `${today}T00:00:00Z`;

    // ===== 1. Macro eventi oggi =====
    const { data: macroRaw } = await supabase
      .from("allert")
      .select("titolo, ora_evento, impatto, valuta, note")
      .eq("data_evento", today)
      .order("ora_evento", { ascending: true });
    const macro = macroRaw || [];

    // ===== 2. Sessione asiatica + posizione attuale (watchlist EA) =====
    const { data: watchlistRaw } = await supabase
      .from("watchlist")
      .select("simbolo, asian_high, asian_low, asian_data, prezzo, posizione, pct_change, updated_at")
      .eq("active", true)
      .eq("asian_data", today)
      .order("simbolo", { ascending: true });
    const watchlist = watchlistRaw || [];

    type AsiaCoin = {
      simbolo: string;
      high: number;
      low: number;
      range: number;
      prezzo: number | null;
      posizione: string | null;
      pct_change: string | null;
    };
    const asiaCoins: AsiaCoin[] = [];
    for (const w of watchlist) {
      const high = Number(w.asian_high);
      const low = Number(w.asian_low);
      const prezzo = w.prezzo != null ? Number(w.prezzo) : null;
      if (isNaN(high) || isNaN(low) || high <= low) continue;
      asiaCoins.push({
        simbolo: w.simbolo,
        high, low, range: high - low,
        prezzo: prezzo != null && !isNaN(prezzo) ? prezzo : null,
        posizione: w.posizione || null,
        pct_change: w.pct_change || null,
      });
    }

    const asiaBlock = {
      count_today: asiaCoins.length,
      coins: asiaCoins,
    };

    // ===== Checklist Reminder Rodrigo (statica) =====
    const reminderRodrigo = [
      "Compila il fajr",
      "Compila la marea",
      "Sistema i monitor in modalita analisi: Telegram + Claude Desktop / TradingView + Bull Clock / MT4 panoramica mercato",
      "Apri nuova giornata dalla dashboard",
      "Compila le cronache di ieri",
      "Crea i bias bias",
      "Metti gli screen e ricontrolla Asia",
      "Crea le tue ipotesi su AsiaSweep",
      "Non tradare, segui il sistema",
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

      const maxOra = new Date(usdSeries[maxIdx].created_at).toISOString().slice(11, 16);
      const minOra = new Date(usdSeries[minIdx].created_at).toISOString().slice(11, 16);

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
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk. Ecco gli allert di prezzo registrati dall'apertura della giornata corrente (00:00 UTC a ora):

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

    function posEmoji(p: string | null): string {
      if (p === "sopra") return "⬆️";
      if (p === "sotto") return "⬇️";
      if (p === "dentro") return "↔️";
      return "·";
    }
    function posLabel(p: string | null): string {
      return p ? p.toUpperCase() : "n/d";
    }
    function fmtNum(n: number): string {
      if (n >= 1000) return n.toFixed(2);
      if (n >= 10) return n.toFixed(2);
      return n.toFixed(5);
    }

    const asiaRangeLines = asiaCoins.length > 0
      ? asiaCoins.map((c) => {
          const prezzoStr = c.prezzo != null ? fmtNum(c.prezzo) : "n/d";
          const pct = c.pct_change ? ` (${c.pct_change}%)` : "";
          return `- <b>${c.simbolo}</b> ${posEmoji(c.posizione)} <b>${posLabel(c.posizione)}</b> | now ${prezzoStr}${pct} | L ${fmtNum(c.low)} / H ${fmtNum(c.high)} (${fmtNum(c.range)} pts)`;
        }).join("\n")
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
        usd_punti: usdSeries.length,
        letture: articoli.length,
        allert_prezzo: allertPrezzo.length,
        asia_coins: asiaCoins.length,
      },
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
