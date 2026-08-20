// Chiusura Sessione - Edge Function
// Schedule:
//   pg_cron `0 10 * * *` UTC = 11:00 Casablanca (post-Londra) → { sessione: "londra" }
//   pg_cron `30 15 * * *` UTC = 16:30 Casablanca (check NY)   → { sessione: "ny" }
// Blocchi:
// - Recap trade della sessione
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
  londra: { label: "Londra", emoji: "🇬🇧", oraStart: "07:00", oraEnd: "11:00", scope: "lifestyle" },
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callClaude(prompt: string, apiKey: string, maxTokens = 600): Promise<string> {
  const backoffMs = [5000, 15000, 30000];
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    const transient = response.status === 429 || response.status === 529 || (response.status >= 500 && response.status < 600);
    if (transient && attempt < backoffMs.length) {
      await sleep(backoffMs[attempt]);
      continue;
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.content?.[0]?.text || "";
  }
  throw new Error("Anthropic transient errors after retry (overloaded / rate-limit)");
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

    // ===== 2. Box Rodrigo =====
    let rodrigoBlock: { tipo: string; testo?: string; todo?: Array<{ ok: boolean; label: string }> } = { tipo: info.scope };

    if (info.scope === "lifestyle") {
      const { data: giornata } = await supabase.from("giornate")
        .select("marea").eq("data", today).maybeSingle();
      const mareaOra = (giornata?.marea || "").toString();
      const mareaHH = parseInt((mareaOra.split(":")[0] || "-1"), 10);
      const mareaInPausa = mareaHH >= 11 && mareaHH < 15;
      try {
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk.

L'utente ha appena chiuso la sessione di Londra (sono le 11:00 Casablanca). Ha qualche ora di pausa prima della sessione di New York alle 14:30.

BASSA MAREA OGGI A RABAT: ${mareaOra || "n.d."} (il campo "marea" contiene SEMPRE l'orario della bassa marea, mai dell'alta).

Suggeriscigli in UNA sola frase asciutta come passare la pausa:
- Se la bassa marea cade nella pausa (11:00-14:30 Casablanca): proponigli di andare al mare.
- Altrimenti: scegli tra "fare sport" o "passare tempo con la famiglia". Variabile, non sempre la stessa.

Italiano. Una frase. Niente motivazione vuota, niente parolacce, niente formule fatte.`;
        rodrigoBlock.testo = (await callClaude(prompt, ANTHROPIC_API_KEYS, 100)).trim();
      } catch (e) {
        rodrigoBlock.testo = mareaInPausa ? `Bassa marea alle ${mareaOra}. Vai al mare.` : "Pausa: muoviti un'ora o stai con la famiglia.";
      }
    } else {
      const todo: Array<{ ok: boolean; label: string }> = [];

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

      const tradesIncompleti = tradesAll.filter((t) => !t.esito || !t.note);
      if (tradesIncompleti.length > 0) {
        todo.push({ ok: false, label: `${tradesIncompleti.length} trade da completare (esito o note mancanti)` });
      }

      const { data: cronaca } = await supabase.from("cronache").select("id, coin_data").eq("data", today).maybeSingle();
      if (!cronaca) {
        todo.push({ ok: false, label: "Compilare cronaca di oggi" });
      } else if (!cronaca.coin_data || Object.keys(cronaca.coin_data).length === 0) {
        todo.push({ ok: false, label: "Cronaca di oggi vuota: aggiungere coin_data" });
      }

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
      `${rodrigoTgBlock}`;

    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    return new Response(JSON.stringify({
      ok: true, sessione, data: today,
      counts: {
        trades_sessione: tradesSessione.length, completed: completed.length, winrate, net_pnl: netPnl,
      },
      rodrigo_scope: info.scope,
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
