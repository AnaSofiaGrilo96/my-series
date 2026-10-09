# MySeries — especificação funcional

Documento de referência do que a app faz hoje. Atualizar sempre que o comportamento mudar
(é daqui que se parte em cada nova alteração). Última revisão: 2026-10-09.

## 1. Objetivo e contexto
- App pessoal, de um único utilizador, para gerir séries: o que já viu, o que está a ver, o que vai estrear.
- Design: menu em baixo, abas "Lista para ver" e "Brevemente", perfil com estatísticas e grelhas de posters.
- Dados do utilizador vivem no Supabase (Postgres + Auth). Metadados, pesquisa, posters e episódios vêm do TMDB
  (em `pt-PT`). Os dados históricos foram importados uma vez por um script local
  (em `local/`, fora do repo). **As datas `watched_at` dessa importação são todas do mesmo dia**
  e não refletem o hábito real — ver §5.3.

## 2. Stack e infraestrutura
- Angular 19 standalone + signals, PWA (service worker `ngsw`), SCSS global em `src/styles.scss` (tema escuro, amarelo `--accent`).
- Supabase JS v2; sessão por email + palavra-passe. RLS: tudo permitido a `authenticated`, nada a anónimos.
- TMDB API v3 com *API Read Access Token* (Bearer). Imagens: poster `w342`, backdrop `w780`, still `w300`.
- Deploy: push em `main` → GitHub Actions escreve `environment.ts` a partir dos *secrets* (`SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `TMDB_TOKEN`), `ng build --base-href /<repo>/`, copia `index.html` → `404.html`, publica em GitHub Pages.
- Identidade: ícone "ecrã com visto" (fundo amarelo `#ffd400`, televisor preto com ✓ amarelo), fonte em `public/icons/icon.svg`;
  PNGs 72–512 (maskable) + `apple-touch-icon.png` (180) + `favicon.ico` gerados a partir dele. Manifest: nome "MySeries", `theme_color`/`background_color` pretos, retrato.
- Local: `npm start` (`ng serve`); `src/environments/environment.ts` preenchido a partir do `environment.example.ts` (ignorado pelo git).

## 3. Modelo de dados (Supabase, `supabase/schema.sql`)
| Tabela | Chave | Campos relevantes |
|---|---|---|
| `shows` | `tmdb_id` | `name`, `original_name`, `poster_path`, `backdrop_path`, `overview`, `status` (texto TMDB: Returning Series / Ended / Canceled / In Production / Planned), `first_air_date`, `episode_run_time`, `genres[]`, `networks[]`, `followed` (default true), `favorite` (default false), `added_at`, `last_synced_at` |
| `episodes` | `tmdb_id` | `show_id` → shows (cascade), `season`, `number`, `name`, `air_date`, `runtime`, `overview`, `still_path`; único `(show_id, season, number)` |
| `watched` | `episode_id` → episodes (cascade) | `show_id`, `watched_at` (default now) |

Vistas:
- `next_to_watch` — por série **seguida**, o primeiro episódio já emitido (`air_date <= hoje`, `season > 0`) e não visto.
  Colunas: `show_id, episode_id, season, number, name, air_date, runtime, remaining` (nº de episódios emitidos por ver),
  `last_watched_at` (data em que viu o último episódio da série), `last_watched_air_date` (data de emissão desse episódio).
- `stats` — `episodes_watched`, `minutes_watched` (runtime do episódio, senão da série, senão 45), `shows_followed`,
  `shows_favorite`, `shows_ended`, `shows_canceled`, `shows_completed` (seguidas, Ended/Canceled e sem nada por ver).

Regras gerais: temporada 0 (especiais) é ignorada em todas as listas e contagens. Alterações ao schema depois da criação
ficam em ficheiros datados em `supabase/` (ex.: `2026-10-09-next-to-watch-last-watched.sql`), a correr por ordem no SQL Editor;
o `schema.sql` é mantido também atualizado para instalação de raiz.

## 4. Conceitos
- **Seguir** (`followed`): o único estado de relação com uma série. Seguir = entra nas listas (Lista para ver, Brevemente),
  na sincronização e no Perfil a cores. Desseguir mantém a série e o histórico, mas sai das listas e fica esbatida no Perfil.
- Não existe "favorita": a coluna `favorite` ficou na BD por legado (sempre false para séries novas) e não aparece na UI.
- **Remover**: apaga a série e, por cascata, episódios e histórico (pede confirmação).
- **Estado de uma série** (`LibraryService.stateOf`), por ordem de prioridade:
  1. `pending` — tem episódios emitidos por ver (está em `next_to_watch`);
  2. `ended` — `status` Ended ou Canceled e nada por ver;
  3. `done` — tudo visto e ainda em emissão.
  Cores: pending = amarelo (`--accent`), done = verde (`--ok`), ended = roxo `#8e44ff`.

## 5. Ecrãs

### 5.1 Login (`/login`)
Email + palavra-passe (Supabase). Erro genérico "Email ou palavra-passe incorretos.". Rotas protegidas por `authGuard`
(sem sessão → `/login`). Após login → `/series`. Rota desconhecida → `/series`.

### 5.1b Nova versão
O service worker verifica atualizações ao arrancar e sempre que a app volta ao primeiro plano. Quando uma nova versão está
descarregada (`VERSION_READY`), aparece um aviso amarelo fixo acima da barra de navegação, "Há uma nova versão da app." com
botão **Atualizar** que recarrega a página. Só em produção (o service worker está desligado em `ng serve`).

### 5.2 Navegação
Barra fixa em baixo (só com sessão): **Séries** (`/series`), **Explorar** (`/explorar`), **Perfil** (`/perfil`).
Ao abrir qualquer página, se a biblioteca ainda não carregou, `loadAll()`; na página Séries corre também `syncFollowed()`.

### 5.3 Séries (`/series`) — abas sticky no topo
**Lista para ver**
1. Histórico (últimos 80 episódios vistos), do mais antigo em cima para o mais recente em baixo, cartões a 60% de opacidade; o ✓ desmarca.
2. Âncora `#first-to-watch`: ao abrir a página (e ao voltar a esta aba) o scroll é posicionado aqui, descontando a altura das abas
   sticky (segunda passagem aos 300 ms para esperar pelas imagens).
3. Episódios por ver — um cartão por série (o próximo), com `+N` quando faltam mais. Divididos em duas secções:
   - **A acompanhar** — a série cumpre uma de duas condições:
     a) viu um episódio nos últimos `RECENT_DAYS` (30) dias, considerando só `watched_at >= MIGRATION_DATE` (2026-10-09),
        porque as datas da importação inicial são todas iguais;
     b) está em dia com uma série em emissão: `last_watched_air_date` há menos de `CURRENT_AIR_DAYS` (90) dias
        e `remaining <= CURRENT_MAX_REMAINING` (3).
   - **Há algum tempo sem ver** — as restantes, incluindo séries seguidas mas nunca começadas.
   Dentro de cada secção a ordem é a da vista (`air_date` do próximo episódio, ascendente).
   Se não houver nada por ver: "Tudo visto".
   O ✓ marca o episódio como visto (`watched_at = agora`) e recarrega next/histórico/stats.

