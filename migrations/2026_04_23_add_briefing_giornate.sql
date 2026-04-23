-- Aggiunge la colonna briefing JSONB alla tabella giornate
-- Popolata ogni mattina alle 07:00 ora Casablanca dalla routine "briefing-pre-sessione"
-- Struttura JSON attesa:
-- {
--   "generato_alle": "2026-04-23T06:00:00Z",
--   "macro_oggi":   [{"titolo":"...","ora":"14:30","impatto":"High","valuta":"USD","note":"..."}],
--   "bias_aperti":  [{"asset":"XAUUSD","direzione":"LONG","commento":"..."}],
--   "ultimi_trade": [{"asset":"...","direzione":"...","pnl":...,"esito":"..."}],
--   "usd_strength": {"valore": 0.018, "trend_24h": "in indebolimento"},
--   "narrativa":    "Testo del briefing...",
--   "watchlist":    ["spunto 1", "spunto 2"]
-- }

ALTER TABLE giornate ADD COLUMN IF NOT EXISTS briefing JSONB;

CREATE INDEX IF NOT EXISTS idx_giornate_data ON giornate(data);
