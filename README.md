# MySeries

App pessoal (PWA, Angular 19) para gerir séries: o que já vi, o que estou a ver e o que vai estrear.
Dados próprios no Supabase; metadados, pesquisa e episódios vêm do TMDB; a hora de emissão vem do TVmaze.

## Estrutura
- `supabase/schema.sql` — tabelas `shows`, `episodes`, `watched` + vistas `next_to_watch` e `stats`. Correr uma vez.
  Alterações posteriores ao schema ficam em ficheiros datados na mesma pasta (ex.: `2026-10-09-next-to-watch-last-watched.sql`), a correr por ordem.
- `src/app/core` — `supabase.service` (auth), `tmdb.service` (API), `tvmaze.service` (hora de emissão), `library.service` (listas, vistos, sincronização), `push.service` (notificações).
- `supabase/functions/notify-releases` — Edge Function que envia as notificações push (chamada pelo pg_cron de 5 em 5 min).
- `src/app/pages` — `series` (Lista para ver / Brevemente), `explorar` (pesquisa + detalhe da série), `perfil` (estatísticas e grelha das séries), `login`.
- `local/` — scripts locais (migração). **Não vai para o repo.**
- `.github/workflows/deploy.yml` — build e deploy automático para GitHub Pages (chaves vêm dos *secrets*).

## Como funciona
- Ao abrir, `syncFollowed()` atualiza os episódios das séries seguidas ainda em emissão (no máximo de 12 em 12 h).
- **Lista para ver**: histórico (mais antigo em cima) → âncora → próximo episódio por ver de cada série (com `+N` restantes). O scroll abre na âncora, logo abaixo das abas (que são *sticky*).
  Os episódios por ver estão divididos em duas secções:
  - **A acompanhar** — viu um episódio da série nos últimos `RECENT_DAYS` (30) dias, contando só visualizações feitas na app depois de `MIGRATION_DATE`
    (as da importação inicial têm todas a mesma data e não dizem nada sobre o hábito); **ou** está em dia com uma série em emissão: o último episódio visto
    foi emitido há menos de `CURRENT_AIR_DAYS` (90) dias e faltam no máximo `CURRENT_MAX_REMAINING` (3). Constantes em `library.service.ts`.
  - **Há algum tempo sem ver** — as restantes (incluindo séries seguidas mas nunca começadas).
  A vista `next_to_watch` fornece `last_watched_at` e `last_watched_air_date` para este cálculo.
- **Brevemente**: todos os episódios futuros das séries seguidas, agrupados por dia, da data mais próxima para a mais distante. Ao mudar de aba o scroll é reposto (Brevemente no topo; Lista na âncora).
- **Estado de uma série** (`LibraryService.stateOf`): `pending` (há episódios emitidos por ver) → `ended` (terminada/cancelada, nada por ver) → `done` (tudo visto, ainda em emissão). Por esta ordem de prioridade.
- **Perfil → As minhas séries**: cada poster tem uma barra no topo com a cor do estado — amarelo = por ver, verde = tudo visto, roxo = terminada — e a grelha está ordenada por estado (por ver → tudo visto → terminadas), alfabeticamente dentro de cada grupo.
- **Seguir** = aparece nas listas e no Perfil a cores; desseguir mantém o histórico mas tira a série das listas. Não há favoritas.
- **Notificações**: Perfil → Ativar guarda a subscrição Web Push deste dispositivo em `push_subscriptions`. De 5 em 5 min o pg_cron chama a Edge Function
  `notify-releases`, que envia "Série — S03 E04 já saiu" por cada episódio lançado nas últimas 24 h (vista `releases_to_notify`) e marca `episodes.notified_at`.
  O service worker do Angular mostra a notificação; tocar abre a Lista para ver.

## Instalar as notificações (uma vez)
1. Gerar as chaves VAPID: `npx web-push generate-vapid-keys`.
2. Secrets no GitHub (Settings → Secrets → Actions): `VAPID_PUBLIC_KEY` (a chave pública). Localmente, a mesma em `environment.ts` (`vapidPublicKey`).
3. Supabase CLI (`npm i -g supabase`, `supabase login`, `supabase link --project-ref <PROJECT_REF>`), depois:
   ```
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:o-teu-email CRON_SECRET=<uma string aleatória longa>
   supabase functions deploy notify-releases --no-verify-jwt
   ```
4. SQL Editor: correr `supabase/2026-10-19-notificacoes.sql` e depois `supabase/2026-10-19-notificacoes-cron.sql` (substituir `<PROJECT_REF>` e `<CRON_SECRET>`).
5. Na app (versão publicada, no telemóvel): Perfil → Notificações → **Ativar** e aceitar a permissão.
   Para testar sem esperar por um lançamento: `update episodes set notified_at = null where tmdb_id = <id de um episódio lançado hoje>` e chamar a função
   (`curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/notify-releases -H "Authorization: Bearer <CRON_SECRET>"`).

## Correr localmente
```
npm install
cp src/environments/environment.example.ts src/environments/environment.ts   # e preencher
npm start
```
