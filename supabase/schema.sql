-- MySeries — esquema completo (executar uma vez no SQL Editor do Supabase)

create table if not exists shows (
  tmdb_id          integer primary key,
  name             text not null,
  original_name    text,
  poster_path      text,
  backdrop_path    text,
  overview         text,
  status           text,               -- Returning Series, Ended, Canceled, ...
  first_air_date   date,
  episode_run_time integer,            -- minutos (média)
  genres           text[],
  networks         text[],
  season_posters   jsonb,               -- { "1": "/poster.jpg", "2": ... } poster de cada temporada (TMDB)
  followed         boolean not null default true,
  favorite         boolean not null default false,
  added_at         timestamptz not null default now(),
  last_synced_at   timestamptz
);

create table if not exists episodes (
  tmdb_id    integer primary key,
  show_id    integer not null references shows(tmdb_id) on delete cascade,
  season     integer not null,
  number     integer not null,
  name       text,
  air_date   date,
  runtime    integer,
  overview   text,
  still_path text,
  unique (show_id, season, number)
);
create index if not exists episodes_show_idx on episodes(show_id);
create index if not exists episodes_air_idx  on episodes(air_date);

create table if not exists watched (
  episode_id integer primary key references episodes(tmdb_id) on delete cascade,
  show_id    integer not null references shows(tmdb_id) on delete cascade,
  watched_at timestamptz not null default now()
);
create index if not exists watched_at_idx on watched(watched_at desc);

-- Vista: próximo episódio por ver, por série seguida
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

-- Vista: estatísticas
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
     and not exists (select 1 from episodes e where e.show_id = s.tmdb_id
        and e.air_date <= current_date and e.season > 0
        and not exists (select 1 from watched w where w.episode_id = e.tmdb_id))
     and s.status in ('Ended','Canceled'))                                as shows_completed;

-- Segurança: só utilizadores autenticados (a app tem um único utilizador)
alter table shows    enable row level security;
alter table episodes enable row level security;
alter table watched  enable row level security;
create policy "auth all shows"    on shows    for all to authenticated using (true) with check (true);
create policy "auth all episodes" on episodes for all to authenticated using (true) with check (true);
create policy "auth all watched"  on watched  for all to authenticated using (true) with check (true);
