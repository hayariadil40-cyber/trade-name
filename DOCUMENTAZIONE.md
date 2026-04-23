# Documentazione Trade Desk

## 1. Entry & Autenticazione

### `login.html`
- **Scopo**: unico entry point pubblico, login email/password.
- **UI**: logo centrato, form email+password, pulsante "Accedi" con loading state, messaggio errore dinamico.
- **Dati**: `db.auth.signInWithPassword()` (Supabase Auth).
- **JS**: `doLogin()` valida, autentica, redirect a `index.html`; sessione in `localStorage`. Redirect automatico se già loggato.
- **Dipendenze**: `supabase-config.js`, `settings.js`, Tailwind, Lucide.

### `index.html`
- **Scopo**: dashboard principale post-login. Quadro strategico globale.
- **UI**: header universale (timeline Asia/London/NY, mindset/market/volatility, win rate live), sidebar collassabile, KPI card (Net PnL, Win Rate, R:R, Drawdown), timeline giornaliera con micro equity, quick stats.
- **Dati**: legge da `trades`, `giornate`, `settimane`.
- **JS**: `app.js` carica storici; timeline aggiornata ogni secondo; auto-load sessione utente da `auth.js`.
- **Dipendenze**: Supabase, Tailwind, Lucide, Chart.js.
- **Note**: protetta da auth (redirect a `login.html` se non autenticato).

---

## 2. Pagine Periodo

