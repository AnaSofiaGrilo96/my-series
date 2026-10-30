-- Testar as notificações já, sem esperar pelo cron. Colar no SQL Editor e correr; não é preciso substituir nada:
-- vai buscar o URL e o secret ao próprio trabalho do pg_cron (por isso o cron tem de estar agendado — passo 2 do diagnóstico).
-- Com a função nova, {"test": true} envia "MySeries — As notificações estão a funcionar" a todos os dispositivos registados, sem tocar nos episódios;
-- com a antiga, o body é ignorado e envia o que estiver pendente.
-- Depois esperar ~10 s e correr o diagnostico-notificacoes.sql: a resposta aparece no passo 4.
do $$
declare cmd text; u text; h text;
begin
  select command into cmd from cron.job where jobname = 'notify-releases';
  if cmd is null then raise exception 'O cron notify-releases não está agendado — correr primeiro 2026-10-19-notificacoes-cron.sql'; end if;
  u := substring(cmd from 'url\s*:=\s*''([^'']+)''');
  h := substring(cmd from 'headers\s*:=\s*''([^'']+)''');
  if u is null or h is null then raise exception 'Não consegui ler url/headers do cron: %', cmd; end if;
  perform net.http_post(url := u, headers := h::jsonb, body := '{"test": true}'::jsonb, timeout_milliseconds := 30000);
  raise notice 'Pedido enviado para % — esperar ~10 s e correr o diagnóstico (passo 4).', u;
end $$;