**Brevemente**
Todos os episódios futuros (`air_date > hoje`) das séries seguidas, até 200, agrupados por dia
("quinta-feira, 29 outubro"), da data mais próxima para a mais distante. Ao mudar para esta aba o scroll vai ao topo.
O ✓ também existe (marca como visto). Vazio: "Nada agendado".

**Cartão de episódio** (`app-episode-card`): poster da série, nome da série (link para a página da série), `Sxx | Exx` (+N), título, botão ✓.

### 5.4 Explorar (`/explorar`)
Campo de pesquisa (debounce 350 ms) sobre `search/tv` do TMDB; sem pesquisa mostra "Em alta esta semana" (`trending/tv/week`).
Grelha 3 colunas de posters com nome; ✓ verde se a série já está a ser seguida. Clique → página da série.

### 5.5 Página da série (`/serie/:id`)
- Hero com backdrop, nome, ano, estado traduzido (Em emissão / Terminada / Cancelada / Em produção / Planeada) e canais.
- Ações: se não está na biblioteca, **+ Seguir série** (`addShow`: grava série + todos os episódios de todas as temporadas e abre a aba Episódios);
  se está, **A seguir ✓ / Seguir** (toggle `followed`) e **Remover**.
- Abas **Sobre** (géneros, duração, sinopse) e **Episódios** (só se a série está na biblioteca): acordeão por temporada, cada cabeçalho com
  poster da temporada (TMDB, em runtime, não guardado), "Temporada N", `vistos/emitidos` (+ "N por estrear") e seta que roda ao abrir;
  cada episódio em linha larga com imagem (`still_path`), código `S01 E01` em amarelo, título por baixo e data (`d MMM yyyy`);
  episódios futuros a 45% e sem ✓;
  botão "Marcar temporada N como vista" marca todos os episódios **até ao último emitido dessa temporada, inclusive, e todos os anteriores** (`markUpTo`).

