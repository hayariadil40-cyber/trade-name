// Letture Mattina - Edge Function
// Schedule: pg_cron `50 5 * * *` UTC = 06:50 Casablanca (UTC+1, no DST)
// Flusso:
// 1) Anthropic API (claude-sonnet-4-6 + tool web_search) -> rassegna stampa 24h
// 2) Filtra/sintetizza, tagga per tema, restituisce JSON
// 3) UPSERT su articoli_daily (chiave: url) - dedup tra run
// 4) Per ogni articolo NUOVO (created_at vicino al run): un messaggio Telegram
// 5) Riepilogo finale

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

const SYSTEM_PROMPT = `Sei un assistente che prepara la rassegna stampa mattutina per un trader (focus: forex, macro, indici USA/EU, oro, crypto quando muove i mercati).

OBIETTIVO: trova articoli pubblicati nelle ULTIME 24 ORE dalle seguenti 8 fonti principali, filtra per rilevanza e produci un JSON strutturato.

FONTI PRIORITARIE (usa web_search con 'site:dominio ...' o cerca per nome fonte):
1. Bloomberg (bloomberg.com)
2. Reuters (reuters.com)
3. Financial Times (ft.com)
4. CNBC (cnbc.com)
5. ForexLive (forexlive.com)
6. ZeroHedge (zerohedge.com)
7. The Information (theinformation.com) - solo AI/big tech business
8. Axios (axios.com) - solo politica USA che impatta mercati

TEMI DA COPRIRE (cerca attivamente):
- macro: Fed, BCE, BoE, BoJ, dati macro (CPI, NFP, PMI), banche centrali, politica monetaria
- forza_indici: forex majors (EURUSD, GBPUSD, USDJPY, DXY), oro (XAUUSD), indici (SP500, Nasdaq, DAX, Dow)
- geopolitica: Trump dichiarazioni/policy, Iran, Israele, guerre, sanzioni, tariffe, elezioni che muovono mercati
- ai_tech: SOLO in chiave economica -> earnings Nvidia/Apple/Microsoft/Google/Meta/Tesla, bilanci, CEO changes, nuovi modelli AI (es. Claude Opus 4.7, GPT-5), bolla AI, IPO tech, capex datacenter

REGOLE SELEZIONE:
- SOLO articoli pubblicati <24h (se una fonte non ha niente di fresco, saltala)
- Scarta gossip, sport, lifestyle, listicles ("10 modi per..."), advertorial
- Scarta duplicati: se la stessa news e su piu fonti, tieni solo la piu autorevole
- Quantita dinamica: 4-15 articoli totali. Giornate tranquille -> meno. Giornate volatili -> fino a 15.
- Quota per tema indicativa: macro 30%, forex_indici 20%, geopolitica 25%, ai_tech 25%

OUTPUT: rispondi SOLO con un JSON valido in questa forma esatta, niente testo prima o dopo:
{
  "articoli": [
    {
      "titolo_it": "titolo tradotto/riassunto in italiano, max 90 caratteri",
      "sommario_it": "2-3 frasi in italiano che catturano la sostanza e l'impatto mercati",
      "fonte": "Bloomberg | Reuters | FT | CNBC | ForexLive | ZeroHedge | TheInformation | Axios | Altro",
      "url": "url originale",
      "data_pubblicazione": "YYYY-MM-DD (data pubblicazione articolo, non di oggi se e di ieri)",
      "tag_tema": ["macro" | "forex_indici" | "geopolitica" | "ai_tech"],
      "rilevanza": 1-5
    }
  ]
}

Non aggiungere commenti, markdown, backticks. SOLO JSON valido.`;

const TAG_EMOJI: Record<string, string> = {
  macro: "📊",
  forex_indici: "💱",
  geopolitica: "🌍",
  ai_tech: "🤖",
};

interface Articolo {
  titolo_it: string;
  sommario_it: string;
  fonte: string;
  url: string;
  data_pubblicazione?: string;
  tag_tema: string[];
  rilevanza: number;
}

