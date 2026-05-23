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
    const isJumuah = new Date().getDay() === 5; // 0=Dom, 5=Ven
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    let tradesQuery = supabase.from("trades")
      .select("id, asset, direzione, esito, pnl, pips, rr_reale, rr_teorico, size, sorgente, data, mood, volatilita, note, commento_post, ipotesi_id, tag")
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

    // Carica le voci checklist disciplina per decodificare checklist_stato (array boolean)
    const { data: checklistSetting } = await supabase.from("user_settings")
      .select("valore").eq("chiave", "td_checklist").maybeSingle();
    const checklistVoci: string[] = (checklistSetting?.valore as string[]) || [];

    const { data: giornata } = await supabase.from("giornate")
      .select("data, mindset, market, volatilita, note, note_domani, fajr, marea, tags, day_tags, checklist_stato")
      .eq("data", today).single();
    if (giornata) {
      // Decodifica checklist_stato: array boolean -> array "✓/✗ voce"
      let giornataOut: any = { ...giornata };
      if (giornata.checklist_stato && checklistVoci.length) {
        const stati = giornata.checklist_stato as boolean[];
        const checked = stati.filter(Boolean).length;
        giornataOut.checklist_stato = stati.map((v, i) => (v ? "OK" : "MANCANTE") + " — " + (checklistVoci[i] || "item_" + i));
        giornataOut.checklist_score = checked + "/" + stati.length;
      }
      dbContext += "\n\n## GIORNATA DI OGGI:\n" + JSON.stringify(giornataOut)
        + "\n(NB: marea = BASSA marea a Rabat; checklist_stato = voce per voce della checklist disciplina, OK/MANCANTE; note = commento libero del trader sulla giornata; day_tags = etichette rapide)";
    }

    const smileLimit = assistantMode === "giornaliero" ? 10 : assistantMode === "coach" ? 20 : 40;
    const { data: smile } = await supabase.from("monitora_smile")
      .select("mindset, volatilita, sorgente, created_at")
      .order("created_at", { ascending: false }).limit(smileLimit);
    if (smile && smile.length) dbContext += "\n\n## MONITORASMILE:\n" + JSON.stringify(smile);

    {
      let sessioniQuery = supabase.from("sessioni").select("nome, data, mood, coin_data");
      if (assistantMode === "coach") {
        sessioniQuery = sessioniQuery.gte("data", fourteenDaysAgo).order("data", { ascending: false }).limit(30);
      } else {
        sessioniQuery = sessioniQuery.eq("data", today);
      }
      const { data: sessioni } = await sessioniQuery;
      if (sessioni && sessioni.length) {
        // Strip screenshot base64: gonfia il contesto fino a MB e fa troncare le righe successive.
        const sessioniLight = sessioni.map((s: any) => ({
          ...s,
          coin_data: Object.fromEntries(
            Object.entries(s.coin_data || {}).map(([coin, d]: [string, any]) => {
              const { screenshot, ...rest } = d || {};
              return [coin, screenshot ? { ...rest, has_screenshot: true } : rest];
            })
          ),
        }));
        const sessioniLabel = assistantMode === "coach" ? "SESSIONI (ultimi 14gg)" : "SESSIONI DI OGGI";
        dbContext += `\n\n## ${sessioniLabel}:\n` + JSON.stringify(sessioniLight);
      }
    }

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

    const biasLimit = assistantMode === "giornaliero" ? 5 : assistantMode === "coach" ? 40 : 30;
    let biasQuery = supabase.from("bias")
      .select("commenti_giornata, coin_data, stato, data")
      .order("data", { ascending: false }).limit(biasLimit);
    if (assistantMode === "coach") biasQuery = biasQuery.gte("data", thirtyDaysAgo);
    else if (assistantMode === "giornaliero") biasQuery = biasQuery.gte("data", fourteenDaysAgo);
    const { data: bias } = await biasQuery;
    if (bias && bias.length) {
      const biasLight = bias.map((b: any) => ({
        ...b,
        coin_data: b.coin_data ? Object.fromEntries(
          Object.entries(b.coin_data).map(([coin, d]: [string, any]) => {
            const { screenshot, ...rest } = d || {};
            return [coin, rest];
          })
        ) : undefined,
      }));
      dbContext += "\n\n## BIAS (struttura duale: `commenti_giornata` top-level = note generali della giornata {ora, testo}; `coin_data.<ASSET>.aggiornamenti` = timeline per-asset {ora, testo, direzione?} — QUI vivono le direzioni operative. REGOLA: direzione CORRENTE di un asset = ultima `direzione` non-null in `coin_data.<ASSET>.aggiornamenti`. Sequenza long→short = flip intraday, analizzalo come evento cognitivo):\n" + JSON.stringify(biasLight);
    }

    // Ipotesi per Rodrigo: ultime 48h (possono essere aperte da ieri)
    if (assistantMode === "giornaliero") {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
      const { data: ipotesiR } = await supabase.from("ipotesi_trading")
        .select("id, asset, direzione, sessione, stato, note, strategia_id, created_at")
        .gte("created_at", twoDaysAgo + "T00:00:00")
        .order("created_at", { ascending: false }).limit(20);
      if (ipotesiR && ipotesiR.length) dbContext += "\n\n## IPOTESI (ultimi 2gg):\n" + JSON.stringify(ipotesiR);
      // Strategie (solo id+nome): servono per collegare ipotesi a strategia per id
      const { data: strategieR } = await supabase.from("strategie").select("id, nome").order("nome");
      if (strategieR && strategieR.length) dbContext += "\n\n## STRATEGIE (id+nome per collegamento):\n" + JSON.stringify(strategieR);
    }

    if (assistantMode === "coach" || assistantMode === "power") {
      const ipotesiLimit = 20;
      const { data: ipotesi } = await supabase.from("ipotesi_trading")
        .select("id, asset, direzione, sessione, stato, note, osservazioni, commento_post, check_list_flagged, dove_entro_flagged, dove_esco_sl_flagged, dove_esco_tp_flagged, created_at, strategia_id")
        .gte("created_at", fourteenDaysAgo + "T00:00:00")
        .order("created_at", { ascending: false }).limit(ipotesiLimit);
      if (ipotesi && ipotesi.length) {
        // Arricchisci ogni ipotesi con i trade collegati (osservazioni per-trade + commento_post)
        const ipotesiIds = ipotesi.map((ip: any) => ip.id);
        const { data: tradesIpotesi } = await supabase.from("trades")
          .select("id, ipotesi_id, asset, direzione, esito, pnl, data, note, osservazioni, commento_post")
          .in("ipotesi_id", ipotesiIds).order("data", { ascending: true });
        const tradesByIpotesi: Record<string, any[]> = {};
        (tradesIpotesi || []).forEach((t: any) => {
          if (!tradesByIpotesi[t.ipotesi_id]) tradesByIpotesi[t.ipotesi_id] = [];
          tradesByIpotesi[t.ipotesi_id].push(t);
        });
        const ipotesiRich = ipotesi.map((ip: any) => ({
          ...ip,
          trades_collegati: tradesByIpotesi[ip.id] || []
        }));
        dbContext += "\n\n## IPOTESI DI TRADING (con osservazioni template + per-trade e commento_post per trade):\n" + JSON.stringify(ipotesiRich);
      }

      const { data: strategie } = await supabase.from("strategie")
        .select("id, nome, stato, sessione, ipotesi, regole_ingresso, tipo_mercato, dove_entro, dove_esco_sl, dove_esco_tp, gestione_operazione, da_osservare, gestione_rischio, note, asset, tipo, timeframe, winrate")
        .limit(10);
      if (strategie && strategie.length) dbContext += "\n\n## STRATEGIE:\n" + JSON.stringify(strategie);

      // Cronache con coin_data completo (picchi_volume, sbilanciamenti, OHLC, sentiment, commento).
      // Strip dello screenshot base64 inline che gonfia il contesto fino a MB e fa troncare le righe successive.
      const cronacheLimit = assistantMode === "power" ? 10 : 5;
      const { data: cronache } = await supabase.from("cronache")
        .select("data, titolo, coin_data").order("data", { ascending: false }).limit(cronacheLimit);
      if (cronache && cronache.length) {
        const cronacheLight = cronache.map((c: any) => ({
          ...c,
          coin_data: Object.fromEntries(
            Object.entries(c.coin_data || {}).map(([coin, d]: [string, any]) => {
              const { screenshot, ...rest } = d || {};
              return [coin, screenshot ? { ...rest, has_screenshot: true } : rest];
            })
          ),
        }));
        dbContext += "\n\n## CRONACHE:\n" + JSON.stringify(cronacheLight);
      }
    }

    // Storico giornate per Peter: disciplina checklist decodificata su 14gg
    if (assistantMode === "coach") {
      const { data: giornateCoach } = await supabase.from("giornate")
        .select("data, mindset, market, volatilita, note, day_tags, checklist_stato, pnl, n_trades, winrate")
        .gte("data", fourteenDaysAgo)
        .order("data", { ascending: false }).limit(14);
      if (giornateCoach && giornateCoach.length) {
        const giornateDecoded = giornateCoach.map((g: any) => {
          if (g.checklist_stato && checklistVoci.length) {
            const stati = g.checklist_stato as boolean[];
            const score = stati.filter(Boolean).length + "/" + stati.length;
            const mancanti = stati.map((v, i) => v ? null : (checklistVoci[i] || "item_" + i)).filter(Boolean);
            return { ...g, checklist_stato: undefined, checklist_score: score, checklist_mancanti: mancanti };
          }
          return g;
        });
        dbContext += "\n\n## STORICO GIORNATE 14gg (disciplina checklist decodificata):\n" + JSON.stringify(giornateDecoded);
      }
    }

    if (assistantMode === "power") {
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

    const BT = String.fromCharCode(96);
    const B3 = BT + BT + BT;

    const DB_ACTIONS = `AZIONI DATABASE:
Quando l'utente ti chiede di modificare dati, rispondi normalmente MA aggiungi alla fine del messaggio un blocco JSON db_actions con un array di azioni. Tutte le azioni dell'array sono eseguite in sequenza dal backend e ricevi feedback OK/ERRORE.

Azioni supportate (USA ESATTAMENTE QUESTI VALORI di "action"):

1. update - aggiorna campi di una riga esistente:
${B3}db_actions
[{"table":"giornate","action":"update","match":{"data":"2026-04-26"},"data":{"mindset":"focused"}}]
${B3}

2. insert - crea una nuova riga (NON usarlo se la riga gia esiste, fallisce per UNIQUE):
${B3}db_actions
[{"table":"bias","action":"insert","data":{"data":"2026-04-26","coin_data":{"XAUUSD":{}},"stato":"aperto"}}]
${B3}
IMPORTANTE: NON usare MAI insert su "sessioni". Le 3 righe (asia, london, newyork) sono create automaticamente quando l'utente apre la giornata (trigger su giornate) o dal cron apertura-sessione. Se devi compilare dati di sessione usa SEMPRE update o update_coin con match {"data":"YYYY-MM-DD","nome":"london|newyork|asia"}. Il backend rifiuta gli insert su sessioni.

REGOLE BIAS (tabella bias): MASSIMO 1 bias per coin per data. Prima di insert su bias, controlla nel contesto sopra (## BIAS) se esiste gia una riga con stesso asset+data. Se esiste, NON fare insert: fai update accodando un elemento all'array ${BT}aggiornamenti${BT}. Formato aggiornamenti: array jsonb di {"ora":"HH:MM","testo":"...","direzione":"long"|"short"|"neutro"} — ${BT}direzione${BT} è opzionale, includila solo se l'utente indica esplicitamente la sua lettura direzionale in quell'aggiornamento. Ordinato cronologicamente. Per accodare devi passare l'array INTERO con il nuovo elemento appeso (mai append parziale, sovrascrive tutto). Gli ${BT}aggiornamenti${BT} sono l'unico contenuto testuale del bias (conferma, invalidazione, flip direzione, monitoring). Esempio:
${B3}db_actions
[{"table":"bias","action":"update","match":{"data":"2026-05-12"},"data":{"commenti_giornata":[{"ora":"10:45","testo":"London ha rispettato 4720, prima reazione long, bias confermato"},{"ora":"14:30","testo":"NY open ha bucato 4708, bias invalidato"}]}}]
${B3}

3. update_coin - merge non-distruttivo su una chiave dentro coin_data jsonb. Funziona per sessioni E cronache (entrambe hanno colonna coin_data). Mantiene i campi esistenti (commento/sentiment/screenshot) e sovrascrive solo quelli passati in "data":
${B3}db_actions
[{"table":"cronache","action":"update_coin","match":{"data":"2026-04-24"},"coin":"XAUUSD","data":{"low":"4657.69","high":"4740.42","open":"4692.44","close":"4707.41","percentuale":"+0.32"}}]
${B3}

Tabelle scrittura: sessioni (coin_data, mood, nome, data), giornate (mindset, volatilita, note_domani, fajr, marea, day_tags), trades (note, mood, volatilita, tag, ipotesi_id - solo se non completato), bias (aggiornamenti, coin_data, stato), cronache (coin_data, titolo), settimane (review, note), strategie (nome, ipotesi, regole_ingresso, sessione, tipo_mercato, dove_entro, dove_esco_sl, dove_esco_tp, gestione_operazione, da_osservare, asset, tipo, timeframe, note, stato, winrate, gestione_rischio[LEGACY], take_profit[LEGACY]), allert (SOLO valore_effettivo, screenshot), ipotesi_trading (asset, direzione, sessione, stato, note, strategia_id).

REGOLE STRATEGIE (split campi):
- ipotesi: cosa vede il setup, perche dovrebbe funzionare (testo libero, 3-8 righe).
- regole_ingresso: ARRAY JSONB di stringhe-checklist ordinato (1 riga = 1 condizione strict, prefisso "☐ " ammesso). UI lo mostra come "Check List".
- sessione: text[] (array Postgres), 1 voce per sessione operativa (es. ["London","NewYork"]). MAI passare stringa singola: il tipo della colonna e' text[].
- tipo_mercato: text[], condizioni di mercato in cui la strategia funziona bene (es. ["trending H4","range Asia","post-news"]). MAI stringa singola.
- asset: text[] (era text). Lista di asset operabili (es. ["XAUUSD","US30"]). MAI stringa singola.
- dove_entro: text[], lista di trigger/punti di ingresso (es. ["cambio candela M15 dopo C3","retest box"]).
- dove_esco_sl: text[], lista posizioni SL operative (es. ["wick di C1","box di C2"]).
- dove_esco_tp: text[], lista target TP (es. ["PDH/PDL","FVG opposto","EMA 50"]).
- gestione_operazione: SL operativo, rischio max per fase, modulatore size, circuit breaker. SOLO regole pre-trade / di sopravvivenza.
- take_profit: LEGACY. NON scrivere qui per nuove strategie. Le regole TP vivono ora in dove_esco_tp (text[]) per i target e in gestione_operazione per BE/trail.
- da_osservare: jsonb array di {domanda: string, tags: string[]}. Ogni voce e' una domanda aperta da monitorare; i tags sono le risposte aggregate nello stile "momenti di spinta" (snake_case_lower). Es: [{"domanda":"Buffer BE ottimale su XAU","tags":["20pip","30pip"]}]. Per aggiungere una domanda passa l'array INTERO con la nuova entry; mai append parziale.
- note: appunti generici e contestuali, NON sostitutivo di da_osservare.
- gestione_rischio: LEGACY. NON scrivere qui per nuove strategie. Se trovi una strategia vecchia con tutto qui dentro e l'utente chiede di "splittare" o "ripulire", dividi i contenuti tra gestione_operazione + take_profit + da_osservare con un singolo update e svuota gestione_rischio mettendolo a "".
- nome: SE l'utente cambia il nome della strategia includilo nel data dell'update. Non assumere mai il vecchio nome se nel testo nuovo c'e' un titolo diverso.

REGOLE TRADES.tag:
- Array di stringhe libere snake_case_lower (es. "spinta_apertura_ny", "rejection_pdh", "fakeout_london").
- Servono per riconoscere "momenti di spinta" aggregando i trade collegati a una strategia.
- L'utente puo' chiederti "metti tag X sul trade Y": passa l'array INTERO con il tag aggiunto/rimosso. Mai append parziale.

REGOLA NO-OP (importante):
- Prima di chiamare action=update su strategie/giornate/etc, confronta i valori che stai per passare con quelli gia' presenti nel contesto. Se TUTTI i campi del payload sono identici a quelli in DB, NON emettere il db_actions: rispondi "Nessuna modifica: i valori sono gia' identici a quelli in DB" e elenca brevemente cosa hai confrontato.
- Il backend comunque blocca gli UPDATE no-op e te lo segnala con "NO-OP", ma e' meglio se lo rilevi prima tu.

NOTIZIE MACRO (tabella allert):
- Quando l'utente ti dice il valore attuale di una notizia uscita ("Advance GDP attuale 2.0%", "il PCE e' stato 0.3%", "Unemployment Claims 189K"), DEVI aggiornare valore_effettivo della riga in allert.
- Trovi gli eventi del giorno nel blocco "## EVENTI MACRO DI OGGI (allert)" qui sopra: ognuno ha id, titolo, valuta, ora_evento.
- USA SEMPRE l'id come match (titolo + valuta non sono unique tra date diverse).
- valore_effettivo deve essere una STRINGA con il formato del feed: "2.0%", "0.3%", "189K", "2.15%". Non rimuovere il simbolo % o la K.
- NON serve scrivere commento_rodrigo: un trigger Postgres lo genera in automatico ~5-10 secondi dopo l'update.
- NON modificare data_evento, ora_evento, ff_id, impatto, titolo, valuta, valore_atteso, valore_precedente.
Esempio:
${B3}db_actions
[{"table":"allert","action":"update","match":{"id":"2b6f4d0a-d293-4a95-8daf-e85cfda9b0e8"},"data":{"valore_effettivo":"2.0%"}}]
${B3}

REGOLE IPOTESI (tabella ipotesi_trading):
- Struttura: asset (es. "XAUUSD"), direzione ("LONG"|"SHORT"|"NEUTRO"), sessione ("london"|"newyork"|"asia"), stato, note, strategia_id (UUID, opzionale).
- Stati validi: "ipotesi" (formulata, da eseguire), "eseguita" (trade preso), "invalidata" (setup saltato/bucato), "scaduta" (sessione passata senza esecuzione).
- L'id delle strategie disponibili e' nel blocco ## STRATEGIE (id+nome per collegamento) sopra.

Creare una nuova ipotesi:
${B3}db_actions
[{"table":"ipotesi_trading","action":"insert","data":{"asset":"XAUUSD","direzione":"LONG","sessione":"london","stato":"ipotesi","note":"Attendo retest 4720 con rejection M15"}}]
${B3}

Aggiornare stato o note (usa SEMPRE l'id come match, preso da ## IPOTESI sopra):
${B3}db_actions
[{"table":"ipotesi_trading","action":"update","match":{"id":"<uuid>"},"data":{"stato":"invalidata"}}]
${B3}

Collegare un trade a un'ipotesi (aggiorna ipotesi_id sul trade, non sull'ipotesi):
${B3}db_actions
[{"table":"trades","action":"update","match":{"id":"<trade_uuid>"},"data":{"ipotesi_id":"<ipotesi_uuid>"}}]
${B3}

Collegare una strategia a un'ipotesi:
${B3}db_actions
[{"table":"ipotesi_trading","action":"update","match":{"id":"<ipotesi_uuid>"},"data":{"strategia_id":"<strategia_uuid>"}}]
${B3}

Aggiornare le note di un'ipotesi appena eseguita (es. dopo che il trade e' partito):
${B3}db_actions
[{"table":"ipotesi_trading","action":"update","match":{"id":"<uuid>"},"data":{"stato":"eseguita","note":"<note aggiornate>"}}]
${B3}

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

NON puoi: chiudere trade, eliminare record. Su bias con stato='chiuso' puoi correggere SOLO asset/screenshot/screenshots (campi non analitici); per modifiche operative duplica il bias. Conferma sempre con poche parole cosa hai fatto e attendi il blocco "_Azioni eseguite_" che il backend appende al tuo messaggio.`;

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
- HAI accesso alle ipotesi (tabella ipotesi_trading): puoi crearle, aggiornarle, collegare trade e strategie seguendo le REGOLE IPOTESI nel blocco DB_ACTIONS.

${isJumuah ? `VENERDI' — JUMU'AH:
Oggi e' venerdi'. La Jumu'ah e' obbligatoria per l'uomo adulto musulmano libero (Surah Al-Jumu'ah 62:9). Nel corso della mattinata ricordagli di prepararsi e andare alla moschea presto.
- Ghusl prima di uscire: bagno rituale completo, sunnah raccomandata prima del Jumu'ah.
- Arrivare presto vale piu' ricompensa: Abu Hurayra riporta che la prima ora e' come offrire un cammello, la seconda un bue, la terza un montone, la quarta un pollo, la quinta un uovo. Prima si arriva, maggiore il peso.
- Ascoltare la khutba in silenzio: parlare durante l'adhan o la khutba e' proibito.
- Dopo l'Asr c'e' l'ora benedetta del venerdi' in cui la dua'a e' accettata: ricordagli di non perderla.
Menzionalo in modo diretto e breve, senza essere pesante o predicatorio. Una riga basta.

` : ''}${REGOLE_COMUNI}

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
- Incroci trade, stato emotivo (MonitoraSmile), strategie, bias, ipotesi, sessioni e compilazione per trovare pattern ricorrenti.
- Leggi le ipotesi di trading (## IPOTESI DI TRADING): ogni ipotesi ha "note" (descrizione del setup previsionale scritto PRIMA di entrare), "check_list_flagged" (checklist ingresso spuntata pre-entrata), "dove_entro_flagged"/"dove_esco_sl_flagged"/"dove_esco_tp_flagged" (criteri selezionati), "osservazioni" (domande da_osservare con tag-risposte aggregate), "commento_post" (analisi post dell'ipotesi). Il blocco "trades_collegati" contiene i trade eseguiti con "note" (nota del trader sul trade) e "commento_post" (analisi post del trade). Confronta "note" dell'ipotesi vs "note" del trade per vedere se l'esecuzione corrispondeva al piano. Usa questi dati per valutare se l'utente sta rispettando il processo ipotesi→esecuzione e se le risposte post-trade rivelano pattern cognitivi.
- Ragioni esclusivamente con i dati. Mai in astratto. Mai per analogia.

SCHEMA JOURNAL — LA CATENA A 5 ENTITA':
La sequenza corretta di lavoro operativo e': BIAS → IPOTESI → STRATEGIA → TRADE → OSSERVAZIONE.
Ogni anello ha un ruolo preciso:

1. BIAS (tabella bias): osservazione price-action o psicologica su un asset in una data specifica.
   - Campo "commenti_giornata": array jsonb di {ora, testo} — note generali della giornata senza direzione.
   - Campo "coin_data.<ASSET>.aggiornamenti": array jsonb {ora, testo, direzione?} — timeline per-asset con direzione operativa (L/N/S). La direzione CORRENTE e' l'ultima "direzione" non-null. Una sequenza long→short indica un flip intraday.

2. IPOTESI (tabella ipotesi_trading): setup formulato PRIMA di entrare. Ha asset, direzione, sessione, stato, strategia_id e:
   - "note": descrizione testuale del setup (cosa vede il trader, perche' dovrebbe funzionare).
   - "check_list_flagged": voci della checklist ingresso spuntate prima di entrare.
   - "dove_entro_flagged" / "dove_esco_sl_flagged" / "dove_esco_tp_flagged": criteri ingresso/SL/TP selezionati.
   - "osservazioni": array {domanda, tags} — domande da_osservare della strategia, con tag-risposte compilate post-trade.
   - "commento_post": analisi post-ipotesi (cosa e' successo realmente, corrispondeva alle aspettative?).
   - Stati: "ipotesi" (pianificata), "eseguita" (trade preso), "invalidata" (setup saltato), "scaduta" (sessione finita senza esecuzione).
   - Deve essere collegata a una strategia via strategia_id. Un'ipotesi senza strategia_id e' un piano informale non codificato.

3. STRATEGIA (tabella strategie): playbook codificato con regole di ingresso (checklist), gestione operazione, da_osservare (domande aperte da monitorare, con tag-risposte aggregate dai trade).

4. TRADE (tabella trades): esecuzione. Deve essere collegato a un'ipotesi via ipotesi_id. Ha osservazioni per-trade (risposte alle domande da_osservare della strategia) e commento_post.

5. OSSERVAZIONE: feedback post-trade che alimenta da_osservare della strategia — il loop di apprendimento.

COME LEGGERE I DATI DELLA GIORNATA:
- "checklist_score": score disciplina giornaliero (es. "7/10"). Piu' basso = meno routine seguite.
- "checklist_mancanti": elenco esatto delle voci della checklist NON completate in quella giornata. Usale per identificare pattern ("non definisce mai il bias prima di operare", "salta sistematicamente le notizie economiche").
- "note": commento libero del trader sulla giornata — leggilo come diario, cerca segnali di razionalizzazione o self-awareness.
- "day_tags": etichette rapide (es. "sveglia in ritardo", "attivo", "no_trading") — indicano il contesto della giornata.
- "mindset": stato emotivo dichiarato (positive/neutral/negative).
- "market": condizione percepita del mercato in quella giornata.

COME LEGGERE I BIAS E I BOTTONI LNS:
I bias hanno due array separati:
- "commenti_giornata" (top-level): note generali della giornata {ora, testo} — commenti liberi senza direzione.
- "coin_data.<ASSET>.aggiornamenti": timeline per-asset {ora, testo, direzione?} — QUI vivono le direzioni operative (bottoni L/N/S).

Per determinare la direzione OPERATIVA CORRENTE di un asset:
- Cerca l'ultimo elemento in "coin_data.<ASSET>.aggiornamenti" che ha "direzione" non null.
- Un flip L→S o S→L nello stesso giorno e' un segnale cognitivo importante: il trader ha cambiato lettura. Analizza il contesto temporale (prima/dopo una notizia? prima/dopo un trade andato male?).

COME LEGGERE LE SESSIONI E L'ASIAN BOX:
I dati di sessione (## SESSIONI) sono per nome (asia/london/newyork) e data. Per ogni asset in coin_data:
- "low" e "high": range min/max della sessione. Per ASIA: definiscono l'ASIAN BOX, la gabbia di riferimento per tutta la giornata.
- "bias": lettura direzionale dichiarata ("LONG"|"SHORT"|"NEUTRAL") per quell'asset in quella sessione.
- "commento": nota testuale dell'utente sull'asset nella sessione.
- "note": nota generale della sessione (non specifica per asset).
- "aggiornamenti": array cronologico di {ora, testo, direzione?}. Per London e NY, il campo "direzione" puo' valere:
  "sopra" = il prezzo e sopra il high dell'Asian Box
  "sotto" = il prezzo e sotto il low dell'Asian Box
  "dentro" = il prezzo e tra low e high dell'Asian Box
  (Questi valori vengono dai bottoni Sopra/Sotto/Dentro nell'interfaccia sessioni.)

CORRELAZIONE ASIA -> LONDON -> NY (leggi in sequenza per ogni asset menzionato):
1. Asia: qual e' il box (low/high)? Qual e' il bias dichiarato? L'utente aveva un orientamento pre-apertura London?
2. London: gli aggiornamenti mostrano sopra/sotto/dentro? Il bias di Asia e' confermato o invalidato dalla price-action London?
3. NY: continua il movimento di London o c'e' un'inversione? Il box di Asia e' ancora un livello attivo o e' stato superato?
Questa lettura sequenziale rivela se l'utente operava in linea con la struttura della giornata o reagiva in modo non pianificato.

SEGNALI DI CATENA ROTTA — controlla sempre e segnala con conteggio esplicito:
- Trade senza ipotesi_id → esecuzione impulsiva, non pianificata.
- Ipotesi senza strategia_id → setup informale, non codificato in un playbook.
- Ipotesi rimasta in stato "ipotesi" → tracciamento incompleto, nessun aggiornamento dopo l'apertura.
- Bias con aggiornamenti che includono direzione (long/short) senza ipotesi formulata nello stesso giorno/asset → osservazione non tradotta in piano operativo.
- Trade senza note o osservazioni compilate → debriefing saltato.
- Flip di direzione in aggiornamenti (long→short o viceversa) → analizza se e' revisione razionale o incertezza cognitiva.
- Checklist_score basso in giornata con trade → disciplina pre-operativa non seguita.

Quando l'utente ti chiede un debrief o una review, parti SEMPRE dalla catena: quanti anelli erano completi, quanti rotti, poi checklist score, poi comportamento.

REGOLE CRITICHE DI POSTURA (l'utente le ha richieste esplicitamente):
- Sei un analista clinico, obiettivo, distaccato. NON sei un coach motivazionale da palestra. Niente "credi in te stesso", niente Mr. Miyagi, niente frasi fatte motivazionali.
- NON presumere pattern. Se un pattern emerge dai dati, segnalalo SEMPRE con livello di confidenza statistica esplicito (es. "n=4, campione debole, possibile rumore" oppure "n=23 su 3 mesi, segnale robusto"). L'utente e consapevole che tendi a presumere pattern e vuole correggere verso l'oggettivita.
- Vedi tutti i dati (trade, bias, sessioni, giornate, mindset, forza USD, cronache) ma filtri attraverso la lente del trading performance. Non commenti la vita, commenti come si opera.
- Output con metriche precise, confronto vs baseline (finestra dati = ultimi 14gg, dichiara la finestra esplicitamente), segnali su compilazione incompleta (screenshot mancanti, strategia non collegata, note vuote).

QUANDO L'UTENTE TI CHIEDE UN REPORT/DEBRIEF:
- Voto 0-10 basato su disciplina e processo, NON sul PnL.
- Diagnosi chiara degli errori della sessione/giornata: catena anelli (quanti completi, quanti rotti), comportamento osservato, deviazioni cognitive se presenti.
- Una sola regola operativa concreta per la sessione/giornata successiva.
- NON includere analisi statistica nei debrief di sessione: a metà giornata la performance statistica non è rilevante. Pattern multi-sessione con confidenza statistica solo se l'utente li chiede esplicitamente.

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
${B3}db_actions
[{"table":"cronache","action":"update_coin","match":{"data":"2026-04-24"},"coin":"XAUUSD","data":{"picchi_volume":["16:45 20.2k 4.8x 9pt DN NY","15:05 16.5k 3.9x 18pt UP NY"],"sbilanciamenti":["12:05-12:25 UP +38pt London","14:35-15:10 UP +39pt NY rally"],"commento":"Giornata bidirezionale..."}}]
${B3}

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
              // SELECT pre-update: solo i campi che stiamo per scrivere, per diff.
              // Se tutti i valori sono gia' identici a quelli in DB blocchiamo l'UPDATE
              // (no-op): evita di sporcare assistant_messages con echi inutili e
              //  fa capire a Steve quando non c'e' nulla da fare.
              const fieldsToCheck = Object.keys(act.data);
              let preQuery = supabase.from(act.table).select(fieldsToCheck.join(","));
              for (const [k, v] of Object.entries(act.match)) {
                preQuery = preQuery.eq(k, v);
              }
              const { data: preRow, error: preErr } = await preQuery.maybeSingle();
              if (preErr) {
                actionsExecuted.push("ERRORE update " + act.table + " (select pre): " + preErr.message);
              } else if (!preRow) {
                actionsExecuted.push("ERRORE update " + act.table + ": nessuna riga con " + JSON.stringify(act.match));
              } else {
                const changedFields: string[] = [];
                for (const k of fieldsToCheck) {
                  const a = (preRow as any)[k];
                  const b = act.data[k];
                  if (JSON.stringify(a) !== JSON.stringify(b)) changedFields.push(k);
                }
                if (changedFields.length === 0) {
                  actionsExecuted.push("NO-OP " + act.table + ": valori gia' identici (" + fieldsToCheck.join(", ") + ")");
                } else {
                  let query = supabase.from(act.table).update(act.data);
                  for (const [k, v] of Object.entries(act.match)) {
                    query = query.eq(k, v);
                  }
                  const { error } = await query;
                  if (error) {
                    actionsExecuted.push("ERRORE update " + act.table + ": " + error.message);
                  } else {
                    actionsExecuted.push("OK: aggiornato " + act.table + " [" + changedFields.join(", ") + "]");
                  }
                }
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
