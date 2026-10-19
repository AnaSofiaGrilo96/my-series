-- Notificações push quando um episódio sai — correr no SQL Editor do Supabase (parte 1: tabelas e vista)

-- Subscrições Web Push dos dispositivos (uma por browser/telemóvel)
create table if not exists push_subscriptions (
  endpoint     text primary key,
  subscription jsonb not null,            -- PushSubscription.toJSON(): endpoint + keys (p256dh, auth)
  created_at   timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists "auth all push_subscriptions" on push_subscriptions;
create policy "auth all push_subscriptions" on push_subscriptions for all to authenticated using (true) with check (true);

-- Quando foi enviada a notificação deste episódio (null = ainda não)
alter table episodes add column if not exists notified_at timestamptz;
-- Os episódios já lançados até hoje não geram notificações retroativas
update episodes set notified_at = now() where notified_at is null and release_at(air_at, air_date) <= now();

-- A vista `episode_releases` foi criada com `e.*`, mas as colunas de uma vista ficam fixas na criação: para incluir `notified_at`
-- (que fica antes de `release_at`, por isso o `or replace` não serve) é preciso apagá-la e recriar também as vistas que dependem dela.
drop view if exists episode_releases cascade;   -- apaga next_to_watch, stats e releases_to_notify (recriadas a seguir)
create view episode_releases as
select e.*, release_at(e.air_at, e.air_date) as release_at from episodes e;

create view next_to_watch as
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

create view stats as
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

-- Episódios a notificar: lançados (hora de Lisboa) nas últimas 24 h, de séries seguidas, não vistos e ainda sem notificação.
-- A janela de 24 h evita avalanches se a função estiver parada algum tempo.
create view releases_to_notify as
select e.tmdb_id, e.show_id, s.name as show_name, e.season, e.number, e.name, e.release_at
from episode_releases e
join shows s on s.tmdb_id = e.show_id and s.followed
where e.season > 0 and e.notified_at is null
  and e.release_at <= now() and e.release_at > now() - interval '1 day'
  and not exists (select 1 from watched w where w.episode_id = e.tmdb_id)
order by e.release_at;
