-- Correr uma vez no SQL Editor do Supabase: poster de cada temporada, usado nos cartões das listas.
-- A app preenche a coluna sozinha ao abrir (para as séries que ainda não a têm) e na sincronização.
alter table shows add column if not exists season_posters jsonb;