### `giornaliero.html`
- **Scopo**: archivio giornate di trading.
- **UI**: lista card (data, giorno, #trade, P/L, mood icon) ordinate dalla più recente; pulsante "Nuova Giornata".
- **Dati**: `giornate.select('*')`; calcolo P/L da `trades` filtrati per data; mood dal campo `mindset`.
- **JS**: `loadDays()`, `createNewDay()` crea record odierno e apre `dettaglio_giornata.html?id=<id>`.

### `settimanale.html`
- **Scopo**: archivio settimane (Lun-Ven).
- **UI**: grid card per settimana (numero, range date, win rate %, net profit, badge "corrente"); bordo teal se corrente, rosso se loss, verde se profit.
- **Dati**: `settimane` + trades nel range `data_inizio..data_fine`; win rate = wins/total.
- **JS**: `getCurrentWeekRange()`, `createCurrentWeek()`, apertura `dettaglio_settimana.html?id=<id>`.

### `sessioni.html`
- **Scopo**: archivio sessioni (Asia, London, New York).
- **UI**: lista con filtri per tipo sessione; row con icona (sunrise/landmark), data, coin, mood, chevron; pulsante "Nuova Sessione".
- **Dati**: `sessioni.select('*')`, campo `coin_data` JSONB, `mood` per sentiment.
- **JS**: `loadSessions()`, `filterList(type)`.

---

## 3. Dettagli Periodo (pattern comune)

`dettaglio_giornata.html`, `dettaglio_settimana.html`, `dettaglio_sessione.html`, `dettaglio_trade.html`

- **Scopo**: form di dettaglio/edit/creazione record del periodo.
- **UI**: header con breadcrumb, sezione dati principali (date, status, P/L, win rate), form edit, card trade correlati, screenshot/media, pulsanti Salva/Cancella, modal di conferma.
- **Dati**: URL param `?id=<record_id>` → `.eq('id',id).single()`; se no ID → form creazione; join con `trades` tramite `data` o FK.
- **JS**: load on mount, popolamento form, `.update()`/`.insert()`, toast feedback, `.delete()` con conferma.
- **Note**: `dettaglio_trade.html` è il form single-trade (entry, exit, SL, TP, P/L calcolato).

---

## 4. Analitica

### `strategie.html`
- **Scopo**: hub playbook meccanici con stats per strategia.
- **UI**: grid card (nome, ipotesi, target icon, status, win rate %, #trade, R:R medio); card tratteggiata per aggiungere; barra accent se attiva.
- **Dati**: `strategie.select('*')` + join trades via `strategia_id`; calcola win rate, R:R medio, totali.
- **JS**: `loadStrategies()`, `createNewStrategy()`.

### `bias.html`
- **Scopo**: reperti psicologici/market memory.
- **UI**: lista scrollabile (asset, LONG/SHORT, data, commento preview, #screenshot); barra sx verde LONG / rossa SHORT.
- **Dati**: `bias.select('*')` con `asset`, `direzione`, `data`, `commento`, `confluenze`, `screenshots[]`.

### `allert.html`
- **Scopo**: hub notizie economiche + price alert + sentiment.
- **UI**: 3 tab
  - **Calendario**: eventi economici con impatto HIGH/MED/LOW, valori previsto/effettivo, status.
  - **Allert**: price alert per coin (prezzo, ora, descrizione, status).
  - **MonitoraSmile**: log mindset+volatilità.
  - Modal "Validazione Post-Notizia" (impatto XAU/Indici UP/DOWN + categorizzatori cronache/strategie/trades); Modal "Validazione Allert" (commento, stato emotivo, screenshot).
- **Dati**: tabelle `allert`, `allert_prezzo`, `monitora_smile`; multi-select con `cronache`, `strategie`, `trades`.
- **JS**: `switchMainTab()`, `saveNews()`, `saveAllert()`, `ignoreNews()`, `ignoreAllert()`.
- **Note**: supporta webhook N8N per auto-import notizie.

### `analisi.html`
- **Scopo**: dashboard statistica completa.
- **UI**: filtri periodo (Tutto/Mese/Settimana/Oggi) + broker (MT4/Bybit); 4 KPI (Net PnL, Win Rate, R:R, Max Drawdown); equity curve (line), pie P/L per asset, bar P/L per sessione.
- **Dati**: `trades.select('id, asset, direzione, data, entry_price, exit_price, stop_loss, pnl, esito, size, sorgente')`.
- **JS**: `loadAnalisi()` → calcolo KPI + render Chart.js.
- **Note**: R:R = (exit − entry)/(entry − SL).

### `cronache.html`
- **Scopo**: daily recap macro/price-action per coin.
- **UI**: filtri coin (XAUUSD, US30, GER30, NAS100, BTCUSD); grid 5 colonne (Lun-Ven); card con screenshot 16:9, giorno/data, %, commento; colori verde/rosso/muted.
- **Dati**: `cronache` con `coin_data` JSONB `{XAUUSD:{screenshot, percentuale, sentiment, commento}, ...}`; raggruppate per settimana.
- **JS**: `loadCronache()` auto-crea Lun-Ven della settimana corrente; `setCoinFilter()`.

### `grafici.html`
- **Scopo**: TradingView embed + workflow screenshot multi-destinazione.
- **UI**: tab coin, widget TradingView (iframe), pulsante Screenshot → modal 3 step (paste/URL → scelta destinazione → scelta record).
- **Dati**: upload a Supabase Storage bucket `trade-screenshots`, fallback base64; salva URL nel campo `coin_data[coin].screenshot` o `screenshots[]`.
- **JS**: `switchCoin()`, `takeScreenshot()`, paste clipboard, `selectDest()`, `saveScreenshot()`.

### `dettaglio_strategia.html`, `dettaglio_bias.html`, `dettaglio_allert.html`, `dettaglio_cronaca.html`
- **Scopo**: dettaglio editabile con form dati + screenshot gallery + trade correlati + Salva/Delete.
- **JS**: load via `?id`, `.update()`/`.delete()` con conferma.

---

## 5. Tabelle & Impostazioni

### `tabella_trades.html`
- **Scopo**: registro piatto di tutti i trade.
- **UI**: colonne ID, Asset, Direzione, Size, Sorgente (badge), Stato, Data/Ora, P/L (colored); click row → `dettaglio_trade.html?id=<id>`; contatore "X trades".
- **Dati**: `trades.select('*')` ordinati data desc.

### `impostazioni.html`
- **Scopo**: config globale dashboard.
- **UI**: 3 box
  - **Checklist Base**: items drag-reorder, edit inline, add/delete.
  - **Timeline Blocchi**: input time start/end + titolo per blocco, drag-reorder, "Salva Blocchi".
  - **Frasi Disciplina**: lista motivazionali, add/delete.
- **Dati**: tabella `settings` (key/value JSONB) con keys `td_checklist`, `td_timeline_blocks`, `td_frasi_disciplina`; API da `settings.js` (`getSetting`/`saveSetting`).
- **Note**: checklist e timeline usate nell'header di tutte le pagine.

---

## 6. AI Assistenti

Tutti seguono il pattern chat con messaggi user/ai, suggerimenti rapidi, input + send, pulsante "Pulisci chat", typing indicator, history in `localStorage` (`td_assist_chats`). Backend comune: **Supabase Edge Function** `https://fzxjbxeadiqwfpctiyom.supabase.co/functions/v1/chat-ai` con payload `{message, history, mode}`.

### `assistente.html` — **Sofi** (Coach/Power)
- 2 tab: **Coach** (analisi comportamentale ultimi 30gg, mindset, errori ricorrenti) e **Power** (accesso completo a trades, strategie, cronache, bias, settimane, giornate; costruzione strategie).
- `switchTab()` conserva HTML chat separata per ogni tab.

### `dede.html` — **Dede** (Mentor)
- Modalità singola; focus educazione e piano di miglioramento. `mode: 'dede'` nel payload, system prompt dedicato lato backend.

### `steve.html` — **Steve** (Power Trader)
- Modalità singola; focus strategie avanzate, pattern recognition, setup. `mode: 'steve'`.

---

## 7. Template / Include

### `header_source.html`
- Template header universale: titolo + quick action (sx), clock digitale + timeline progress con cursore (centro), icone mindset/market/volatility + win rate ring (dx).
- In pratica duplicato inline nelle pagine.

### `sidebar_source.html`
- Template sidebar: logo TD, nav (Dashboard, Giornaliero, Tab Trade, Cronache, Weekly, Sessioni, Bias, Allert, Analisi, Strategie, Grafici, Dede, Steve, Impostazioni), animazioni expand on hover.
- Duplicato inline nelle pagine.

---

## Schema dati Supabase (riepilogo)

| Tabella | Campi chiave |
|---|---|
| `giornate` | id, data, stato, mindset, contenuto, note |
| `settimane` | id, data_inizio, data_fine, stato, note |
| `sessioni` | id, nome (asia/london/newyork), data, mood, coin_data JSONB |
| `trades` | id, asset, direzione, data, entry/exit/SL/TP, size, pnl, esito, sorgente (MT4/Bybit), strategia_id FK, screenshot_url |
| `strategie` | id, nome, ipotesi, stato, regole_ingresso[], screenshots[] |
| `bias` | id, asset, direzione, data, commento, confluenze, screenshots[], stato |
| `allert` | id, titolo, data_evento, ora, impatto, valore_prec/atteso/effettivo, stato, categorizzatori JSONB |
| `allert_prezzo` | id, coin, prezzo, ora, descrizione, screenshot, stato, mindset, volatilita |
| `monitora_smile` | id, mindset, volatilita, sorgente |
| `cronache` | id, data, titolo, coin_data JSONB (per coin: screenshot/percentuale/sentiment/commento) |
| `settings` | key (unique), value JSONB |

---

## Auth & librerie

- **Auth**: Supabase email/password, JWT in `localStorage`, `auth.js` middleware con redirect a `login.html`, auto-refresh ~30min.
- **Librerie**: Tailwind CSS (dark theme), Lucide icons, Chart.js, Supabase (auth/DB/storage), TradingView widget.
