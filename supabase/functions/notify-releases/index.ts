// Edge Function: envia uma notificação Web Push por cada episódio lançado (vista `releases_to_notify`).
// Chamada pelo pg_cron de 5 em 5 min com `Authorization: Bearer <CRON_SECRET>`.
// Deploy: supabase functions deploy notify-releases --no-verify-jwt
// Secrets: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

/** Caminho da app no GitHub Pages (base-href) — o ícone e o link da notificação são relativos ao scope do service worker. */
const APP_PATH = '/my-series/';
const pad = (n: number) => String(n).padStart(2, '0');

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return new Response('Unauthorized', { status: 401 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const [{ data: eps }, { data: subs }] = await Promise.all([
    sb.from('releases_to_notify').select('*'),
    sb.from('push_subscriptions').select('endpoint, subscription'),
  ]);
  if (!eps?.length) return Response.json({ sent: 0 });

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
  let sent = 0;
  const dead: string[] = [];
  for (const e of eps) {
    // formato que o service worker do Angular (ngsw) mostra sozinho; o clique abre a Lista para ver
    const payload = JSON.stringify({ notification: {
      title: e.show_name,
      body: `S${pad(e.season)} E${pad(e.number)} já saiu${e.name ? ` — ${e.name}` : ''}`,
      icon: `${APP_PATH}icons/icon-192x192.png`, badge: `${APP_PATH}icons/icon-96x96.png`,
      tag: `ep-${e.tmdb_id}`, lang: 'pt-PT',
      data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: 'series' } } },
    } });
    for (const s of subs ?? []) {
      if (dead.includes(s.endpoint)) continue;
      try { await webpush.sendNotification(s.subscription, payload); sent++; }
      catch (err: any) {
        // 404/410 = subscrição expirada ou removida no dispositivo: apaga-se
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint);
        else console.error('push falhou', s.endpoint, err?.statusCode, err?.body ?? err?.message);
      }
    }
  }
  await sb.from('episodes').update({ notified_at: new Date().toISOString() }).in('tmdb_id', eps.map(e => e.tmdb_id));
  if (dead.length) await sb.from('push_subscriptions').delete().in('endpoint', dead);
  return Response.json({ episodes: eps.length, sent, removed: dead.length });
});
