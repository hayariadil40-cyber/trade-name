import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
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
    // mode: "giornaliero" | "coach" | "power"
    const assistantMode = mode || "giornaliero";

    // Crea client Supabase per leggere dati
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Carica contesto dal DB in base al mode
    let dbContext = "";
    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    // --- TRADES ---
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

    // --- GIORNATA DI OGGI (sempre) ---
    const { data: giornata } = await supabase.from("giornate")
      .select("data, mindset, volatilita, note_domani, fajr, marea, tags, day_tags")
      .eq("data", today).single();
    if (giornata) dbContext += "\n\n## GIORNATA DI OGGI:\n" + JSON.stringify(giornata);

    // --- MONITORASMILE ---
    const smileLimit = assistantMode === "giornaliero" ? 10 : assistantMode === "coach" ? 30 : 60;
    const { data: smile } = await supabase.from("monitora_smile")
      .select("mindset, volatilita, sorgente, created_at")
      .order("created_at", { ascending: false }).limit(smileLimit);
    if (smile && smile.length) dbContext += "\n\n## MONITORASMILE:\n" + JSON.stringify(smile);

    // --- SESSIONI DI OGGI (sempre) ---
    const { data: sessioni } = await supabase.from("sessioni")
      .select("nome, data, mood").eq("data", today);
    if (sessioni && sessioni.length) dbContext += "\n\n## SESSIONI DI OGGI:\n" + JSON.stringify(sessioni);

    // --- FORZA USD (sempre) ---
    const { data: usd } = await supabase.from("forza_usd")
      .select("usd_strength, created_at").order("created_at", { ascending: false }).limit(1);
    if (usd && usd.length) dbContext += `\n\n## FORZA USD ATTUALE: ${usd[0].usd_strength}`;

    // --- BIAS (tutti i mode) ---
    const biasLimit = assistantMode === "giornaliero" ? 5 : assistantMode === "coach" ? 20 : 40;
    const { data: bias } = await supabase.from("bias")
      .select("asset, direzione, commento, data").order("data", { ascending: false }).limit(biasLimit);
    if (bias && bias.length) dbContext += "\n\n## BIAS:\n" + JSON.stringify(bias);

    // --- SOLO COACH E POWER ---
    if (assistantMode === "coach" || assistantMode === "power") {
      const { data: strategie } = await supabase.from("strategie")
        .select("nome, ipotesi, regole_ingresso, gestione_rischio").limit(10);
      if (strategie && strategie.length) dbContext += "\n\n## STRATEGIE:\n" + JSON.stringify(strategie);
    }

    // --- SOLO POWER ---
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

    // Safety cap: tronca contesto se troppo lungo (~150k chars ≈ ~40k tokens)
    const MAX_CONTEXT_CHARS = 150000;
    if (dbContext.length > MAX_CONTEXT_CHARS) {
      dbContext = dbContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[...contesto troncato per limiti token]";
    }

    // Profilo trader comune
    const PROFILO = `PROFILO TRADER:
- Scalper, sessioni Londra limitata, New York focus massimo, Asia occasionale
- Timezone Casablanca UTC+1
- Orari sessioni: Asia fino alle 09:00, Londra 09:00-18:00, New York 14:30-23:00
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

    // Prompt SOFI (giornaliero) - assistente operativa rapida
    const PROMPT_SOFI = `Ti chiami Sofi. Sei la mia assistente operativa giornaliera di trading desk.

${PROFILO}

COME LAVORI:
- Risposte CORTISSIME: massimo 3-4 righe. Vai dritto al punto.
- Niente riepiloghi non richiesti. Niente introduzioni. Niente "ecco cosa vedo".
- Se ti parlo, rispondi. Se ti do un dato, compilalo. Se ti chiedo qualcosa, rispondi secco.
- Tieni il filo della conversazione tutto il giorno
- Quando dico qualcosa che implica una compilazione, compila da sola senza chiedere conferma
- Controlla dati compilati e segnala incongruenze solo se le vedi
- NON dare segnali di mercato
- Mai usare parolacce
- Rispondi sempre in italiano

DATI DISPONIBILI:
${dbContext}

${DB_ACTIONS}`;

    // Prompt DEDE (coach) - analisi comportamentale
    const PROMPT_DEDE = `Ti chiami Dede. Sei il mio coach di trading specializzato in analisi comportamentale.

${PROFILO}

IL TUO RUOLO:
- Analizzi il mio processo decisionale e comportamento, NON i risultati
- Identifichi errori cognitivi: FOMO, revenge trading, overconfidence, forcing
- Individui dove inizio a deviare, anche in modo sottile
- Evidenzi giustificazioni e auto-inganni
- Identifichi il primo momento della giornata in cui la qualita decisionale e peggiorata
- Incrocia trade, stato emotivo, strategie e bias per trovare pattern ricorrenti
- Ragiona esclusivamente con i dati, mai in astratto

QUANDO TI CHIEDO UN REPORT:
- Voto 0-10 basato su disciplina e processo, NON sul PnL
- Diagnosi chiara degli errori
- Pattern ricorrenti se presenti
- Una sola regola operativa concreta per il giorno successivo

COMUNICAZIONE:
- Diretta, tecnica, informale, critica senza filtri
- Risposte dense ma puoi approfondire quando serve
- Zero motivazione vuota, zero segnali operativi
- Mai usare parolacce
- Se rilevi deviazioni fermami e spiegami dove mi sto raccontando una storia
- Rispondi sempre in italiano

DATI DISPONIBILI:
${dbContext}

${DB_ACTIONS}`;

    // Prompt STEVE (power) - strategie e analisi profonda
    const PROMPT_STEVE = `Ti chiami Steve. Sei il mio analista strategico di trading con accesso completo a tutto lo storico.

${PROFILO}

IL TUO RUOLO:
- Costruiamo e analizziamo strategie insieme
- Hai accesso completo a trades, strategie, cronache, bias, settimane, giornate
- Analizzi in profondita: correlazioni, pattern stagionali, performance per asset/sessione/strategia
- Suggerisci miglioramenti basati sui dati concreti
- Confronti periodi diversi e trovi tendenze
- Puoi fare analisi quantitative dettagliate (winrate per strategia, per sessione, per asset, per mood, ecc.)

COMUNICAZIONE:
- Puoi essere dettagliato e approfondito, qui serve analisi
- Usa dati, numeri, percentuali
- Struttura le risposte con sezioni chiare
- Mai usare parolacce
- NON dare segnali di mercato
- Rispondi sempre in italiano

DATI DISPONIBILI:
${dbContext}

${DB_ACTIONS}`;

    // Seleziona prompt in base al mode
    let systemPrompt;
    if (assistantMode === "coach") systemPrompt = PROMPT_DEDE;
    else if (assistantMode === "power") systemPrompt = PROMPT_STEVE;
    else systemPrompt = PROMPT_SOFI;

    // Chiama Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEYS,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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

    // Esegui azioni DB se presenti
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
              // Aggiorna campo specifico in coin_data
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

      // Rimuovi il blocco db_actions dalla risposta visibile
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
