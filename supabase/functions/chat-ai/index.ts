import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEYS = Deno.env.get("ANTHROPIC_API_KEYS");
    if (!ANTHROPIC_API_KEYS) {
      return new Response(JSON.stringify({ error: "API key non configurata" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message, context, history, mode } = await req.json();
    // mode: "giornaliero" (Rodrigo) | "coach" (Peter) | "power" (Steve)
    const assistantMode = mode || "giornaliero";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let dbContext = "";
    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    let tradesQuery = supabase.from("trades")
      .select("asset, direzione, esito, pnl, pips, rr_reale, rr_teorico, size, sorgente, data, mood, volatilita, note")
      .order("data", { ascending: false });

    if (assistantMode === "giornaliero") {
      tradesQuery = tradesQuery.gte("data", today + "T00:00:00").lte("data", today + "T23:59:59");
    } else if (assistantMode === "coach") {
      tradesQuery = tradesQuery.gte("data", thirtyDaysAgo + "T00:00:00").limit(100);
    } else {
      tradesQuery = tradesQuery.limit(150);
    }

    const { data: trades } = await tradesQuery;
    if (trades && trades.length) {
      dbContext += "\n## TRADES (" + assistantMode.toUpperCase() + "):\n" + JSON.stringify(trades);
      const completed = trades.filter((t: any) => t.esito === "win" || t.esito === "loss");
      const wins = completed.filter((t: any) => t.esito === "win").length;
      const totalPnl = trades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl) || 0), 0);
      const winrate = completed.length > 0 ? Math.round((wins / completed.length) * 100) : 0;
      dbContext += `\n\n## STATISTICHE:\n- Win Rate: ${winrate}%\n- Trades completati: ${completed.length}\n- P/L totale: $${totalPnl.toFixed(2)}\n- Wins: ${wins}, Losses: ${completed.length - wins}`;
    }

    const { data: giornata } = await supabase.from("giornate")
      .select("data, mindset, volatilita, note_domani, fajr, marea, tags, day_tags")
      .eq("data", today).single();
    if (giornata) dbContext += "\n\n## GIORNATA DI OGGI:\n" + JSON.stringify(giornata);

    const smileLimit = assistantMode === "giornaliero" ? 10 : assistantMode === "coach" ? 30 : 60;
    const { data: smile } = await supabase.from("monitora_smile")
      .select("mindset, volatilita, sorgente, created_at")
      .order("created_at", { ascending: false }).limit(smileLimit);
    if (smile && smile.length) dbContext += "\n\n## MONITORASMILE:\n" + JSON.stringify(smile);

    const { data: sessioni } = await supabase.from("sessioni")
      .select("nome, data, mood").eq("data", today);
    if (sessioni && sessioni.length) dbContext += "\n\n## SESSIONI DI OGGI:\n" + JSON.stringify(sessioni);

    const { data: usd } = await supabase.from("forza_usd")
      .select("usd_strength, created_at").order("created_at", { ascending: false }).limit(1);
    if (usd && usd.length) dbContext += `\n\n## FORZA USD ATTUALE: ${usd[0].usd_strength}`;

    const biasLimit = assistantMode === "giornaliero" ? 5 : assistantMode === "coach" ? 20 : 40;
    const { data: bias } = await supabase.from("bias")
      .select("asset, direzione, commento, data").order("data", { ascending: false }).limit(biasLimit);
    if (bias && bias.length) dbContext += "\n\n## BIAS:\n" + JSON.stringify(bias);

    if (assistantMode === "coach" || assistantMode === "power") {
      const { data: strategie } = await supabase.from("strategie")
        .select("nome, ipotesi, regole_ingresso, gestione_rischio").limit(10);
      if (strategie && strategie.length) dbContext += "\n\n## STRATEGIE:\n" + JSON.stringify(strategie);
    }

    if (assistantMode === "power") {
      const { data: cronache } = await supabase.from("cronache")
        .select("data, titolo").order("data", { ascending: false }).limit(15);
      if (cronache && cronache.length) dbContext += "\n\n## CRONACHE:\n" + JSON.stringify(cronache);

      const { data: settimane } = await supabase.from("settimane")
        .select("data_inizio, data_fine, review, note, pnl, winrate").order("data_inizio", { ascending: false }).limit(10);
      if (settimane && settimane.length) dbContext += "\n\n## SETTIMANE:\n" + JSON.stringify(settimane);

      const { data: giornate } = await supabase.from("giornate")
        .select("data, mindset, volatilita, pnl, note_domani, day_tags").order("data", { ascending: false }).limit(30);
      if (giornate && giornate.length) dbContext += "\n\n## STORICO GIORNATE:\n" + JSON.stringify(giornate);
    }

    if (context) dbContext += "\n\n## CONTESTO AGGIUNTIVO:\n" + context;

    const MAX_CONTEXT_CHARS = 150000;
    if (dbContext.length > MAX_CONTEXT_CHARS) {
      dbContext = dbContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[...contesto troncato per limiti token]";
    }

    const PROFILO = `PROFILO TRADER:
- Scalper retail con base a Casablanca (timezone Africa/Casablanca, UTC+1, no DST)
- Sessioni: Londra limitata, New York focus massimo, Asia occasionale
- Orari sessioni (Casablanca): Asia fino alle 09:00, Londra 09:00-18:00, New York 14:30-23:00
- Strumenti principali: XAUUSD, US30, NASDAQ, GER40
- Secondari: EURUSD, USDJPY
- Regole di rischio: max 2-3 stop loss per sessione, max 0.5% perdita per sessione, max 0.75-1% rischio giornaliero`;

    const DB_ACTIONS = `AZIONI DATABASE:
Quando l'utente ti chiede di modificare dati, rispondi normalmente MA aggiungi alla fine del messaggio un blocco JSON:
\`\`\`db_actions
[{"table":"nome_tabella","action":"update","match":{"campo":"valore"},"data":{"campo":"nuovo_valore"}}]
\`\`\`
Tabelle scrittura: sessioni (coin_data, mood, nome, data), giornate (mindset, volatilita, note_domani, fajr, marea, day_tags), trades (note, mood, volatilita - solo se non completato), bias (asset, direzione, commento), cronache (coin_data, titolo), settimane (review, note).
Per coin_data sessioni: {"table":"sessioni","action":"update_coin","match":{"nome":"asia","data":"2026-04-14"},"coin":"XAUUSD","data":{"high":"4450"}}
NON puoi: chiudere trade, eliminare record, creare bias operativi. Conferma cosa hai fatto.`;

    const REGOLE_COMUNI = `REGOLE COMUNI:
- Italiano. Sempre.
- Mai parolacce, mai linguaggio volgare o colloquiale pesante. Inammissibile.
- Mai inventare dati: se un dato manca, dichiaralo invece di ipotizzare.
- Non dare segnali operativi di mercato.`;

    const PROMPT_RODRIGO = `Ti chiami Rodrigo. Sei l'assistente operativo giornaliero del Trade Desk.

${PROFILO}

IL TUO RUOLO:
- Sei il compagno operativo: ricordi, compili su richiesta, sintetizzi.
- Tono: pratico, sveglio, mai lungo. Puoi bacchettare ma in modo professionale. Niente filosofia, niente motivational speech, niente empatia performativa.
- Risposte CORTISSIME: massimo 3-4 righe. Dritto al punto. Niente introduzioni, niente "ecco cosa vedo", niente riepiloghi non richiesti.
- Tieni il filo della conversazione tutto il giorno.
- Quando l'utente dice qualcosa che implica una compilazione, compila da solo senza chiedere conferma.
- Controlli i dati compilati e segnali incongruenze solo se le vedi.
- Output tipico: nudge brevi, promemoria mirati ("ti manca X", "hai ancora Y aperto alle Z"), riepiloghi operativi.

LIMITI DI ACCESSO:
- NON hai accesso alla tabella watchlist. Non e dato di tua competenza.

${REGOLE_COMUNI}

DATI DISPONIBILI:
${dbContext}

${DB_ACTIONS}`;

    const PROMPT_PETER = `Ti chiami Peter. Sei il mental coach analista comportamentale del Trade Desk.

${PROFILO}

IL TUO RUOLO:
- Analizzi il processo decisionale e il comportamento dell'utente sul campo, NON i risultati in se.
- Identifichi errori cognitivi: FOMO, revenge trading, overconfidence, forcing, anchoring.
- Individui dove l'utente inizia a deviare, anche in modo sottile.
- Evidenzi giustificazioni e auto-inganni nelle note dei trade.
- Identifichi il primo momento della giornata in cui la qualita decisionale e peggiorata.
- Incroci trade, stato emotivo (MonitoraSmile), strategie, bias e compilazione per trovare pattern ricorrenti.
- Ragioni esclusivamente con i dati. Mai in astratto. Mai per analogia.

REGOLE CRITICHE DI POSTURA (l'utente le ha richieste esplicitamente):
- Sei un analista clinico, obiettivo, distaccato. NON sei un coach motivazionale da palestra. Niente "credi in te stesso", niente Mr. Miyagi, niente frasi fatte motivazionali.
- NON presumere pattern. Se un pattern emerge dai dati, segnalalo SEMPRE con livello di confidenza statistica esplicito (es. "n=4, campione debole, possibile rumore" oppure "n=23 su 3 mesi, segnale robusto"). L'utente e consapevole che tendi a presumere pattern e vuole correggere verso l'oggettivita.
- Vedi tutti i dati (trade, bias, sessioni, giornate, mindset, forza USD, cronache) ma filtri attraverso la lente del trading performance. Non commenti la vita, commenti come si opera.
- Output con metriche precise, confronto vs baseline 30gg, segnali su compilazione incompleta (screenshot mancanti, strategia non collegata, note vuote).

QUANDO L'UTENTE TI CHIEDE UN REPORT/DEBRIEF:
- Voto 0-10 basato su disciplina e processo, NON sul PnL.
- Diagnosi chiara degli errori della sessione/giornata.
- Pattern ricorrenti se presenti, sempre con confidenza statistica.
- Una sola regola operativa concreta per il giorno successivo.

COMUNICAZIONE:
- Diretta, tecnica, informale ma asciutta, critica senza filtri.
- Risposte dense ma puoi approfondire quando il dato lo richiede.
- Zero motivazione vuota, zero segnali operativi di mercato.
- Se rilevi deviazioni fermalo e mostragli dove si sta raccontando una storia.

${REGOLE_COMUNI}

DATI DISPONIBILI:
${dbContext}

${DB_ACTIONS}`;

    const PROMPT_STEVE = `Ti chiami Steve. Sei il calcolatore strategico del Trade Desk, usato raramente per analisi quantitative profonde e lavoro di costruzione/raffinamento strategie.

${PROFILO}

IL TUO RUOLO:
- Costruzione e analisi strategie con dati duri.
- Hai accesso completo: trades, strategie, cronache, bias, settimane, giornate, MonitoraSmile.
- Analisi quantitative dettagliate: winrate per strategia/sessione/asset/mood, R:R medio reale vs teorico, distribuzioni P/L, drawdown, correlazioni tra variabili.
- Pattern stagionali, confronti pre/post modifiche di strategia.
- Suggerimenti di regola basati su evidenza numerica, mai su intuizione.

COMUNICAZIONE:
- Numerico, conciso, zero fronzoli. Poche parole, dati solidi.
- Tabelle quando aiutano la lettura (formato testo allineato).
- Sezioni chiare quando la risposta e strutturata (es. "WINRATE PER ASSET:", "DISTRIBUZIONE P/L:").
- Dichiara sempre la dimensione del campione quando dai una statistica.
- NON dare segnali operativi di mercato.
- Non sei un assistente per il giorno per giorno: sei usato a richiesta esplicita per studi/modifiche.

${REGOLE_COMUNI}

DATI DISPONIBILI:
${dbContext}

${DB_ACTIONS}`;

    let systemPrompt;
    if (assistantMode === "coach") systemPrompt = PROMPT_PETER;
    else if (assistantMode === "power") systemPrompt = PROMPT_STEVE;
    else systemPrompt = PROMPT_RODRIGO;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEYS,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [...(history || []).slice(-20), { role: "user", content: message }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let reply = data.content?.[0]?.text || "Nessuna risposta";

    const actionMatch = reply.match(/```db_actions\n([\s\S]*?)\n```/);
    let actionsExecuted: string[] = [];

    if (actionMatch) {
      try {
        const actions = JSON.parse(actionMatch[1]);
        for (const act of actions) {
          try {
            if (act.action === "update" && act.table && act.match && act.data) {
              let query = supabase.from(act.table).update(act.data);
              for (const [k, v] of Object.entries(act.match)) {
                query = query.eq(k, v);
              }
              const { error } = await query;
              if (error) {
                actionsExecuted.push("ERRORE " + act.table + ": " + error.message);
              } else {
                actionsExecuted.push("OK: aggiornato " + act.table + " " + JSON.stringify(act.data));
              }
            } else if (act.action === "update_coin" && act.table === "sessioni" && act.coin && act.data) {
              let query = supabase.from("sessioni").select("coin_data");
              for (const [k, v] of Object.entries(act.match)) {
                query = query.eq(k, v);
              }
              const { data: rows } = await query.single();
              if (rows && rows.coin_data) {
                const coinData = rows.coin_data;
                if (!coinData[act.coin]) coinData[act.coin] = {};
                Object.assign(coinData[act.coin], act.data);
                let updateQuery = supabase.from("sessioni").update({ coin_data: coinData });
                for (const [k, v] of Object.entries(act.match)) {
                  updateQuery = updateQuery.eq(k, v);
                }
                const { error } = await updateQuery;
                if (error) {
                  actionsExecuted.push("ERRORE sessione coin: " + error.message);
                } else {
                  actionsExecuted.push("OK: aggiornato " + act.coin + " in sessione " + JSON.stringify(act.data));
                }
              }
            }
          } catch (actionErr) {
            actionsExecuted.push("ERRORE azione: " + (actionErr as Error).message);
          }
        }
      } catch (parseErr) {
        actionsExecuted.push("ERRORE parsing azioni: " + (parseErr as Error).message);
      }

      reply = reply.replace(/```db_actions\n[\s\S]*?\n```/, "").trim();
      if (actionsExecuted.length) {
        reply += "\n\n_Azioni eseguite: " + actionsExecuted.join(", ") + "_";
      }
    }

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
