-- Notificações push quando um episódio sai — correr no SQL Editor do Supabase (parte 1: tabelas e vista)

-- Subscrições Web Push dos dispositivos (uma por browser/telemóvel)
create table if not exists push_subscriptions (
  endpoint     text primary key,
  subscription jsonb not null,            -- PushSubscription.toJSON(): endpoint + keys (p256dh, auth)
  created_at   timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "auth all push_subscriptions" on push_subscriptions for all to authenticated using (true) with check (true);

-- Quando foi enviada a notificação deste episódio (null = ainda não)
alter table episodes add column if not exists notified_at timestamptz;
-- Os episódios já lançados até hoje não geram notificações retroativas
update episodes set notified_at = now() where notified_at is null and release_at(air_at, air_date) <= now();

-- Episódios a notificar: lançados (hora de Lisboa) nas últimas 24 h, de séries seguidas, não vistos e ainda sem notificação.
-- A janela de 24 h evita avalanches se a função estiver parada algum tempo.
create or replace view releases_to_notify as
select e.tmdb_id, e.show_id, s.name as show_name, e.season, e.number, e.name, e.release_at
from episode_releases e
join shows s on s.tmdb_id = e.show_id and s.followed
where e.season > 0 and e.notified_at is null
  and e.release_at <= now() and e.release_at > now() - interval '1 day'
  and not exists (select 1 from watched w where w.episode_id = e.tmdb_id)
order by e.release_at;
