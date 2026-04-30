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
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0];

    let tradesQuery = supabase.from("trades")
      .select("asset, direzione, esito, pnl, pips, rr_reale, rr_teorico, size, sorgente, data, mood, volatilita, note")
      .order("data", { ascending: false });

    if (assistantMode === "giornaliero") {
      tradesQuery = tradesQuery.gte("data", today + "T00:00:00").lte("data", today + "T23:59:59");
    } else if (assistantMode === "coach") {
      tradesQuery = tradesQuery.gte("data", fourteenDaysAgo + "T00:00:00").limit(60);
    } else {
      tradesQuery = tradesQuery.limit(60);
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

    const smileLimit = assistantMode === "giornaliero" ? 10 : assistantMode === "coach" ? 20 : 40;
    const { data: smile } = await supabase.from("monitora_smile")
      .select("mindset, volatilita, sorgente, created_at")
      .order("created_at", { ascending: false }).limit(smileLimit);
    if (smile && smile.length) dbContext += "\n\n## MONITORASMILE:\n" + JSON.stringify(smile);

    const { data: sessioni } = await supabase.from("sessioni")
      .select("nome, data, mood, coin_data").eq("data", today);
    if (sessioni && sessioni.length) dbContext += "\n\n## SESSIONI DI OGGI:\n" + JSON.stringify(sessioni);

    // Eventi macro di oggi (calendario ForexFactory). Servono a Rodrigo per:
    // 1) sapere cosa esce oggi quando l'utente chiede; 2) compilare valore_effettivo
    //    quando l'utente glielo dice (il trigger Postgres genera poi commento_rodrigo).
    const { data: allert } = await supabase.from("allert")
      .select("id, titolo, valuta, ora_evento, impatto, valore_atteso, valore_precedente, valore_effettivo")
      .eq("data_evento", today)
      .order("ora_evento", { ascending: true });
    if (allert && allert.length) dbContext += "\n\n## EVENTI MACRO DI OGGI (allert):\n" + JSON.stringify(allert);

    const { data: usd } = await supabase.from("forza_usd")
      .select("usd_strength, created_at").order("created_at", { ascending: false }).limit(1);
    if (usd && usd.length) dbContext += `\n\n## FORZA USD ATTUALE: ${usd[0].usd_strength}`;

    const biasLimit = assistantMode === "giornaliero" ? 5 : assistantMode === "coach" ? 12 : 25;
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
        .select("data, titolo").order("data", { ascending: false }).limit(10);
      if (cronache && cronache.length) dbContext += "\n\n## CRONACHE:\n" + JSON.stringify(cronache);

      const { data: settimane } = await supabase.from("settimane")
        .select("data_inizio, data_fine, review, note, pnl, winrate").order("data_inizio", { ascending: false }).limit(6);
      if (settimane && settimane.length) dbContext += "\n\n## SETTIMANE:\n" + JSON.stringify(settimane);

      const { data: giornate } = await supabase.from("giornate")
        .select("data, mindset, volatilita, pnl, note_domani, day_tags").order("data", { ascending: false }).limit(20);
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
Quando l'utente ti chiede di modificare dati, rispondi normalmente MA aggiungi alla fine del messaggio un blocco JSON db_actions con un array di azioni. Tutte le azioni dell'array sono eseguite in sequenza dal backend e ricevi feedback OK/ERRORE.

Azioni supportate (USA ESATTAMENTE QUESTI VALORI di "action"):

1. update - aggiorna campi di una riga esistente:
\`\`\`db_actions
[{"table":"giornate","action":"update","match":{"data":"2026-04-26"},"data":{"mindset":"focused"}}]
\`\`\`

2. insert - crea una nuova riga (NON usarlo se la riga gia esiste, fallisce per UNIQUE):
\`\`\`db_actions
[{"table":"bias","action":"insert","data":{"data":"2026-04-26","asset":"XAUUSD","direzione":"LONG","commento":"..."}}]
\`\`\`
IMPORTANTE: NON usare MAI insert su "sessioni". Le 3 righe (asia, london, newyork) sono create automaticamente quando l'utente apre la giornata (trigger su giornate) o dal cron apertura-sessione. Se devi compilare dati di sessione usa SEMPRE update o update_coin con match {"data":"YYYY-MM-DD","nome":"london|newyork|asia"}. Il backend rifiuta gli insert su sessioni.

3. update_coin - merge non-distruttivo su una chiave dentro coin_data jsonb. Funziona per sessioni E cronache (entrambe hanno colonna coin_data). Mantiene i campi esistenti (commento/sentiment/screenshot) e sovrascrive solo quelli passati in "data":
\`\`\`db_actions
[{"table":"cronache","action":"update_coin","match":{"data":"2026-04-24"},"coin":"XAUUSD","data":{"low":"4657.69","high":"4740.42","open":"4692.44","close":"4707.41","percentuale":"+0.32"}}]
\`\`\`

Tabelle scrittura: sessioni (coin_data, mood, nome, data), giornate (mindset, volatilita, note_domani, fajr, marea, day_tags), trades (note, mood, volatilita - solo se non completato), bias (asset, direzione, commento), cronache (coin_data, titolo), settimane (review, note), strategie (nome, ipotesi, regole_ingresso, gestione_rischio, asset, tipo, timeframe, note, stato, winrate), allert (SOLO valore_effettivo, screenshot).

NOTIZIE MACRO (tabella allert):
- Quando l'utente ti dice il valore attuale di una notizia uscita ("Advance GDP attuale 2.0%", "il PCE e' stato 0.3%", "Unemployment Claims 189K"), DEVI aggiornare valore_effettivo della riga in allert.
- Trovi gli eventi del giorno nel blocco "## EVENTI MACRO DI OGGI (allert)" qui sopra: ognuno ha id, titolo, valuta, ora_evento.
- USA SEMPRE l'id come match (titolo + valuta non sono unique tra date diverse).
- valore_effettivo deve essere una STRINGA con il formato del feed: "2.0%", "0.3%", "189K", "2.15%". Non rimuovere il simbolo % o la K.
- NON serve scrivere commento_rodrigo: un trigger Postgres lo genera in automatico ~5-10 secondi dopo l'update.
- NON modificare data_evento, ora_evento, ff_id, impatto, titolo, valuta, valore_atteso, valore_precedente.
Esempio:
\`\`\`db_actions
[{"table":"allert","action":"update","match":{"id":"2b6f4d0a-d293-4a95-8daf-e85cfda9b0e8"},"data":{"valore_effettivo":"2.0%"}}]
\`\`\`

NOTA strategie.regole_ingresso e' un ARRAY JSONB di stringhe. Per modificarlo via update, includi nell'UPDATE l'array INTERO con la modifica applicata: leggi l'array dal contesto sopra, ricostruiscilo con la modifica e passalo per intero. Esempio: per aggiungere "EURUSD" alla riga "Strumenti ammessi: XAU, BTC" della strategia "Chiusura FVG", invia un update con il nuovo array completo che include la riga modificata "Strumenti ammessi: XAU, BTC, EURUSD". MAI passare un array parziale, sovrascrive tutto.

CONTRATTO coin_data (l'EA MT4 e il frontend si aspettano questo formato esatto):
- Coin canoniche: XAUUSD, US30, GER30, NAS100, BTCUSD, EURUSD (NON usare DJI/GER40/NASDAQ).
- TUTTI I VALORI VANNO PASSATI COME STRINGHE, MAI COME NUMERI.

Campi per tabella (DIVERSI tra sessioni e cronache):

(A) sessioni.coin_data → low, high (obbligatori per range), + bias/commento/screenshot opzionali:
  - low/high: stringhe del numero (range min/max della sessione), es. "4666.55".
  - bias: ENUM "LONG" | "SHORT" | "NEUTRAL" (uppercase) — bias direzionale dell'utente sulla coin in quella sessione.
  - commento: stringa libera.
  - screenshot: URL stringa.
  Esempio completo: {"XAUUSD":{"low":"4666.55","high":"4701.08","bias":"LONG","commento":"reattivo a 4680"}}
  NON aggiungere open/close/percentuale: quelli sono solo per cronache.

(B) cronache.coin_data → low, high, open, close, percentuale (giornaliero completo):
  - low/high/open/close: stringa del numero, es. "4657.69" o "73861".
  - percentuale: stringa con SEGNO ESPLICITO + o -, es. "+0.32" oppure "-1.03". Senza simbolo % alla fine.
  - Frontend cronache.html fa percentuale.includes('+') per colorare la card: se passi un number, crasha tutto.

Campi opzionali validi su entrambe:
- sentiment: stringa ENUM ESATTA, valori ammessi SOLO: "rialzista" | "laterale" | "ribassista". TUTTO LOWERCASE, NIENTE qualificatori (NO "RIALZISTA FORTE", NO "rialzista_moderato", NO "RIBASSISTA"). NB: per sessioni si usa "bias" (LONG/SHORT/NEUTRAL), non "sentiment".
- screenshot, commento: stringhe libere.

NON usare nomi alternativi: usa "percentuale", non "pct"; "low/high/open/close" non "l/h/o/c".

Quando compili cronache di piu giornate, usa update_coin per ogni coin di ogni giornata: la riga cronache con quella data esiste gia, devi solo aggiungere i dati. NON usare insert su cronache esistenti.

NON puoi: chiudere trade, eliminare record, creare bias operativi. Conferma sempre con poche parole cosa hai fatto e attendi il blocco "_Azioni eseguite_" che il backend appende al tuo messaggio.`;

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
- Output con metriche precise, confronto vs baseline (finestra dati = ultimi 14gg, dichiara la finestra esplicitamente), segnali su compilazione incompleta (screenshot mancanti, strategia non collegata, note vuote).

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

PROTOCOLLO TV-DUMP (compilazione cronache da analisi TradingView):

L'utente lavora con Claude Code + MCP TradingView Desktop e ti incolla in chat l'output di prompt template standard. Riconosci due intestazioni:
- "📋 analisi_giornaliera_xau" (o altro asset) = dump completo per sessione (Asia/London/NY) con push direzionali
- "📊 picchi_volume_only" = ranking top picchi volumetrici della giornata

Quando ricevi uno o entrambi questi dump, il tuo job e:
1. Estrarre 5-7 picchi volumetrici e formattarli nel TAG CANONICO PICCHI:
   "HH:MM Xk N.Nx Rpt DIR SESSIONE"
   - HH:MM = ora candela in UTC+1 (Casablanca)
   - Xk = volume / 1000 con 1 decimale (es. 16.5k, 20.2k)
   - N.Nx = ratio rispetto media giornaliera, 1 decimale
   - Rpt = range in punti, intero (es. 18pt, 9pt)
   - DIR = UP o DN
   - SESSIONE = Asia / London / NY
   Esempio: "15:05 16.5k 3.9x 18pt UP NY"
   Ordina per volume decrescente (top picchi prima).

2. Estrarre 3-6 sbilanciamenti direzionali e formattarli nel TAG CANONICO SBILANCIAMENTI:
   "HH:MM[-HH:MM] DIR ±Rpt SESSIONE [nota]"
   - HH:MM o range HH:MM-HH:MM se cluster
   - DIR = UP o DN
   - ±Rpt = range cumulato del cluster, con segno (+ per UP, - per DN)
   - SESSIONE = Asia / London / NY
   - nota opzionale: "fakeout", "rally", "rejection", ecc.
   Esempio: "12:05-12:25 UP +38pt London", "14:30 DN -10pt NY fakeout"
   Ordina cronologicamente.

3. Generare un commento generale 3-6 righe che sintetizzi:
   - Direzione netta della giornata (bidirezionale, trend, range-bound)
   - Le 1-2 spinte principali con range cumulato
   - Eventuali pattern notevoli (fakeout + reversal, distribution dopo top, ecc.)
   - Volume peak del giorno e cosa significa contestualmente
   Asciutto, no motivational, tono da analista.

4. Emettere AUTOMATICAMENTE un blocco db_actions con un solo update_coin per scrivere tutto in cronache.coin_data per la coin/data analizzata. RICORDATI: tutti i valori numerici come stringhe (vedi CONTRATTO coin_data sopra). picchi_volume e sbilanciamenti sono ARRAY DI STRINGHE.

Esempio db_actions per XAU del 2026-04-24:
\`\`\`db_actions
[{"table":"cronache","action":"update_coin","match":{"data":"2026-04-24"},"coin":"XAUUSD","data":{"picchi_volume":["16:45 20.2k 4.8x 9pt DN NY","15:05 16.5k 3.9x 18pt UP NY"],"sbilanciamenti":["12:05-12:25 UP +38pt London","14:35-15:10 UP +39pt NY rally"],"commento":"Giornata bidirezionale..."}}]
\`\`\`

Mai chiedere conferma prima di compilare: l'utente ti manda il dump perche vuole che tu compili.

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
        max_tokens: 4096,
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
                actionsExecuted.push("ERRORE update " + act.table + ": " + error.message);
              } else {
                actionsExecuted.push("OK: aggiornato " + act.table + " " + JSON.stringify(act.data));
              }
            } else if (act.action === "insert" && act.table && act.data) {
              // sessioni: la riga la crea sempre la edge function apertura-sessione (cron 08:00/14:30 Casa).
              // Bloccare insert qui evita duplicati: l'assistente deve usare update / update_coin.
              if (act.table === "sessioni") {
                actionsExecuted.push("ERRORE insert sessioni: NON consentito, usa update_coin (riga creata da apertura-sessione)");
              } else {
                const { error } = await supabase.from(act.table).insert(act.data);
                if (error) {
                  actionsExecuted.push("ERRORE insert " + act.table + ": " + error.message);
                } else {
                  actionsExecuted.push("OK: inserito in " + act.table);
                }
              }
            } else if (act.action === "update_coin" && act.table && act.match && act.coin && act.data) {
              // Funziona per qualunque tabella con colonna coin_data jsonb (sessioni, cronache, ...).
              let query = supabase.from(act.table).select("coin_data");
              for (const [k, v] of Object.entries(act.match)) {
                query = query.eq(k, v);
              }
              const { data: row, error: selErr } = await query.maybeSingle();
              if (selErr) {
                actionsExecuted.push("ERRORE update_coin select " + act.table + ": " + selErr.message);
              } else if (!row) {
                actionsExecuted.push("ERRORE update_coin: nessuna riga in " + act.table + " con " + JSON.stringify(act.match));
              } else {
                const coinData = row.coin_data || {};
                if (!coinData[act.coin]) coinData[act.coin] = {};
                Object.assign(coinData[act.coin], act.data);
                let updateQuery = supabase.from(act.table).update({ coin_data: coinData });
                for (const [k, v] of Object.entries(act.match)) {
                  updateQuery = updateQuery.eq(k, v);
                }
                const { error } = await updateQuery;
                if (error) {
                  actionsExecuted.push("ERRORE update_coin " + act.table + ": " + error.message);
                } else {
                  actionsExecuted.push("OK: aggiornato " + act.coin + " in " + act.table);
                }
              }
            } else {
              actionsExecuted.push("AZIONE NON SUPPORTATA: action=" + act.action + " table=" + (act.table || "?"));
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
