-- Diagnóstico das notificações push — só leituras; colar no SQL Editor do Supabase e correr tudo.
-- Cada bloco responde a uma pergunta; o primeiro que vier vazio ou com erro é onde a cadeia está partida.

-- 1. Este dispositivo está registado? (uma linha por browser/telemóvel que carregou em Ativar e conseguiu gravar)
--    Vazio → a app não gravou a subscrição (ver o erro no cartão Notificações do Perfil, na versão nova) → Desativar/Ativar outra vez.
select endpoint, created_at from push_subscriptions order by created_at desc;

-- 2. O pg_cron tem o trabalho agendado? (active = true; no command, o url e o secret já têm de estar substituídos — nada entre <>)
select jobid, jobname, schedule, active, command from cron.job where jobname = 'notify-releases';

-- 3. O cron tem corrido de 5 em 5 min? (status succeeded = conseguiu chamar a função; failed → ler return_message)
select status, return_message, start_time
from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'notify-releases')
order by start_time desc limit 12;

-- 4. O que a Edge Function respondeu nas últimas chamadas (o pg_net guarda ~6 h):
--    200 + {"sent":N} → a enviar;   {"aviso":"sem subscrições"} → ver 1;   {"error":...} → ler;
--    401 → CRON_SECRET do cron ≠ secret da função;  404 → função não publicada (supabase functions deploy);  error_msg "Timeout" → voltar a correr o SQL do cron (timeout 30 s).
select id, status_code, content::text, error_msg, created from net._http_response order by id desc limit 12;

-- 5. Episódios de séries seguidas lançados nas últimas 48 h e se já foram notificados (notified_at null = por enviar)
select s.name, e.season, e.number, e.name as episodio, e.release_at, e.notified_at
from episode_releases e join shows s on s.tmdb_id = e.show_id and s.followed
where e.season > 0 and e.release_at > now() - interval '2 days' order by e.release_at desc;

-- 6. O que a função enviaria se corresse agora (vazio é normal se já notificou tudo ou se não saiu nada nas últimas 24 h)
select * from releases_to_notify;
