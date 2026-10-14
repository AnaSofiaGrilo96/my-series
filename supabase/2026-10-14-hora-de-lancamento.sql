-- Hora de lançamento dos episódios (TVmaze) — correr no SQL Editor do Supabase

alter table shows    add column if not exists tvmaze_id integer;      -- null = ainda não procurado; 0 = procurado, não existe no TVmaze
alter table episodes add column if not exists air_at    timestamptz;  -- instante de emissão (TVmaze); null = desconhecido

-- Instante em que um episódio fica disponível: a hora do TVmaze ou, se não houver, as 00:00 de Lisboa do dia de emissão.
-- (Única referência a Europe/Lisboa: a conversão UTC/UTC+1 é feita pelo Postgres.)
create or replace function release_at(air_at timestamptz, air_date date) returns timestamptz
language sql stable as $$ select coalesce(air_at, air_date::timestamp at time zone 'Europe/Lisbon') $$;

-- Episódios com o instante de lançamento calculado (a app lê daqui; escreve em `episodes`)
create or replace view episode_releases as
select e.*, release_at(e.air_at, e.air_date) as release_at from episodes e;

drop view if exists next_to_watch;
create or replace view next_to_watch as
select distinct on (e.show_id)
  e.show_id, e.tmdb_id as episode_id, e.season, e.number, e.name, e.air_date, e.release_at, e.runtime,
  (select count(*) from episode_releases x
     where x.show_id = e.show_id and x.release_at <= now() and x.season > 0
       and not exists (select 1 from watched w where w.episode_id = x.tmdb_id)) as remaining,
  (select max(w.watched_at) from watched w where w.show_id = e.show_id)       as last_watched_at,
  (select max(x.air_date) from watched w join episodes x on x.tmdb_id = w.episode_id
     where w.show_id = e.show_id)                                             as last_watched_air_date
from episode_releases e
join shows s on s.tmdb_id = e.show_id and s.followed
where e.release_at <= now() and e.season > 0
  and not exists (select 1 from watched w where w.episode_id = e.tmdb_id)
order by e.show_id, e.season, e.number;

drop view if exists stats;
create or replace view stats as
select
  (select count(*) from watched)                                          as episodes_watched,
  (select coalesce(sum(coalesce(e.runtime, s.episode_run_time, 45)),0)
     from watched w join episodes e on e.tmdb_id = w.episode_id
     join shows s on s.tmdb_id = e.show_id)                               as minutes_watched,
  (select count(*) from shows where followed)                             as shows_followed,
  (select count(*) from shows where favorite)                             as shows_favorite,
  (select count(*) from shows where status = 'Ended')                     as shows_ended,
  (select count(*) from shows where status = 'Canceled')                  as shows_canceled,
  (select count(*) from shows s where s.followed
     and not exists (select 1 from episode_releases e where e.show_id = s.tmdb_id
        and e.release_at <= now() and e.season > 0
        and not exists (select 1 from watched w where w.episode_id = e.tmdb_id))
     and s.status in ('Ended','Canceled'))                                as shows_completed;
