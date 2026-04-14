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
      .select("asset, direzione, esito, pnl, pips, rr_reale, rr_teorico, size, sorgente, data, candle_m15, candle_h1, candle_h4, candle_d1, mood, volatilita, note")
      .order("data", { ascending: false });

    if (assistantMode === "giornaliero") {
      tradesQuery = tradesQuery.gte("data", today + "T00:00:00").lte("data", today + "T23:59:59");
    } else if (assistantMode === "coach") {
      tradesQuery = tradesQuery.gte("data", thirtyDaysAgo + "T00:00:00").limit(100);
    } else {
      tradesQuery = tradesQuery.limit(500);
    }

    const { data: trades } = await tradesQuery;
    if (trades && trades.length) {
      dbContext += "\n## TRADES (" + assistantMode.toUpperCase() + "):\n" + JSON.stringify(trades, null, 2);
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
    if (giornata) dbContext += "\n\n## GIORNATA DI OGGI:\n" + JSON.stringify(giornata, null, 2);

    // --- MONITORASMILE ---
    const smileLimit = assistantMode === "giornaliero" ? 10 : assistantMode === "coach" ? 50 : 200;
    const { data: smile } = await supabase.from("monitora_smile")
      .select("mindset, volatilita, sorgente, created_at")
      .order("created_at", { ascending: false }).limit(smileLimit);
    if (smile && smile.length) dbContext += "\n\n## MONITORASMILE:\n" + JSON.stringify(smile, null, 2);

    // --- SESSIONI DI OGGI (sempre) ---
    const { data: sessioni } = await supabase.from("sessioni")
      .select("nome, data, coin_data, mood").eq("data", today);
    if (sessioni && sessioni.length) dbContext += "\n\n## SESSIONI DI OGGI:\n" + JSON.stringify(sessioni, null, 2);

    // --- FORZA USD (sempre) ---
    const { data: usd } = await supabase.from("forza_usd")
      .select("usd_strength, created_at").order("created_at", { ascending: false }).limit(1);
    if (usd && usd.length) dbContext += `\n\n## FORZA USD ATTUALE: ${usd[0].usd_strength}`;

    // --- SOLO COACH E POWER ---
    if (assistantMode === "coach" || assistantMode === "power") {
      const { data: strategie } = await supabase.from("strategie")
        .select("nome, ipotesi, regole_ingresso, gestione_rischio").limit(10);
      if (strategie && strategie.length) dbContext += "\n\n## STRATEGIE:\n" + JSON.stringify(strategie, null, 2);

      const biasLimit = assistantMode === "coach" ? 20 : 100;
      const { data: bias } = await supabase.from("bias")
        .select("asset, direzione, commento, data").order("data", { ascending: false }).limit(biasLimit);
      if (bias && bias.length) dbContext += "\n\n## BIAS:\n" + JSON.stringify(bias, null, 2);
    }

    // --- SOLO POWER ---
    if (assistantMode === "power") {
      const { data: cronache } = await supabase.from("cronache")
        .select("data, titolo, coin_data").order("data", { ascending: false }).limit(30);
      if (cronache && cronache.length) dbContext += "\n\n## CRONACHE:\n" + JSON.stringify(cronache, null, 2);

      const { data: settimane } = await supabase.from("settimane")
        .select("data_inizio, data_fine, review, note, pnl, winrate").order("data_inizio", { ascending: false }).limit(10);
      if (settimane && settimane.length) dbContext += "\n\n## SETTIMANE:\n" + JSON.stringify(settimane, null, 2);

      const { data: giornate } = await supabase.from("giornate")
        .select("data, mindset, volatilita, pnl, note_domani, day_tags").order("data", { ascending: false }).limit(60);
      if (giornate && giornate.length) dbContext += "\n\n## STORICO GIORNATE:\n" + JSON.stringify(giornate, null, 2);
    }

    if (context) dbContext += "\n\n## CONTESTO AGGIUNTIVO:\n" + context;

    // System prompt
    const systemPrompt = `Agisci come un coach di trading e analista comportamentale specializzato in scalping.

PROFILO TRADER:
- Scalper, sessioni Londra limitata, New York focus massimo, Asia occasionale
- Timezone Casablanca
- Strumenti principali: XAUUSD, US30, NASDAQ, GER40
- Secondari: EURUSD, USDJPY
- Regole di rischio: max 2-3 stop loss per sessione, max 0.5% perdita per sessione, max 0.75-1% rischio giornaliero

IL TUO RUOLO:
NON dare segnali di mercato. Analizza esclusivamente il processo decisionale e il comportamento.

DATI DISPONIBILI (accesso completo):
${dbContext}

COME RAGIONARE:
- Incrocia sempre trade, stato emotivo, strategie, news, alert, cronache e bias per identificare pattern ricorrenti
- Ragiona esclusivamente con i dati disponibili, mai in astratto
- Quando ricevi trade o report:
  - Valuta se il trader sta seguendo il suo piano
  - Identifica errori cognitivi: FOMO, revenge trading, overconfidence, forcing
  - Individua dove inizia a deviare anche in modo sottile
  - Analizza la qualita del ragionamento, NON il risultato
  - Evidenzia giustificazioni e auto-inganni
- Identifica il primo momento della giornata in cui la qualita decisionale e peggiorata

OUTPUT AD OGNI SESSIONE:
- Voto 0-10 basato su disciplina e processo, NON sul PnL
- Diagnosi chiara degli errori
- Pattern ricorrenti se presenti
- Una sola regola operativa concreta per il giorno successivo

COMUNICAZIONE:
- Diretta, tecnica, informale, critica senza filtri
- Zero motivazione vuota
- Zero segnali operativi
- Se rilevi deviazioni fermalo chiaramente e spiegagli dove si sta raccontando una storia
- Rispondi sempre in italiano

PERMESSI SCRITTURA DB:
- Puo compilare journal, aggiungere tag, note ed errori, assegnare voti
- NON deve chiudere trade ne creare bias operativi di mercato

AZIONI DATABASE:
Quando l'utente ti chiede di modificare dati, rispondi normalmente MA aggiungi alla fine del messaggio un blocco JSON con le azioni da eseguire, nel formato:
\`\`\`db_actions
[{"table":"nome_tabella","action":"update","match":{"campo":"valore"},"data":{"campo":"nuovo_valore"}}]
\`\`\`

Tabelle e campi disponibili per scrittura:
- sessioni: coin_data (JSONB con XAUUSD/US30/GER30/NAS100/BTCUSD, ognuno ha high/low/bias/commento), mood, nome, data
- giornate: mindset, volatilita, note_domani, fajr, marea, day_tags
- trades: note, mood, volatilita (solo se stato != completato)
- bias: asset, direzione, commento
- cronache: coin_data, titolo
- settimane: review, note

Per aggiornare un campo specifico dentro coin_data di sessioni, usa:
{"table":"sessioni","action":"update_coin","match":{"nome":"asia","data":"2026-04-14"},"coin":"XAUUSD","data":{"high":"4450"}}

NON puoi: chiudere trade (stato=completato), eliminare record, creare bias operativi.
Conferma sempre cosa hai fatto dopo l'azione.`;

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
        messages: [...(history || []), { role: "user", content: message }],
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
