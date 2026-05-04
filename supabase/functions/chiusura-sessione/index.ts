// Chiusura Sessione - Edge Function
// Schedule:
//   pg_cron `0 10 * * *` UTC = 11:00 Casablanca (post-Londra) → { sessione: "londra" }
//   pg_cron `30 15 * * *` UTC = 16:30 Casablanca (check NY)   → { sessione: "ny" }
// Blocchi:
// - Recap trade della sessione
// - Commento Peter disciplinare (incrocia reperti, allert, trade, strategie)
// - Commento Rodrigo:
//     · Londra: lifestyle (mare se bassa marea, altrimenti sport o famiglia)
//     · NY: todo-list di compilazione (giornaliero, trade, cronache, sessioni)
// Output: solo Telegram (no UPSERT)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SESSIONE_INFO: Record<string, { label: string; emoji: string; oraStart: string; oraEnd: string; scope: "lifestyle" | "compilazione" }> = {
  londra: { label: "Londra", emoji: "🇬🇧", oraStart: "08:00", oraEnd: "11:00", scope: "lifestyle" },
  ny:     { label: "New York", emoji: "🇺🇸", oraStart: "14:30", oraEnd: "16:30", scope: "compilazione" },
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

async function callClaude(prompt: string, apiKey: string, maxTokens = 600): Promise<string> {
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
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !ANTHROPIC_API_KEYS) {
      return new Response(JSON.stringify({ error: "secrets missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const sessione = (body.sessione || "londra").toLowerCase();
    if (!SESSIONE_INFO[sessione]) {
      return new Response(JSON.stringify({ error: `sessione non valida: ${sessione}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const info = SESSIONE_INFO[sessione];

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = todayCasablanca();
    const startOfDayIso = startOfDayCasablancaIso(today);
    const last30daysIso = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    // ===== 1. Trade della sessione =====
    const { data: tradesAllRaw } = await supabase
      .from("trades")
      .select("id, asset, direzione, data, pnl, esito, rr_reale, rr_teorico, note, mood, strategia_id, sessione_id")
      .gte("data", startOfDayIso)
      .order("data", { ascending: true });
    const tradesAll = tradesAllRaw || [];

    const tradesSessione = tradesAll.filter((t) => {
      const ora = hhmmCasablanca(t.data);
      return ora >= info.oraStart && ora <= info.oraEnd;
    });

    const completed = tradesSessione.filter((t) => t.esito === "win" || t.esito === "loss");
    const wins = completed.filter((t) => t.esito === "win").length;
    const winrate = completed.length > 0 ? Math.round((wins / completed.length) * 100) : 0;
    const netPnl = tradesSessione.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);

    // ===== 2. Reperti recenti =====
    const { data: biasRaw } = await supabase
      .from("bias")
      .select("asset, direzione, tipo, data, commento, confluenze")
      .gte("data", last30daysIso)
      .order("data", { ascending: false })
      .limit(20);
    const bias = biasRaw || [];

    // ===== 3. Allert macro di oggi =====
    const { data: allertMacroRaw } = await supabase
      .from("allert")
      .select("titolo, ora_evento, impatto, valuta, valore_atteso, valore_effettivo, commento_rodrigo")
      .eq("data_evento", today)
      .order("ora_evento", { ascending: true });
    const allertMacro = allertMacroRaw || [];

    // ===== 4. Allert prezzo di oggi =====
    const { data: allertPrezzoRaw } = await supabase
      .from("allert_prezzo")
      .select("coin, prezzo, descrizione, ora, commento, stato")
      .gte("created_at", startOfDayIso);
    const allertPrezzo = allertPrezzoRaw || [];

    // ===== 5. Strategie collegate =====
    const strategiaIds = Array.from(new Set(tradesSessione.map((t) => t.strategia_id).filter(Boolean) as string[]));
    let strategie: Array<{ id: string; nome: string; ipotesi: string; gestione_rischio: string }> = [];
    if (strategiaIds.length > 0) {
      const { data } = await supabase.from("strategie")
        .select("id, nome, ipotesi, gestione_rischio")
        .in("id", strategiaIds);
      strategie = (data as typeof strategie) || [];
    }

    // ===== 6. Commento Peter =====
    let peterCommento = "Nessun trade nella sessione: niente da analizzare.";
    if (tradesSessione.length > 0) {
      try {
        const tradeLines = tradesSessione.map((t, i) => {
          const ora = hhmmCasablanca(t.data);
          return `${i + 1}. [${ora}] ${t.asset} ${t.direzione} esito=${t.esito || "open"} pnl=${t.pnl != null ? t.pnl : "n.d."} rr_reale=${t.rr_reale || "n.d."}${t.note ? " note: " + (t.note.length > 100 ? t.note.substring(0, 100) + "..." : t.note) : ""}${t.strategia_id ? " strat_id=" + t.strategia_id.substring(0, 8) : ""}`;
        }).join("\n");

        const biasLines = bias.length > 0
          ? bias.slice(0, 8).map((b) => `- [${b.data}] ${b.asset} ${b.direzione || ""}${b.commento ? ": " + b.commento.substring(0, 100) : ""}${b.confluenze ? " | conf: " + b.confluenze.substring(0, 80) : ""}`).join("\n")
          : "(nessun reperto)";

        const allertMacroLines = allertMacro.length > 0
          ? allertMacro.map((a) => `- ${a.ora_evento ? a.ora_evento.substring(0, 5) : ""} ${a.titolo} [${a.impatto}/${a.valuta}] atteso=${a.valore_atteso || "n.d."} effettivo=${a.valore_effettivo || "n.d."}`).join("\n")
          : "(nessun macro oggi)";

        const allertPrezzoLines = allertPrezzo.length > 0
          ? allertPrezzo.slice(0, 10).map((a) => `- ${a.coin} a ${a.prezzo} (${a.stato})${a.descrizione ? " " + a.descrizione : ""}`).join("\n")
          : "(nessun allert prezzo oggi)";

        const strategieLines = strategie.length > 0
          ? strategie.map((s) => `- "${s.nome}" - ipotesi: ${(s.ipotesi || "").substring(0, 150)}`).join("\n")
          : "(nessuna strategia collegata ai trade della sessione)";

        const prompt = `Sei Peter, mental coach analista comportamentale del Trade Desk.

PROFILO TRADER:
- Scalper retail Casablanca, sessioni Londra/NY focus
- Asset: XAU/USD, US30, NASDAQ, GER40
- Regole rischio: max 2-3 SL/sessione, 0.5% perdita/sessione, 0.75-1% rischio giornaliero

POSTURA (regole critiche):
- Sei un analista clinico distaccato. NON sei un coach motivazionale da palestra. Niente "credi in te stesso", niente Mr. Miyagi.
- NON presumere pattern. Se ne segnali uno, dichiara confidenza statistica esplicita (es. "n=4, debole" oppure "n=23, robusto"). L'utente vuole oggettivita.
- Filtri tutto attraverso la lente del trading performance.

DEBRIEF SESSIONE ${info.label.toUpperCase()} (oggi ${today}, ${info.oraStart}-${info.oraEnd} Casablanca)

TRADE DELLA SESSIONE (${tradesSessione.length}, completed=${completed.length}, winrate=${winrate}%, net PnL=${netPnl.toFixed(2)}):
${tradeLines}

REPERTI ATTIVI (ultimi 30gg, input strategici permanenti):
${biasLines}

ALLERT MACRO DI OGGI:
${allertMacroLines}

ALLERT PREZZO DI OGGI:
${allertPrezzoLines}

STRATEGIE COLLEGATE AI TRADE DELLA SESSIONE:
${strategieLines}

Genera un commento disciplinare ASCIUTTO (italiano, no parolacce, no motivational) che copra in ordine, ognuno UNA RIGA:
1. Trade vs strategie: regole rispettate? (1 riga)
2. Confluenze reperti vs trade presi: allineamento? (1 riga)
3. Deviazioni cognitive (FOMO, revenge, forcing) SOLO se evidenti — altrimenti "nessuna" (1 riga)
4. Voto disciplina 0-10 + 1 motivazione tecnica (1 riga)
5. Una regola operativa concreta per la prossima sessione (1 riga)

VINCOLI HARD:
- Massimo 5 righe totali, NIENTE intro, NIENTE conclusioni, NIENTE markdown bold/italic.
- Se i trade < 3: dichiaralo nella riga 1, riduci a 3 righe totali (no pattern stat).
- Output deve stare sotto i 700 caratteri per leggibilità Telegram.`;
        peterCommento = (await callClaude(prompt, ANTHROPIC_API_KEYS, 1000)).trim();
      } catch (e) {
        peterCommento = `Errore commento Peter: ${(e as Error).message}`;
      }
    }

    // ===== 7. Box Rodrigo =====
    let rodrigoBlock: { tipo: string; testo?: string; todo?: Array<{ ok: boolean; label: string }> } = { tipo: info.scope };

    if (info.scope === "lifestyle") {
      const { data: giornata } = await supabase.from("giornate")
        .select("marea").eq("data", today).maybeSingle();
      const marea = (giornata?.marea || "").toString().toLowerCase();
      try {
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk.

L'utente ha appena chiuso la sessione di Londra (sono le 11:00 Casablanca). Ha qualche ora di pausa prima della sessione di New York alle 14:30.

MAREA DI OGGI: ${marea || "n.d."}

Suggeriscigli in UNA sola frase asciutta come passare la pausa:
- Se la marea e' "bassa" (o simili): proponigli di andare al mare.
- Altrimenti: scegli tra "fare sport" o "passare tempo con la famiglia". Variabile, non sempre la stessa.

Italiano. Una frase. Niente motivazione vuota, niente parolacce, niente formule fatte. Tono pratico da compagno operativo.`;
        rodrigoBlock.testo = (await callClaude(prompt, ANTHROPIC_API_KEYS, 100)).trim();
      } catch (e) {
        rodrigoBlock.testo = marea.includes("bassa") ? "Marea bassa. Vai al mare." : "Pausa: muoviti un'ora o stai con la famiglia.";
      }
    } else {
      // Compilazione check (NY 16:30)
      const todo: Array<{ ok: boolean; label: string }> = [];

      // Giornata
      const { data: giornata } = await supabase.from("giornate")
        .select("id, mindset, volatilita, fajr, marea, note_domani, day_tags").eq("data", today).maybeSingle();

      if (!giornata) {
        todo.push({ ok: false, label: "Aprire la giornata di oggi" });
      } else {
        if (!giornata.mindset) todo.push({ ok: false, label: "Compilare mindset di oggi" });
        if (!giornata.volatilita) todo.push({ ok: false, label: "Compilare volatilita di oggi" });
        if (giornata.fajr === null || giornata.fajr === undefined) todo.push({ ok: false, label: "Compilare fajr" });
        if (!giornata.marea) todo.push({ ok: false, label: "Compilare marea" });
      }

      // Trade incompleti (esito null o screenshot null o note null)
      const tradesIncompleti = tradesAll.filter((t) => !t.esito || !t.note);
      if (tradesIncompleti.length > 0) {
        todo.push({ ok: false, label: `${tradesIncompleti.length} trade da completare (esito o note mancanti)` });
      }

      // Cronaca di oggi
      const { data: cronaca } = await supabase.from("cronache").select("id, coin_data").eq("data", today).maybeSingle();
      if (!cronaca) {
        todo.push({ ok: false, label: "Compilare cronaca di oggi" });
      } else if (!cronaca.coin_data || Object.keys(cronaca.coin_data).length === 0) {
        todo.push({ ok: false, label: "Cronaca di oggi vuota: aggiungere coin_data" });
      }

      // Sessioni di oggi
      const { data: sessioniOggi } = await supabase.from("sessioni").select("nome, mood").eq("data", today);
      const nomi = (sessioniOggi || []).map((s) => (s.nome || "").toLowerCase());
      if (!nomi.some((n) => n.startsWith("london"))) todo.push({ ok: false, label: "Compilare sessione Londra" });
      if (!nomi.some((n) => n.startsWith("newyork"))) todo.push({ ok: false, label: "Compilare sessione New York" });
      const sessioniSenzaMood = (sessioniOggi || []).filter((s) => !s.mood);
      if (sessioniSenzaMood.length > 0) todo.push({ ok: false, label: `${sessioniSenzaMood.length} sessioni senza mood` });

      if (todo.length === 0) todo.push({ ok: true, label: "Tutto compilato. Buon lavoro." });

      rodrigoBlock.todo = todo;
    }

    // ===== Telegram =====
    const tradeLinesShort = tradesSessione.length > 0
      ? tradesSessione.map((t) => {
          const ora = hhmmCasablanca(t.data);
          const p = t.pnl != null && Number(t.pnl) >= 0 ? `+${t.pnl}` : `${t.pnl ?? "?"}`;
          return `- ${ora} ${t.asset} ${t.direzione} <b>${p}</b> (${t.esito || "open"})`;
        }).join("\n")
      : "<i>nessun trade nella sessione</i>";

    let rodrigoTgBlock = "";
    if (info.scope === "lifestyle") {
      rodrigoTgBlock = `🏖️ <b>Rodrigo</b>\n${rodrigoBlock.testo || "—"}`;
    } else {
      const todoLines = (rodrigoBlock.todo || []).map((t) => `${t.ok ? "✅" : "▢"} ${t.label}`).join("\n");
      rodrigoTgBlock = `📝 <b>Rodrigo - cose da chiudere</b>\n${todoLines}`;
    }

    const msg =
      `${info.emoji} <b>Chiusura ${info.label}</b> - <i>${today}</i>\n\n` +
      `📊 <b>Recap Trade</b> (${tradesSessione.length}, WR ${winrate}%, net <b>${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}</b>)\n${tradeLinesShort}\n\n` +
      `🧠 <b>Peter - debrief disciplinare</b>\n${peterCommento}\n\n` +
      `${rodrigoTgBlock}`;

    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    return new Response(JSON.stringify({
      ok: true, sessione, data: today,
      counts: {
        trades_sessione: tradesSessione.length, completed: completed.length, winrate, net_pnl: netPnl,
        bias: bias.length, allert_macro: allertMacro.length, allert_prezzo: allertPrezzo.length, strategie: strategie.length,
      },
      rodrigo_scope: info.scope,
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
