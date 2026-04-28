-- Trigger AFTER INSERT su giornate: crea le 3 righe sessioni (asia, london, newyork)
-- per la stessa data con ON CONFLICT DO NOTHING (idempotente grazie al vincolo
-- UNIQUE (data, nome) introdotto nella migration precedente).
--
-- Motivazione: prima di questo trigger la sessione asia non aveva un cron dedicato,
-- mentre apertura-sessione coprIva solo london e newyork. Quando Rodrigo provava a
-- compilare i range della sessione asiatica, update_coin falliva con "nessuna riga
-- in sessioni con {data, nome:asia}". Spostando la creazione delle 3 sessioni nel
-- momento in cui l'utente apre la giornata (giornaliero.html -> INSERT giornate),
-- tutti gli assistenti trovano sempre la riga gia' presente.

CREATE OR REPLACE FUNCTION public.giornate_seed_sessioni()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO sessioni (data, nome, stato) VALUES
    (NEW.data, 'asia',    'nuovo'),
    (NEW.data, 'london',  'nuovo'),
    (NEW.data, 'newyork', 'nuovo')
  ON CONFLICT (data, nome) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS giornate_seed_sessioni_tr ON giornate;

CREATE TRIGGER giornate_seed_sessioni_tr
AFTER INSERT ON giornate
FOR EACH ROW
EXECUTE FUNCTION public.giornate_seed_sessioni();
