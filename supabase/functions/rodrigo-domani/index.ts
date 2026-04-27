// Rodrigo Domani - Edge Function
// Schedule: pg_cron `0 20 * * *` UTC = 21:00 Casablanca
// Prep prossima giornata operativa: salta sabato/domenica.
// Output: messaggio Telegram firmato Rodrigo + INSERT su routine_events e assistant_messages.

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

// Restituisce {iso, label, isFridayOggi}: prossima giornata operativa (lun-ven), saltando weekend.
function nextOperativeDay(today: string): { iso: string; label: string; oggiIsFriday: boolean } {
  const [y, m, d] = today.split("-").map(Number);
  const oggi = new Date(Date.UTC(y, m - 1, d));
  const dowOggi = oggi.getUTCDay(); // 0=Dom, 5=Ven, 6=Sab
  const oggiIsFriday = dowOggi === 5;
  let next = new Date(oggi.getTime() + 86400000);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next = new Date(next.getTime() + 86400000);
  }
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  const iso = `${yy}-${mm}-${dd}`;
  const giorni = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
  const mesi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const label = `${giorni[next.getUTCDay()]} ${next.getUTCDate()} ${mesi[next.getUTCMonth()]}`;
  return { iso, label, oggiIsFriday };
}

async function callClaude(systemPrompt: string, userPrompt: string, apiKey: string, maxTokens = 1200): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: maxTokens, system: systemPrompt,
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
    const { iso: domani, label: domaniLabel, oggiIsFriday } = nextOperativeDay(today);

    const { data: macroDomaniRaw } = await supabase
      .from("allert").select("titolo, ora_evento, impatto, valuta, note")
      .eq("data_evento", domani).order("ora_evento", { ascending: true });
    const macroDomani = macroDomaniRaw || [];
    const macroAlti = macroDomani.filter((a) => ["alto", "high", "High", "Alto"].includes(a.impatto));

    const cutoff2gg = (() => {
      const [yy, mm, dd] = today.split("-").map(Number);
      const dt = new Date(Date.UTC(yy, mm - 1, dd - 2));
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    })();

    const { data: biasVecchiRaw } = await supabase
      .from("bias").select("asset, direzione, data")
      .is("esito", null).lte("data", cutoff2gg)
      .order("data", { ascending: true }).limit(10);
    const biasVecchi = biasVecchiRaw || [];

    const { data: giornataRows } = await supabase
      .from("giornate").select("stato, mindset, note_domani").eq("data", today).limit(1);
    const giornataOggi = giornataRows && giornataRows.length > 0 ? giornataRows[0] : null;

    const startToday = (() => {
      const [yy, mm, dd] = today.split("-").map(Number);
      return new Date(Date.UTC(yy, mm - 1, dd, -1, 0, 0)).toISOString();
    })();
    const endToday = (() => {
      const [yy, mm, dd] = today.split("-").map(Number);
      return new Date(Date.UTC(yy, mm - 1, dd, 22, 59, 59, 999)).toISOString();
    })();
    const { data: tradesNonCompRaw } = await supabase
      .from("trades").select("asset, direzione")
      .gte("data", startToday).lte("data", endToday).is("screenshot_url", null);
    const tradesNonCompilati = tradesNonCompRaw || [];

    const systemPrompt = `Sei RODRIGO, assistente operativo giornaliero. Scrivi in italiano, tono pratico e sveglio.

CONTESTO: sono le 21:00 Casablanca. La giornata di trading di oggi e chiusa. Sto preparando l'utente per la prossima giornata operativa: ${domaniLabel} (${domani}). Se la data salta il weekend (es. venerdi sera -> lunedi), menziona esplicitamente che si tratta della prossima apertura dei mercati.

OUTPUT:
- Max 10 righe. HTML Telegram: <b>, <i>.
- Struttura:
  1) Una riga di contesto breve (pending di oggi se ce ne sono, altrimenti "oggi chiuso pulito")
  2) Eventi macro high-impact di domani con orari (se ce ne sono)
  3) Reperti aperti da oltre 2 giorni da rivalutare (solo se ce ne sono)
  4) Promemoria weekly review (solo se oggi e venerdi)

REGOLE:
- Se non ci sono eventi high-impact, dillo brevemente e passa oltre.
- Zero parolacce. Tono da compagno operativo, non coach.
- Niente riempitivi. Se una sezione e vuota, saltala, non dire "nulla da segnalare".
- Non firmare.`;

    const payload = {
      oggi: today, domani, is_venerdi: oggiIsFriday,
      pending_oggi: {
        giornata_non_chiusa: !giornataOggi || giornataOggi.stato !== "completato",
        note_domani_mancanti: !giornataOggi || !giornataOggi.note_domani,
        trade_senza_screenshot: tradesNonCompilati.length,
      },
      macro_domani: macroAlti.map((a) => ({ ora: a.ora_evento, titolo: a.titolo, valuta: a.valuta, impatto: a.impatto })),
      bias_da_rivalutare: biasVecchi.map((b) => ({ asset: b.asset, direzione: b.direzione, data: b.data })),
    };

    const text = await callClaude(systemPrompt, `Dati prep domani in JSON:\n${JSON.stringify(payload)}`, ANTHROPIC_API_KEYS, 1200);

    const msg = `\u{1F4C5} <b>Prep ${domaniLabel}</b> - <i>Rodrigo</i>\n\n${text}`;
    const tg = await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

    await supabase.from("assistant_messages").insert({
      assistente: "rodrigo", ruolo: "assistant", sorgente: "routine", slot: "rodrigo-domani",
      contenuto: text, metadata: { data: today, domani, telegram_message_id: tg.messageId },
    });

    await supabase.from("routine_events").insert({
      slot: "rodrigo-domani", tipo: "ai-prep", assistente: "rodrigo",
      payload: { macro_alti: macroAlti.length, bias_vecchi: biasVecchi.length, output: text },
      telegram_sent: !!tg.ok, telegram_message_id: tg.messageId ?? null,
    });

    return new Response(JSON.stringify({
      ok: true, oggi: today, domani, label: domaniLabel,
      counts: { macro_alti: macroAlti.length, bias_vecchi: biasVecchi.length, trade_non_comp: tradesNonCompilati.length },
      telegram: tg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