async function callClaudeWithSearch(apiKey: string, userPrompt: string): Promise<Articolo[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 5000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Anthropic error: ${data.error.message}`);

  let finalText = "";
  for (const block of data.content || []) {
    if (block.type === "text") finalText = block.text;
  }
  if (!finalText) throw new Error("Nessun text block in risposta Anthropic");

  const cleanJson = extractJsonBlock(finalText);
  let parsed: { articoli?: Articolo[] };
  try {
    parsed = JSON.parse(cleanJson);
  } catch {
    throw new Error(`JSON invalido da Claude: ${cleanJson.substring(0, 300)}`);
  }
  return parsed.articoli || [];
}

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.substring(start, end + 1);
  return text;
}

async function sendTelegram(text: string, botToken: string, chatId: string): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text, disable_web_page_preview: true }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || "telegram error" };
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function htmlEncode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !ANTHROPIC_API_KEYS) {
      return new Response(JSON.stringify({ error: "secrets missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = todayCasablanca();
    const userPrompt = `Data di oggi: ${today} (Casablanca / UTC+1). Prepara la rassegna mattutina.`;

    // Background task: il fetch web_search puo durare 1-3 min e supera il
    // gateway timeout (~90s). Eseguiamo fire-and-forget e ritorniamo subito.
    const longTask = async () => {
      try {
        const articoli = await callClaudeWithSearch(ANTHROPIC_API_KEYS, userPrompt);
        if (articoli.length === 0) {
          await supabase.from("routine_events").insert({
            slot: "letture-mattina", tipo: "rassegna", assistente: null,
            payload: { totale: 0, nuovi: 0, esistenti: 0, errori: [] },
            telegram_sent: false,
          });
          return;
        }

        let nNuovi = 0;
        let nEsistenti = 0;
        const errori: string[] = [];
        const runStartMs = Date.now();

        for (const a of articoli) {
          if (!a.url) continue;
          const tags = Array.isArray(a.tag_tema) ? a.tag_tema : [];
          let rel = Number(a.rilevanza) || 1;
          if (rel < 1) rel = 1;
          if (rel > 5) rel = 5;
          const dataPub = a.data_pubblicazione || today;

          const record = {
            titolo: a.titolo_it, sommario: a.sommario_it, fonte: a.fonte, url: a.url,
            data: dataPub, tag_tema: tags, rilevanza: rel,
          };

          const { data: upserted, error } = await supabase
            .from("articoli_daily")
            .upsert(record, { onConflict: "url" })
            .select("created_at")
            .maybeSingle();

          if (error) {
            errori.push(`${a.url}: ${error.message}`);
            continue;
          }
          if (!upserted) { nEsistenti++; continue; }

          const createdAtMs = new Date(upserted.created_at).getTime();
          const isNew = Math.abs(createdAtMs - runStartMs) < 120000;

          if (isNew) {
            nNuovi++;
            const temaEmoji = tags.map((t) => TAG_EMOJI[t] || "").filter(Boolean).join(" ");
            const tagLabel = tags.join(" · ");
            const stars = "★".repeat(rel) + "☆".repeat(5 - rel);
            const msg =
              `📰 ${temaEmoji} <b>${htmlEncode(record.titolo)}</b>\n` +
              `<i>${htmlEncode(record.fonte)}</i> · <code>${htmlEncode(tagLabel)}</code> · ${stars}\n\n` +
              `${htmlEncode(record.sommario)}\n\n` +
              `🔗 <a href="${a.url}">Leggi originale</a>`;
            await sendTelegram(msg, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
            await new Promise((r) => setTimeout(r, 1500));
          } else {
            nEsistenti++;
          }
        }

        if (nNuovi > 0) {
          await sendTelegram(
            `🎯 <b>Rassegna mattina ${today}</b>\n${nNuovi} nuovi articoli inviati sopra.`,
            TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
          );
        }

        await supabase.from("routine_events").insert({
          slot: "letture-mattina", tipo: "rassegna", assistente: null,
          payload: { totale: articoli.length, nuovi: nNuovi, esistenti: nEsistenti, errori: errori.slice(0, 5) },
          telegram_sent: nNuovi > 0,
        });
      } catch (e) {
        await supabase.from("routine_events").insert({
          slot: "letture-mattina", tipo: "rassegna", assistente: null,
          payload: { error: (e as Error).message },
          telegram_sent: false,
        }).then(() => {}).catch(() => {});
      }
    };

    // @ts-ignore EdgeRuntime e' fornito dal runtime Supabase Edge
    EdgeRuntime.waitUntil(longTask());

    return new Response(JSON.stringify({ ok: true, status: "started", data: today }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
