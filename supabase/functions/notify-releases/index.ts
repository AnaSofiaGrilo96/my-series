// Edge Function: envia uma notificação Web Push por cada episódio lançado (vista `releases_to_notify`).
// Chamada pelo pg_cron de 5 em 5 min com `Authorization: Bearer <CRON_SECRET>`.
// Com body `{"test": true}` envia só uma notificação de teste a todos os dispositivos, sem tocar nos episódios.
// Deploy: supabase functions deploy notify-releases --no-verify-jwt
// Secrets: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

/** Caminho da app no GitHub Pages (base-href) — o ícone e o link da notificação são relativos ao scope do service worker. */
const APP_PATH = '/my-series/';
const pad = (n: number) => String(n).padStart(2, '0');

/** Formato que o service worker do Angular (ngsw) mostra sozinho; o clique abre a Lista para ver. */
const payload = (title: string, body: string, tag: string) => JSON.stringify({ notification: {
  title, body, tag, lang: 'pt-PT',
  icon: `${APP_PATH}icons/icon-192x192.png`, badge: `${APP_PATH}icons/icon-96x96.png`,
  data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: 'series' } } },
} });

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return new Response('Unauthorized', { status: 401 });
  const missing = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].filter(k => !Deno.env.get(k));
  if (missing.length) return Response.json({ error: `secrets em falta: ${missing.join(', ')}` }, { status: 500 });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

  const test = await req.json().then(b => b?.test === true).catch(() => false);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const [eps, subs] = await Promise.all([
    test ? { data: [], error: null } : sb.from('releases_to_notify').select('*'),
    sb.from('push_subscriptions').select('endpoint, subscription'),
  ]);
  // Erros de leitura vão na resposta (ficam em net._http_response) em vez de passarem por "nada a enviar"
  if (eps.error || subs.error) return Response.json({ error: (eps.error ?? subs.error)!.message }, { status: 500 });
  if (!subs.data?.length) return Response.json({ episodes: eps.data?.length ?? 0, sent: 0, aviso: 'sem subscrições em push_subscriptions' });
  if (!test && !eps.data?.length) return Response.json({ episodes: 0, sent: 0 });

  const dead = new Set<string>();           // subscrições expiradas ou removidas no dispositivo (404/410): apagam-se
  const errors: string[] = [];              // outras falhas (chaves VAPID, rede…): o episódio fica por notificar e tenta-se outra vez
  const send = async (msg: string) => {
    let n = 0;
    for (const s of subs.data!) {
      if (dead.has(s.endpoint)) continue;
      try { await webpush.sendNotification(s.subscription, msg); n++; }
      catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.add(s.endpoint);
        else { const m = `${err?.statusCode ?? ''} ${err?.body ?? err?.message ?? err}`.trim(); errors.push(m); console.error('push falhou', s.endpoint, m); }
      }
    }
    return n;
  };

  let sent = 0;
  const notified: number[] = [];
  if (test) sent = await send(payload('MySeries', 'As notificações estão a funcionar neste dispositivo.', 'teste'));
  else for (const e of eps.data!) {
    const n = await send(payload(e.show_name, `S${pad(e.season)} E${pad(e.number)} já saiu${e.name ? ` — ${e.name}` : ''}`, `ep-${e.tmdb_id}`));
    sent += n;
    if (n > 0) notified.push(e.tmdb_id);   // só se chegou a algum dispositivo; senão fica para a próxima corrida (dentro da janela de 24 h)
  }
  if (notified.length) await sb.from('episodes').update({ notified_at: new Date().toISOString() }).in('tmdb_id', notified);
  if (dead.size) await sb.from('push_subscriptions').delete().in('endpoint', [...dead]);
  return Response.json({ test, episodes: eps.data?.length ?? 0, devices: subs.data.length, sent, notified: notified.length, removed: dead.size, errors: errors.slice(0, 5) });
});
