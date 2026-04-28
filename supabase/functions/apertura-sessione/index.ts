// Apertura Sessione - Edge Function
// Schedule:
//   pg_cron `0 7 * * *` UTC  = 08:00 Casablanca (Londra)   body: { sessione: "londra" }
//   pg_cron `30 13 * * *` UTC = 14:30 Casablanca (New York) body: { sessione: "ny" }
// Blocchi: reperti da attenzionare (Claude), forza USD intraday, allert prezzo non lavorati, promemoria Rodrigo
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

function todayCasablanca(): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function startOfDayCasablancaIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, -1, 0, 0)).toISOString();
}

function hhmmCasablanca(iso: string): string {
  const fmt = new Intl.DateTimeFormat("it-IT", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit", hour12: false });
  return fmt.format(new Date(iso));
}

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
    const today = todayCasablanca();
    const nowIso = new Date().toISOString();
    const startOfDayIso = startOfDayCasablancaIso(today);

    // ===== 1. Reperti (bias) - SOLO della giornata di oggi, tutti gli stati =====
    // Un reperto e una lettura di mercato dell'utente per la giornata: aperto/chiuso indica
    // se ha finito di aggiornarlo, ma per Rodrigo conta comunque.
    const { data: biasRaw } = await supabase
      .from("bias")
      .select("asset, direzione, tipo, data, commento, confluenze, esito, stato, created_at")
      .eq("data", today)
      .order("created_at", { ascending: true });
    const bias = biasRaw || [];

    let repertiBlock = { count: bias.length, commento: "Nessun reperto registrato per oggi." };
    if (bias.length > 0) {
      try {
        const biasText = bias.map((b, i) => {
          const com = b.commento ? (b.commento.length > 250 ? b.commento.substring(0, 250) + "..." : b.commento) : "";
          const conf = b.confluenze ? (b.confluenze.length > 150 ? b.confluenze.substring(0, 150) + "..." : b.confluenze) : "";
          const tipoStr = b.tipo && Array.isArray(b.tipo) && b.tipo.length ? " (" + b.tipo.join(",") + ")" : "";
          return `${i + 1}. ${b.asset || "?"} ${b.direzione || ""}${tipoStr}${com ? " - " + com : ""}${conf ? " | conf: " + conf : ""}`;
        }).join("\n");
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk per uno scalper su XAU/USD, US30, NASDAQ, GER40.

Sta per aprire la sessione di ${info.label} (${today}).

I REPERTI qui sotto sono OSSERVAZIONI e LETTURE DI MERCATO che l'utente stesso ha annotato per la giornata di oggi. NON sono task da eseguire, NON sono cose da fare: sono cio che lui percepisce del mercato in questo momento.

REPERTI di oggi:
${biasText}

Restituisci una sintesi (2-4 punti, una riga per punto) che RISPECCHI la lettura dell'utente per la sessione di ${info.label}. Esempio di tono: "Vedi XAU long: la sessione di ${info.label} e il primo banco di prova per questa lettura" oppure "Hai annotato compressione su NAS in pre-NY: osserva come si scarica all'apertura".

Regole:
- NON dire "verifica se ancora valido", "monitorare X", "attenzionare Y" - non sono task.
- Riferisciti alla lettura come se fosse SUA, perche lo e.
- Asciutto, italiano, zero motivational speech, zero parolacce, niente segnali operativi.`;
        repertiBlock.commento = (await callClaude(prompt, ANTHROPIC_API_KEYS, 450)).trim();
      } catch (e) { repertiBlock.commento = `Errore commento reperti: ${(e as Error).message}`; }
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
      const maxOra = hhmmCasablanca(usdSeries[maxIdx].created_at);
      const minOra = hhmmCasablanca(usdSeries[minIdx].created_at);
      let descr = `Apertura giornata a ${apertura.toFixed(4)}, ora a ${attuale.toFixed(4)} (${trend}, delta ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}).`;
      if (max !== min) descr += ` Range giornaliero finora: max ${max.toFixed(4)} alle ${maxOra}, min ${min.toFixed(4)} alle ${minOra}.`;
      usdBlock = { apertura, attuale, max, min, max_ora: maxOra, min_ora: minOra, trend_intraday: trend, descrizione: descr };
    }

    // ===== 3. Allert prezzo NON lavorati (stato=nuovo) =====
    const { data: allertRaw } = await supabase
      .from("allert_prezzo")
      .select("coin, prezzo, ora, descrizione, created_at")
      .eq("stato", "nuovo")
      .order("created_at", { ascending: false })
      .limit(20);
    const allertNuovi = allertRaw || [];

    // raggruppa per coin
    const byCoin: Record<string, Array<{ prezzo: string; ora: string; descrizione: string }>> = {};
    for (const a of allertNuovi) {
      const c = a.coin || "?";
      if (!byCoin[c]) byCoin[c] = [];
      byCoin[c].push({ prezzo: a.prezzo || "", ora: a.ora || hhmmCasablanca(a.created_at), descrizione: a.descrizione || "" });
    }
    const allertBlock = { count: allertNuovi.length, by_coin: byCoin };

    // ===== 4. Promemoria Rodrigo (statico) =====
    const reminderRodrigo = [
      "Sii paziente, ricordati del winrate",
      "Inverti gli schermi: TradingView al centro, MT4 sui laterali",
      "Cerca conferme per validare la strategia",
    ];

    // ===== Costruisci JSON apertura_brief =====
    const aperturaBrief = {
      generato_alle: nowIso,
      sessione,
      reperti: repertiBlock,
      usd_strength: usdBlock,
      allert_prezzo_nuovi: allertBlock,
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
    let allertLines = "<i>nessun allert non lavorato</i>";
    if (allertNuovi.length > 0) {
      allertLines = Object.entries(byCoin).map(([coin, entries]) => {
        const list = entries.slice(0, 3).map((e) => `${e.ora} a <b>${e.prezzo}</b>${e.descrizione ? " (" + e.descrizione + ")" : ""}`).join(", ");
        const extra = entries.length > 3 ? ` (+${entries.length - 3} altri)` : "";
        return `- <b>${coin}</b>: ${list}${extra}`;
      }).join("\n");
    }

    const reminderLines = reminderRodrigo.map((r) => `▢ ${r}`).join("\n");

    const msg =
      `${info.emoji} <b>Apertura ${info.label}</b> - <i>${today}</i>\n\n` +
      `🧠 <b>Reperti di oggi</b>\n${repertiBlock.commento}\n\n` +
      `💵 <b>Forza USD</b> (intraday)\n${usdBlock.descrizione}\n\n` +
      `🚨 <b>Allert Prezzo non lavorati</b> (${allertBlock.count})\n${allertLines}\n\n` +
      `🔔 <b>Promemoria Rodrigo</b>\n${reminderLines}`;

    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    return new Response(JSON.stringify({
      ok: true, sessione, data: today, sessione_id: sessioneId,
      counts: {
        reperti: bias.length, usd_punti: usdSeries.length,
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
