# MySeries

App pessoal (PWA, Angular 19) para gerir séries: o que já vi, o que estou a ver e o que vai estrear.
Dados próprios no Supabase; metadados, pesquisa e episódios vêm do TMDB.

## Estrutura
- `supabase/schema.sql` — tabelas `shows`, `episodes`, `watched` + vistas `next_to_watch` e `stats`. Correr uma vez.
  Alterações posteriores ao schema ficam em ficheiros datados na mesma pasta (ex.: `2026-10-09-next-to-watch-last-watched.sql`), a correr por ordem.
- `src/app/core` — `supabase.service` (auth), `tmdb.service` (API), `library.service` (listas, vistos, sincronização).
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

## Correr localmente
```
npm install
cp src/environments/environment.example.ts src/environments/environment.ts   # e preencher
npm start
```
