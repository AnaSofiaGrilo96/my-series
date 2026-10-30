-- Diagnóstico das notificações push — só leituras. Colar tudo no SQL Editor do Supabase e correr: sai UMA tabela com um passo por linha.
-- (O SQL Editor só mostra o resultado da última instrução, por isso está tudo numa única query.)
-- A coluna `resultado` pode ser copiada tal e qual para o Claude: o secret do cron sai tapado.
--
-- Como ler:  1 vazio/0 → o telemóvel não ficou registado (Perfil → Desativar → Ativar e ver o erro no cartão)
--            2 "NÃO AGENDADO" ou com <...> → correr o 2026-10-19-notificacoes-cron.sql com os valores reais
--            3 sem linhas ou "failed" → o pg_cron não está a chamar a função
--            4 401 → secret do cron ≠ secret da função;  404 → função não publicada (supabase functions deploy);
--              500 → ler o erro;  "Timeout" → voltar a correr o SQL do cron (timeout 30 s);  vazio → o cron não corre (o pg_net guarda ~6 h)
--            5/6 → o que saiu nas últimas 48 h e o que a função enviaria agora
select 1 as passo, 'dispositivos registados (push_subscriptions)' as pergunta,
       (select count(*)::text || ' — último a ' || coalesce(to_char(max(created_at), 'DD/MM HH24:MI'), '-') from push_subscriptions) as resultado
union all
select 2, 'cron agendado',
       coalesce((select 'active=' || active || ' ' || schedule || ' → ' || regexp_replace(command, 'Bearer [^"'']+', 'Bearer ***', 'g')
                   from cron.job where jobname = 'notify-releases'), 'NÃO AGENDADO')
union all
select 3, 'últimas execuções do cron',
       coalesce((select string_agg(to_char(start_time, 'DD HH24:MI') || ' ' || status || coalesce(' ' || return_message, ''), ' | ' order by start_time desc)
                   from (select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'notify-releases')
                         order by start_time desc limit 6) x), 'nenhuma')
union all
select 4, 'últimas respostas da função (pg_net)',
       coalesce((select string_agg(to_char(created, 'DD HH24:MI') || ' ' || coalesce(status_code::text, '-') || ' ' || coalesce(content::text, '') || coalesce(' ERRO: ' || error_msg, ''), ' | ' order by id desc)
                   from (select * from net._http_response order by id desc limit 6) x), 'nenhuma')
union all
select 5, 'episódios de séries seguidas lançados nas últimas 48 h',
       coalesce((select string_agg(s.name || ' S' || e.season || 'E' || e.number || ' ' || to_char(e.release_at, 'DD HH24:MI')
                                   || ' → ' || coalesce('notificado ' || to_char(e.notified_at, 'DD HH24:MI'), 'POR NOTIFICAR'), ' | ' order by e.release_at desc)
                   from episode_releases e join shows s on s.tmdb_id = e.show_id and s.followed
                   where e.season > 0 and e.release_at > now() - interval '2 days' and e.release_at <= now()), 'nenhum')
union all
select 6, 'o que a função enviaria agora (releases_to_notify)',
       (select count(*)::text || ' episódios' from releases_to_notify)
order by passo;
