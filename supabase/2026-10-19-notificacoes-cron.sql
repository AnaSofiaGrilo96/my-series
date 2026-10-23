-- Notificações push — parte 2: agendar a chamada à Edge Function de 5 em 5 minutos.
-- Antes de correr: fazer deploy da função (ver README) e substituir os dois valores entre <>.
--   <PROJECT_REF>  — o id do projeto (está no URL do Supabase: https://<PROJECT_REF>.supabase.co)
--   <CRON_SECRET>  — o mesmo valor que definiste nos secrets da função (supabase secrets set CRON_SECRET=...)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notify-releases') where exists (select 1 from cron.job where jobname = 'notify-releases');
select cron.schedule('notify-releases', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-releases',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <CRON_SECRET>"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000   -- o pg_net desiste ao fim de 5 s por omissão; com arranque a frio + envios a função pode demorar mais
  );
$$);
