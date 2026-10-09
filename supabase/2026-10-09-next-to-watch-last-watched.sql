-- Correr uma vez no SQL Editor do Supabase: acrescenta last_watched_at à vista next_to_watch
-- (data em que viu o último episódio) e last_watched_air_date (data de emissão desse episódio),
-- usadas para separar as séries acompanhadas das restantes.
drop view if exists next_to_watch;
create or replace view next_to_watch as
select distinct on (e.show_id)
  e.show_id, e.tmdb_id as episode_id, e.season, e.number, e.name, e.air_date, e.runtime,
  (select count(*) from episodes x
     where x.show_id = e.show_id and x.air_date <= current_date and x.season > 0
       and not exists (select 1 from watched w where w.episode_id = x.tmdb_id)) as remaining,
  (select max(w.watched_at) from watched w where w.show_id = e.show_id)       as last_watched_at,
  (select max(x.air_date) from watched w join episodes x on x.tmdb_id = w.episode_id
     where w.show_id = e.show_id)                                             as last_watched_air_date
from episodes e
join shows s on s.tmdb_id = e.show_id and s.followed
where e.air_date <= current_date and e.season > 0
  and not exists (select 1 from watched w where w.episode_id = e.tmdb_id)
order by e.show_id, e.season, e.number;
