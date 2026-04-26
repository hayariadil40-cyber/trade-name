# TV-Dump Templates — prompt per Claude Code + MCP TradingView

Questi sono i prompt template che usi in **Claude Code + MCP TradingView Desktop** per ottenere dump strutturati, da copia/incollare in chat con **Steve** (`assistente.html` tab Power). Steve riconosce le intestazioni e compila automaticamente i campi `picchi_volume`, `sbilanciamenti`, `commento` dentro `cronache.coin_data` per la coin/data indicata.

Il flusso:

```
Tu in Claude Code+TV → prompt qui sotto → Claude legge candele/volumi via MCP → output strutturato
                                                                                       ↓
                                                          copia/incolla in chat Steve → Steve emette db_actions → cronache.coin_data popolato
```

Convenzioni:
- Orari sempre **UTC+1 (Casablanca)**.
- `{ASSET}` = `XAU`, `US30`, `NAS100`, `GER40`, `BTC` (uno alla volta).
- `{DATA}` = formato `gg/mm/aaaa`, es. `24/04/2026`.
- Coin chart aperto su TradingView Desktop, timeframe 5m, durata visibile copre l'intera sessione.

---

## 1. `analisi_giornaliera_xau`

**Quando**: fine giornata operativa, vuoi appunti completi per la cronaca dell'asset.

**Prompt da incollare in Claude Code+TV**:

```
Sei un analista price action. Leggi il chart corrente di {ASSET} 5m per la giornata {DATA}, fascia oraria 00:00-22:00 UTC+1 (Casablanca).

Output formato richiesto (rispetta INTESTAZIONE e formato sezioni):

📋 analisi_giornaliera_xau

{ASSET} 5m | {DATA} | 00:00-22:00 UTC+1 | avg vol <X>, soglia 2x=<2X>, range>=10pt

Push direzionali (range>=10pt AND vol>=2x avg):

🌏 ASIA (00:00-08:59)
- elenco singole candele o cluster qualificati, oppure "Nessun push qualificato — <motivo>"

🌅 LONDON (09:00-14:29)
- elenco singole candele o cluster qualificati, formato:
  - HH:MM range Xpt vol Y (Nx) DIR — descrizione
- se cluster, separa con un sotto-titolo "Cluster DIR HH:MM-HH:MM — descrizione +Xpt"

🇺🇸 NY (14:30-22:00)
- come sopra

Sintesi: 2-3 righe sulla direzione netta, spinte principali, comportamento Asia.
```

---

## 2. `picchi_volume_only`

**Quando**: vuoi solo il top dei volumi della giornata (più veloce, output denso).

**Prompt da incollare in Claude Code+TV**:

```
Sei un analista quantitativo. Leggi il chart corrente di {ASSET} 5m per la giornata {DATA}, fascia 00:00-22:00 UTC+1 (Casablanca).

Output formato richiesto (rispetta INTESTAZIONE):

📊 picchi_volume_only

HH:MM | vol    | ratio | range  | dir | sessione
<top 5 picchi volumetrici della giornata, ordinati per volume decrescente>

Note: 1-2 righe di commento sul picco assoluto del giorno e cosa rappresenta (push, distribution, exhaustion, ecc.)
```

---

## 3. Workflow consigliato

1. A fine giornata, in Claude Code (cartella `trade-name`) con MCP TradingView attivo:
   - Apri TV Desktop con il chart {ASSET} 5m sulla giornata target
   - Copia il prompt template (1 o 2 sopra), sostituisci `{ASSET}` e `{DATA}`, premi Invio
   - Claude legge il chart via MCP e restituisce l'output formato
2. Apri `assistente.html` → tab **Power** (Steve)
3. Incolla l'output completo (intestazione inclusa). Aggiungi una riga di contesto se vuoi (es. "compila la cronaca")
4. Steve risponde con un riassunto + emette `db_actions` automaticamente
5. Vai su `cronache.html` → click sulla card del giorno → vedi i tag popolati e il commento

---

## 4. Formato canonico dei tag (output Steve)

Steve trasforma il dump nei seguenti tag, salvati in `cronache.coin_data.{COIN}.picchi_volume[]` e `.sbilanciamenti[]`:

**Picchi volume**:
```
HH:MM Xk N.Nx Rpt DIR SESSIONE
```
- `HH:MM`: ora candela
- `Xk`: volume in migliaia, 1 decimale (es. `16.5k`)
- `N.Nx`: ratio vs media giornaliera (es. `3.9x`)
- `Rpt`: range punti, intero (es. `18pt`)
- `DIR`: `UP` o `DN`
- `SESSIONE`: `Asia` / `London` / `NY`

Esempio: `15:05 16.5k 3.9x 18pt UP NY`

**Sbilanciamenti**:
```
HH:MM[-HH:MM] DIR ±Rpt SESSIONE [nota]
```
- `HH:MM` o range `HH:MM-HH:MM` per cluster
- `DIR`: `UP` o `DN`
- `±Rpt`: range cumulato con segno (es. `+38pt`, `-10pt`)
- `SESSIONE`: come sopra
- `[nota]` opzionale: `fakeout`, `rally`, `rejection`, `distribution`, ecc.

Esempi:
- `12:05-12:25 UP +38pt London`
- `14:30 DN -10pt NY fakeout`
- `14:35-15:10 UP +39pt NY rally`

Questo formato è leggibile come chip in `dettaglio_cronaca.html` E parsabile via regex per future query (ricerca pattern: "tutti i picchi volume >3x in fascia NY 15:00-15:30 negli ultimi 60gg").
