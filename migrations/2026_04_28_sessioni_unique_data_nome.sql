-- Vincolo UNIQUE su sessioni(data, nome) per impedire duplicati.
-- Il 27/04 una riga newyork e' stata duplicata: apertura-sessione (cron 14:30 Casa)
-- aveva creato la riga, e successivamente una db_actions:insert di Rodrigo ne ha
-- creata un'altra. update_coin poi falliva su tutti i 6 coin con
-- "JSON object requested, multiple (or no) rows returned".
--
-- A livello DB ora qualunque tentativo di duplicato fallisce a monte.
-- Backend chat-ai blocca anche action=insert su sessioni (guard rail).
-- apertura-sessione usa .eq() esatto e non ingoia piu' l'errore di maybeSingle.

ALTER TABLE sessioni
  ADD CONSTRAINT sessioni_data_nome_unique UNIQUE (data, nome);
