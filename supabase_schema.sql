-- ============================================
-- TRADE DESK - Schema Database Supabase
-- ============================================

-- 1. STRATEGIE (no dipendenze)
CREATE TABLE strategie (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  descrizione TEXT,
  tipo TEXT, -- scalping, intraday, swing
  timeframe TEXT, -- 5m, 15m, 1h, 4h
  asset TEXT, -- XAUUSD, EURUSD, US30
  winrate NUMERIC(5,2),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. ALLERT / EVENTI MACRO (no dipendenze)
CREATE TABLE allert (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titolo TEXT NOT NULL,
  tipo TEXT, -- CPI, NFP, FOMC, earnings, custom
  data_evento DATE,
  ora_evento TIME,
  impatto TEXT, -- alto, medio, basso
  valuta TEXT, -- USD, EUR, GBP
  valore_atteso TEXT,
  valore_effettivo TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. BIAS (no dipendenze)
CREATE TABLE bias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE NOT NULL,
  asset TEXT NOT NULL,
  direzione TEXT, -- LONG, SHORT, NEUTRAL
  confluenze TEXT, -- motivi del bias
  esito TEXT, -- corretto, sbagliato, parziale
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. GIORNATE
CREATE TABLE giornate (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE NOT NULL UNIQUE,
  mindset TEXT, -- positive, neutral, negative
  market TEXT, -- positive, neutral, negative
  volatilita TEXT, -- high, medium, low
  tags TEXT[], -- array di tag: focussed, calm, chop, cpi, etc.
  pnl NUMERIC(10,2) DEFAULT 0,
  n_trades INTEGER DEFAULT 0,
  winrate NUMERIC(5,2),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. SESSIONI (collegata a giornate)
CREATE TABLE sessioni (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  giornata_id UUID REFERENCES giornate(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, -- asia, london, newyork
  data DATE NOT NULL,
  asset TEXT,
  bias TEXT, -- LONG, SHORT, NEUTRAL
  range_pips NUMERIC(8,2),
  pnl NUMERIC(10,2) DEFAULT 0,
  n_trades INTEGER DEFAULT 0,
  mood TEXT, -- positive, neutral, negative
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. TRADES (collegata a sessioni, giornate, strategie)
CREATE TABLE trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  giornata_id UUID REFERENCES giornate(id) ON DELETE SET NULL,
  sessione_id UUID REFERENCES sessioni(id) ON DELETE SET NULL,
  strategia_id UUID REFERENCES strategie(id) ON DELETE SET NULL,
  data TIMESTAMPTZ NOT NULL DEFAULT now(),
  asset TEXT NOT NULL, -- XAUUSD, EURUSD, US30
  direzione TEXT NOT NULL, -- LONG, SHORT
  entry_price NUMERIC(12,5),
  exit_price NUMERIC(12,5),
  stop_loss NUMERIC(12,5),
  take_profit NUMERIC(12,5),
  pips NUMERIC(8,2),
  pnl NUMERIC(10,2),
  size NUMERIC(10,4), -- lotti
  esito TEXT, -- win, loss, breakeven
  durata_minuti INTEGER,
  screenshot_url TEXT,
  note TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. SETTIMANE
CREATE TABLE settimane (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data_inizio DATE NOT NULL,
  data_fine DATE NOT NULL,
  pnl NUMERIC(10,2) DEFAULT 0,
  n_trades INTEGER DEFAULT 0,
  winrate NUMERIC(5,2),
  obiettivi TEXT,
  review TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. CRONACHE
CREATE TABLE cronache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE NOT NULL,
  titolo TEXT NOT NULL,
  contenuto TEXT,
  mercato TEXT, -- forex, indici, crypto
  sentiment TEXT, -- bullish, bearish, neutral
  eventi_chiave TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. KANBAN TASKS
CREATE TABLE kanban_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titolo TEXT NOT NULL,
  descrizione TEXT,
  stato TEXT NOT NULL DEFAULT 'todo', -- todo, progress, done
  priorita TEXT DEFAULT 'medium', -- low, medium, high
  data_scadenza DATE,
  ordine INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS) - Abilita accesso pubblico per ora
-- ============================================

ALTER TABLE strategie ENABLE ROW LEVEL SECURITY;
ALTER TABLE allert ENABLE ROW LEVEL SECURITY;
ALTER TABLE bias ENABLE ROW LEVEL SECURITY;
ALTER TABLE giornate ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE settimane ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronache ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_tasks ENABLE ROW LEVEL SECURITY;

-- Policy: accesso completo con anon key (progetto personale, no auth)
CREATE POLICY "allow_all" ON strategie FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON allert FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON bias FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON giornate FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON sessioni FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON settimane FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON cronache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON kanban_tasks FOR ALL USING (true) WITH CHECK (true);