### 5.6 Perfil (`/perfil`)
- Cabeçalho com botão **Sair**.
- Tempo total a ver séries (`d h m` a partir de `minutes_watched`) em cartão amarelo.
- Seis estatísticas: episódios vistos, séries a seguir, séries completas, terminadas, canceladas, episódios por ver (soma de `remaining`).
- **As minhas séries**: grelha de todas as séries da biblioteca, cada poster com **barra de 4 px no topo** na cor do estado (§4),
  ordenadas por estado (por ver → tudo visto → terminadas) e alfabeticamente (`pt`) dentro de cada grupo; séries não seguidas a 45% de opacidade.

## 6. Sincronização com o TMDB (`syncFollowed`)
Ao abrir a página Séries: para cada série seguida cujo `status` não seja Ended/Canceled e com `last_synced_at` há mais de
12 h (ou nulo), volta a buscar a série e todos os episódios ao TMDB e faz upsert. Sinal `syncing` durante o processo.
Consequência: uma data de estreia acabada de anunciar pode demorar até ~12 h a aparecer no Brevemente.

## 7. Constantes afináveis (`src/app/core/library.service.ts`)
`SYNC_HOURS = 12`, `RECENT_DAYS = 30`, `CURRENT_AIR_DAYS = 90`, `CURRENT_MAX_REMAINING = 3`, `MIGRATION_DATE = '2026-10-09'`.

## 8. Ideias em aberto (não implementadas)
- Toggle manual "a acompanhar" por série, caso a divisão automática da Lista para ver não bata certo.
- Barra de estado também na grelha do Explorar.
- Botão para forçar atualização de uma série a partir do TMDB na página da série.

## 9. Histórico de alterações
- 2026-10-08 — Projeto criado; importação inicial do histórico.
- 2026-10-09 — Aviso de nova versão (service worker) com botão Atualizar.
- 2026-10-09 — Página da série: aba Episódios redesenhada (posters de temporada, stills, S01 E01, seta de expandir).
- 2026-10-09 — Removido o conceito de favorita (só existe seguir); Perfil com uma única grelha "As minhas séries" e estatística de episódios por ver; ✓ no Explorar para séries seguidas.
- 2026-10-09 — Ícone e nome da app (manifest, favicon, apple-touch-icon); correção YAML do workflow.
- 2026-10-09 — Barra de estado e ordenação em "Todas as séries"; Lista para ver dividida em "A acompanhar" / "Há algum tempo sem ver"
  (vista `next_to_watch` com `last_watched_at` e `last_watched_air_date`); scroll correto nas duas abas.
