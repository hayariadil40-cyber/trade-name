// Chiusura Sessione - Edge Function
// Schedule:
//   pg_cron `0 10 * * *` UTC  → { sessione: "londra" }
//   pg_cron `30 15 * * *` UTC → { sessione: "ny" }
// Blocchi:
// - Recap trade della sessione
// - Commento Peter disciplinare (incrocia bias, allert, trade, strategie)
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
  londra: { label: "Londra", emoji: "🇬🇧", oraStart: "06:00", oraEnd: "10:00", scope: "lifestyle" },
  ny:     { label: "New York", emoji: "🇺🇸", oraStart: "13:30", oraEnd: "15:30", scope: "compilazione" },
};


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry su errori transitori Anthropic: 429 (rate limit), 529 (overloaded), 5xx (gateway).
// Backoff: 5s, 15s, 30s. Tutti gli altri status passano dritti come errore.
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
    const today = new Date().toISOString().slice(0, 10);
    const startOfDayIso = `${today}T00:00:00Z`;
    const last30daysIso = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    // ===== 1. Trade della sessione =====
    const { data: tradesAllRaw } = await supabase
      .from("trades")
      .select("id, asset, direzione, data, pnl, esito, rr_reale, rr_teorico, note, mood, strategia_id, sessione_id")
      .gte("data", startOfDayIso)
      .order("data", { ascending: true });
    const tradesAll = tradesAllRaw || [];

    const tradesSessione = tradesAll.filter((t) => {
      const ora = new Date(t.data).toISOString().slice(11, 16);
      return ora >= info.oraStart && ora <= info.oraEnd;
    });

    const completed = tradesSessione.filter((t) => t.esito === "win" || t.esito === "loss");
    const wins = completed.filter((t) => t.esito === "win").length;
    const winrate = completed.length > 0 ? Math.round((wins / completed.length) * 100) : 0;
    const netPnl = tradesSessione.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);

    // ===== 2. Bias recenti =====
    const { data: biasRaw } = await supabase
      .from("bias")
      .select("data, commenti_giornata, coin_data, stato")
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

    // ===== 5. Ipotesi di oggi (catena bias -> ipotesi -> strategia -> trade) =====
    const { data: ipotesiRaw } = await supabase
      .from("ipotesi_trading")
      .select("id, asset, direzione, sessione, stato, trade_id, strategia_id, note, created_at, strategia:strategie(nome)")
      .gte("created_at", startOfDayIso)
      .order("created_at", { ascending: true });
    type IpotesiRow = { id: string; asset: string; direzione: string; sessione: string; stato: string; trade_id: string | null; strategia_id: string | null; note: string | null; created_at: string; strategia?: { nome?: string } | null };
    const ipotesi: IpotesiRow[] = (ipotesiRaw as IpotesiRow[]) || [];

    // ===== 6. Strategie collegate (ai trade della sessione + alle ipotesi di oggi) =====
    const strategiaIds = Array.from(new Set([
      ...(tradesSessione.map((t) => t.strategia_id).filter(Boolean) as string[]),
      ...(ipotesi.map((i) => i.strategia_id).filter(Boolean) as string[]),
    ]));
    let strategie: Array<{ id: string; nome: string; ipotesi: string; gestione_rischio: string }> = [];
    if (strategiaIds.length > 0) {
      const { data } = await supabase.from("strategie")
        .select("id, nome, ipotesi, gestione_rischio")
        .in("id", strategiaIds);
      strategie = (data as typeof strategie) || [];
    }

    // Bias di oggi (subset puntuale per la catena del giorno)
    const biasOggi = bias.filter((b: { data: string }) => b.data === today);

    // ===== 7. Commento Peter (catena bias -> ipotesi -> trade) =====
    let peterCommento = "Sessione muta: nessun bias, nessuna ipotesi, nessun trade. Niente da analizzare.";
    const hasMaterial = tradesSessione.length > 0 || biasOggi.length > 0 || ipotesi.length > 0;
    if (hasMaterial) {
      try {
        const tradeLines = tradesSessione.map((t, i) => {
          const ora = new Date(t.data).toISOString().slice(11, 16);
          return `${i + 1}. [${ora}] ${t.asset} ${t.direzione} esito=${t.esito || "open"} pnl=${t.pnl != null ? t.pnl : "n.d."} rr_reale=${t.rr_reale || "n.d."}${t.note ? " note: " + (t.note.length > 100 ? t.note.substring(0, 100) + "..." : t.note) : ""}${t.strategia_id ? " strat_id=" + t.strategia_id.substring(0, 8) : ""} trade_id=${t.id.substring(0, 8)}`;
        }).join("\n");

        const biasOggiLines = biasOggi.length > 0
          ? biasOggi.map((b: any) => {
              const coinData = b.coin_data || {};
              const assets = Object.keys(coinData);
              const out: string[] = [`- asset: ${assets.join(",") || "?"} (stato: ${b.stato})`];
              // commenti_giornata: timeline top-level (no direzione)
              if (Array.isArray(b.commenti_giornata) && b.commenti_giornata.length) {
                out.push("  commenti giornata:");
                b.commenti_giornata.forEach((c: any) => {
                  out.push(`    [${c.ora || ""}] ${(c.testo || "").substring(0, 150)}`);
                });
              }
              // aggiornamenti per-asset con direzione (L/N/S)
              for (const asset of assets) {
                const aggs = Array.isArray(coinData[asset]?.aggiornamenti) ? coinData[asset].aggiornamenti : [];
                if (aggs.length > 0) {
                  out.push(`  ${asset}:`);
                  aggs.forEach((a: any) => {
                    const dir = a.direzione ? ` [${a.direzione.toUpperCase()}]` : "";
                    out.push(`    [${a.ora || ""}]${dir} ${(a.testo || "").substring(0, 120)}`);
                  });
                }
              }
              return out.join("\n");
            }).join("\n")
          : "(nessun bias creato oggi)";

        const biasStoriciLines = bias.length > biasOggi.length
          ? bias.filter((b: any) => b.data !== today).slice(0, 6).map((b: any) => {
              const assets = Object.keys(b.coin_data || {}).join(",") || "?";
              const lastC = Array.isArray(b.commenti_giornata) && b.commenti_giornata.length
                ? b.commenti_giornata[b.commenti_giornata.length - 1]
                : null;
              const snippet = lastC?.testo ? ` — "${lastC.testo.substring(0, 80)}"` : "";
              return `- [${b.data}] asset: ${assets}${snippet}`;
            }).join("\n")
          : "(solo bias di oggi)";

        const ipotesiLines = ipotesi.length > 0
          ? ipotesi.map((i) => `- ${i.asset} ${i.direzione} sess=${i.sessione} stato=${i.stato} strategia="${i.strategia?.nome || "n.d."}" trade_collegato=${i.trade_id ? "SI(" + i.trade_id.substring(0, 8) + ")" : "NO"}${i.note ? " note: " + i.note.substring(0, 100) : ""}`).join("\n")
          : "(nessuna ipotesi formulata oggi)";

        const allertMacroLines = allertMacro.length > 0
          ? allertMacro.map((a) => `- ${a.ora_evento ? a.ora_evento.substring(0, 5) : ""} ${a.titolo} [${a.impatto}/${a.valuta}] atteso=${a.valore_atteso || "n.d."} effettivo=${a.valore_effettivo || "n.d."}`).join("\n")
          : "(nessun macro oggi)";

        const allertPrezzoLines = allertPrezzo.length > 0
          ? allertPrezzo.slice(0, 10).map((a) => `- ${a.coin} a ${a.prezzo} (${a.stato})${a.descrizione ? " " + a.descrizione : ""}`).join("\n")
          : "(nessun allert prezzo oggi)";

        const strategieLines = strategie.length > 0
          ? strategie.map((s) => `- "${s.nome}" - ipotesi: ${(s.ipotesi || "").substring(0, 150)}`).join("\n")
          : "(nessuna strategia collegata)";

        const prompt = `Sei Peter, mental coach analista comportamentale del Trade Desk.

PROFILO TRADER:
- Scalper retail Casablanca, sessioni Londra/NY focus
- Asset: XAU/USD, US30, NASDAQ, GER40
- Regole rischio: max 2-3 SL/sessione, 0.5% perdita/sessione, 0.75-1% rischio giornaliero

POSTURA (regole critiche):
- Sei un analista clinico distaccato. NON sei un coach motivazionale da palestra. Niente "credi in te stesso", niente Mr. Miyagi.
- NON presumere pattern. Se ne segnali uno, dichiara confidenza statistica esplicita (es. "n=4, debole" oppure "n=23, robusto"). L'utente vuole oggettivita.
- Filtri tutto attraverso la lente del trading performance.

NUOVO FLUSSO OPERATIVO (CRITICO, ragiona seguendo questa catena, NON scorciatoie):
BIAS (bias di lettura mercato) -> IPOTESI (snapshot/istanza con strategia + livelli) -> STRATEGIA (template di regole) -> TRADE (esecuzione)
- Il trade NON va valutato direttamente vs strategia. Va valutato vs IPOTESI di cui e' figlio (1:1 trade<->ipotesi).
- L'IPOTESI va valutata vs BIAS bias del giorno (allineamento direzione + asset).
- La STRATEGIA serve solo come template a monte dell'ipotesi: regole rispettate dall'ipotesi (R/R, livelli, checklist) prima ancora del trade.
- ANELLI ROTTI (DA SEGNALARE): trade SENZA ipotesi associata, ipotesi SENZA bias associato, bias direzionalmente in conflitto con ipotesi/trade.
- NON E' un anello rotto: ipotesi senza trade collegato. Un'ipotesi e' una POSSIBILITA' formulata; se non si e' verificata e non si e' tradata, e' fisiologico, non un errore disciplinare. NON chiamarla "anello aperto/non chiuso".

DEADLINE IPOTESI (CRITICO, sessione attuale = ${info.label}):
- Le ipotesi hanno deadline = FINE GIORNATA OPERATIVA (chiusura NY ~22:00 Casa), NON fine sessione intermedia.
- Ipotesi formulate per sessioni FUTURE (es. ipotesi sessione=newyork mentre stai chiudendo Londra) sono ANCORA APERTE e VALIDE: non sono in ritardo, non sono "anelli aperti".
- Ipotesi su "Asian range" / "asian sweep" / sessione=asia: il setup di sweep e' validabile fino a chiusura NY perche' la liquidita' asiatica puo' essere presa anche in fascia NY. NON segnalarle come scadute in chiusura Londra.
- SOLO nel debrief EOD finale (post-NY) le ipotesi senza esito esplicito (eseguita/invalidata/scaduta) vanno trattate come "lasciate aperte da chiudere".
- Sessione corrente del debrief: ${info.label}. Se ${info.label} != "New York", non lamentarti delle ipotesi non ancora chiuse.

DEBRIEF SESSIONE ${info.label.toUpperCase()} (oggi ${today}, ${info.oraStart}-${info.oraEnd} UTC)

TRADE DELLA SESSIONE (${tradesSessione.length}, completed=${completed.length}, winrate=${winrate}%, net PnL=${netPnl.toFixed(2)}):
${tradeLines}

BIAS DI OGGI (lettura mercato — commenti_giornata=top-level no-dir, aggiornamenti per-asset=con direzione L/N/S):
${biasOggiLines}

IPOTESI FORMULATE OGGI (anello tra bias e trade):
${ipotesiLines}

BIAS STORICI (ultimi 30gg, sfondo, NON usarli come scusa per pattern senza n adeguato):
${biasStoriciLines}

ALLERT MACRO DI OGGI:
${allertMacroLines}

ALLERT PREZZO DI OGGI:
${allertPrezzoLines}

STRATEGIE A MONTE (template di regole):
${strategieLines}

Genera un commento disciplinare ASCIUTTO (italiano, no parolacce, no motivational) che copra in ordine, ognuno UNA RIGA:
1. Catena bias->ipotesi->trade: integrita' del flusso. Segnala SOLO veri anelli rotti (trade senza ipotesi, ipotesi senza bias, conflitto direzionale). Ipotesi senza trade NON e' un anello rotto, NON menzionarla come problema. 1 riga.
2. Coerenza direzionale: bias bias e ipotesi e trade sulla stessa direzione/asset? 1 riga.
3. Trade vs ipotesi/strategia: regole dell'ipotesi rispettate (R/R, livelli, checklist)? 1 riga.
4. Deviazioni cognitive (FOMO, revenge, forcing) SOLO se evidenti — altrimenti "nessuna". 1 riga.
5. Voto disciplina 0-10 + 1 motivazione tecnica. Se non ci sono anelli VERI rotti, non penalizzare per ipotesi non eseguite. 1 riga.
6. Una regola operativa concreta per la prossima sessione (es. cosa monitorare nel prossimo blocco). NON suggerire "chiudere ipotesi entro fine sessione": le ipotesi si chiudono a EOD o quando si invalidano davvero. 1 riga.

VINCOLI HARD:
- Massimo 6 righe totali, NIENTE intro, NIENTE conclusioni, NIENTE markdown bold/italic.
- Se i trade < 3: dichiaralo nella riga 1, riduci a 3-4 righe totali (no pattern stat).
- Se trade=0 ma ipotesi/bias presenti: commenta comunque la disciplina del NON aver tradato (era setup valido o assenza giustificata?).
- Output deve stare sotto i 800 caratteri per leggibilità Telegram.`;
        peterCommento = (await callClaude(prompt, ANTHROPIC_API_KEYS, 1000)).trim();
      } catch (e) {
        const msg = (e as Error).message || "";
        const transient = /overload|rate.?limit|429|529|503|timeout/i.test(msg);
        peterCommento = transient
          ? "<i>Servizio AI sovraccarico al momento. Debrief Peter posticipato — rilancia manualmente piu tardi.</i>"
          : `<i>Debrief Peter non disponibile (${msg.slice(0, 80)}).</i>`;
      }
    }

    // ===== 8. Box Rodrigo =====
    let rodrigoBlock: { tipo: string; testo?: string; todo?: Array<{ ok: boolean; label: string }> } = { tipo: info.scope };

    if (info.scope === "lifestyle") {
      const { data: giornata } = await supabase.from("giornate")
        .select("marea").eq("data", today).maybeSingle();
      const mareaOra = (giornata?.marea || "").toString();
      const mareaHH = parseInt((mareaOra.split(":")[0] || "-1"), 10);
      const mareaInPausa = mareaHH >= 11 && mareaHH < 15;
      try {
        const prompt = `Sei Rodrigo, assistente operativo del Trade Desk.

L'utente ha appena chiuso la sessione di Londra (sono le 10:00 UTC). Ha qualche ora di pausa prima della sessione di New York alle 13:30 UTC.

BASSA MAREA OGGI A RABAT: ${mareaOra || "n.d."} (il campo "marea" contiene SEMPRE l'orario della bassa marea, mai dell'alta — non inventare un'alta marea).

Suggeriscigli in UNA sola frase asciutta come passare la pausa:
- Se la bassa marea cade nella pausa (11:00-14:30 Casablanca): proponigli di andare al mare.
- Altrimenti: scegli tra "fare sport" o "passare tempo con la famiglia". Variabile, non sempre la stessa.

Italiano. Una frase. Niente motivazione vuota, niente parolacce, niente formule fatte. Tono pratico da compagno operativo.`;
        rodrigoBlock.testo = (await callClaude(prompt, ANTHROPIC_API_KEYS, 100)).trim();
      } catch (e) {
        rodrigoBlock.testo = mareaInPausa ? `Bassa marea alle ${mareaOra}. Vai al mare.` : "Pausa: muoviti un'ora o stai con la famiglia.";
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
          const ora = new Date(t.data).toISOString().slice(11, 16);
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
