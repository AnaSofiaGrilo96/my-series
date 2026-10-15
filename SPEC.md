# MySeries — especificação funcional

Documento de referência do que a app faz hoje. Atualizar sempre que o comportamento mudar
(é daqui que se parte em cada nova alteração). Última revisão: 2026-10-14.

## 1. Objetivo e contexto
- App pessoal, de um único utilizador, para gerir séries: o que já viu, o que está a ver, o que vai estrear.
- Design: menu em baixo, abas "Lista para ver" e "Brevemente", perfil com estatísticas e grelhas de posters.
- Dados do utilizador vivem no Supabase (Postgres + Auth). Metadados, pesquisa, posters e episódios vêm do TMDB
  (em `pt-PT`); a **hora** de emissão de cada episódio vem do TVmaze (o TMDB só tem o dia). Os dados históricos foram importados uma vez por um script local
  (em `local/`, fora do repo). **As datas `watched_at` dessa importação são todas do mesmo dia**
  e não refletem o hábito real — ver §5.3.

## 2. Stack e infraestrutura
- Angular 19 standalone + signals, PWA (service worker `ngsw`), SCSS global em `src/styles.scss` (tema escuro; o amarelo `--accent` é a cor de destaque:
  aba ativa, item ativo da barra de baixo, seta da temporada aberta, códigos de episódio, botões principais).
- Supabase JS v2; sessão por email + palavra-passe. RLS: tudo permitido a `authenticated`, nada a anónimos.
- TMDB API v3 com *API Read Access Token* (Bearer). Imagens: poster `w342`, backdrop `w780`, still `w300`.
- TVmaze API (sem chave, ~20 pedidos/10 s — o `TvmazeService` espaça os pedidos 550 ms e repete após 429): `lookup/shows?imdb=|thetvdb=`
  para encontrar a série a partir dos ids externos do TMDB, e `shows/{id}/episodes` para o `airstamp` (instante com fuso do canal).
- Deploy: push em `main` → GitHub Actions escreve `environment.ts` a partir dos *secrets* (`SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `TMDB_TOKEN`), `ng build --base-href /<repo>/`, copia `index.html` → `404.html`, publica em GitHub Pages.
- Identidade: ícone "ecrã com visto" (fundo amarelo `#ffd400`, televisor preto com ✓ amarelo), fonte em `public/icons/icon.svg`;
  PNGs 72–512 (maskable) + `apple-touch-icon.png` (180) + `favicon.ico` gerados a partir dele. Manifest: nome "MySeries", `theme_color`/`background_color` pretos, retrato.
- Local: `npm start` (`ng serve`); `src/environments/environment.ts` preenchido a partir do `environment.example.ts` (ignorado pelo git).

## 3. Modelo de dados (Supabase, `supabase/schema.sql`)
| Tabela | Chave | Campos relevantes |
|---|---|---|
| `shows` | `tmdb_id` | `name`, `original_name`, `poster_path`, `backdrop_path`, `overview`, `status` (texto TMDB: Returning Series / Ended / Canceled / In Production / Planned), `first_air_date`, `episode_run_time`, `genres[]`, `networks[]`, `season_posters` (jsonb `{"1": "/x.jpg"}`, poster por temporada), `followed` (default true), `favorite` (default false), `added_at`, `last_synced_at`, `tvmaze_id` (null = ainda não procurado, 0 = não existe no TVmaze) |
| `episodes` | `tmdb_id` | `show_id` → shows (cascade), `season`, `number`, `name`, `air_date`, `air_at` (instante de emissão do TVmaze; null = só se sabe o dia), `runtime`, `overview`, `still_path`; único `(show_id, season, number)` |
| `watched` | `episode_id` → episodes (cascade) | `show_id`, `watched_at` (default now) |

Função `release_at(air_at, air_date)`: instante em que o episódio fica disponível — `air_at` ou, se não houver, **as 00:00 de Lisboa**
do `air_date` (`at time zone 'Europe/Lisbon'`; é o Postgres que trata do UTC/UTC+1). É a única referência ao fuso no servidor.

Vistas:
- `episode_releases` — `episodes` + `release_at`. A app **lê** episódios daqui (Brevemente, página da série, ✓ de temporada) e escreve em `episodes`.
- `next_to_watch` — por série **seguida**, o primeiro episódio já lançado (`release_at <= now()`, `season > 0`) e não visto.
  Colunas: `show_id, episode_id, season, number, name, air_date, release_at, runtime, remaining` (nº de episódios lançados por ver),
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
   Dentro de cada secção a ordem é a da vista (`release_at` do próximo episódio, ascendente).
   Um episódio só entra aqui **quando chega a hora de lançamento** (não à meia-noite do dia, se a hora for conhecida). Com a app aberta,
   um temporizador (`scheduleReleaseCheck`, no máximo de hora a hora) recarrega as listas quando o próximo lançamento acontece.
   Se não houver nada por ver: "Tudo visto".
   O ✓ marca o episódio como visto (`watched_at = agora`) e recarrega next/histórico/stats.

**Brevemente**
Todos os episódios ainda não lançados (`release_at > agora`) das séries seguidas, até 200, agrupados pelo dia **em hora de Lisboa**
("quinta-feira, 29 de outubro"), do mais próximo para o mais distante; cada cartão mostra a hora de Lisboa (ex.: `02:00`) quando é
conhecida (`air_at`), nada quando só se sabe o dia. Formatação com `Intl` e `timeZone: 'Europe/Lisbon'` (`shared/time.ts`), por isso a
mudança de hora (UTC ↔ UTC+1) é automática e as horas são sempre as de Lisboa mesmo com o telemóvel noutro fuso. Ao mudar para esta aba o scroll vai ao topo.
O ✓ também existe (marca como visto). Vazio: "Nada agendado".

**Cartão de episódio** (`app-episode-card`): poster da **temporada** do episódio (`season_posters`, senão o da série), nome da série em *pill* (link para a página da série), `Sxx | Exx` (+N), título, botão ✓.
O ✓ responde de imediato (estado otimista + vibração curta no Android + animação *pop*); a lista real atualiza quando o servidor responder.

### 5.4 Explorar (`/explorar`)
Campo de pesquisa (debounce 350 ms) sobre `search/tv` do TMDB; sem pesquisa mostra "Em alta esta semana" (`trending/tv/week`).
Grelha 3 colunas de posters com nome; ✓ verde se a série já está a ser seguida. Clique → página da série.

### 5.5 Página da série (`/serie/:id`)
- Hero com backdrop, nome, ano, estado traduzido (Em emissão / Terminada / Cancelada / Em produção / Planeada) e canais.
- Ações: se não está na biblioteca, **+ Seguir série** (`addShow`: grava série + todos os episódios de todas as temporadas e abre a aba Episódios);
  se está, **A seguir ✓ / Seguir** (toggle `followed`) e **Remover**.
- Abas **Sobre** (géneros, duração, sinopse) e **Episódios** (só se a série está na biblioteca): acordeão por temporada, cada cabeçalho com
  poster da temporada (TMDB, em runtime, não guardado), "Temporada N", `vistos/emitidos` (+ "N por estrear") e seta que roda ao abrir;
  cada episódio em linha larga com imagem (`still_path`), código `S01 E01` em amarelo, título por baixo e data (`29 out 2026`, com
  ` · 21:00` em hora de Lisboa quando a hora é conhecida); episódios ainda não lançados (`release_at` no futuro) a 45% e sem ✓.
  Cada temporada com episódios emitidos tem o seu próprio ✓ no cabeçalho: verde quando todos os emitidos estão vistos; tocar marca
  todos os emitidos dessa temporada (só dessa) como vistos, ou desmarca todos se já estava completa (`setSeasonWatched`, otimista, confetis ao marcar).
  (`markUpTo`, que marca até um episódio inclusive e todos os anteriores, continua no serviço mas sem botão na UI.)

### 5.6 Perfil (`/perfil`)
- Cabeçalho com botão **Sair**.
- Tempo total a ver séries (`d h m` a partir de `minutes_watched`) em cartão amarelo.
- Seis estatísticas: episódios vistos, séries a seguir, séries completas, terminadas, canceladas, episódios por ver (soma de `remaining`).
- **As minhas séries**: grelha de todas as séries da biblioteca, cada poster com **barra de 4 px no topo** na cor do estado (§4),
  ordenadas por estado (por ver → tudo visto → terminadas) e alfabeticamente (`pt`) dentro de cada grupo; séries não seguidas a 45% de opacidade.

## 5.7 Animações e feedback
- Mudança de página: cross-fade curto (router `withViewTransitions`). Mudança de aba: o conteúdo entra com *fade-up*.
- Listas: cada item entra com *fade-up* escalonado pela posição (`--i`, máx. 12 × 28 ms).
- Botões: encolhem ligeiramente ao toque; o ✓ faz *pop* ao ficar verde. `prefers-reduced-motion` desliga as animações.
- Na página da série, marcar/desmarcar um episódio é otimista (muda logo, grava em segundo plano, sem spinner).
- **Confetis** (`shared/confetti.ts`, canvas sem dependências) quando uma temporada fica completa: ao marcar na Lista para ver o último
  episódio por ver de uma temporada (o próximo por ver passa a ser de outra temporada, ou não há), ou na página da série ao marcar o último
  episódio emitido da temporada / ✓ da temporada.

## 6. Sincronização com o TMDB e TVmaze (`syncFollowed`)
Ao abrir a página Séries: para cada série seguida cujo `status` não seja Ended/Canceled e com `last_synced_at` há mais de
12 h (ou nulo), **ou ainda sem `tvmaze_id`**, volta a buscar a série e todos os episódios ao TMDB e faz upsert. Na mesma passagem (e ao seguir uma série nova):
se `tvmaze_id` ainda é null, procura a série no TVmaze pelos ids externos do TMDB (IMDb, depois TVDB) e guarda o id (0 se não existir —
não volta a procurar); se existe, vai buscar os `airstamp` dos episódios e grava `air_at` nos que têm hora (emparelhados por temporada+número;
os restantes ficam a null → 00:00 de Lisboa). Falhas do TVmaze não impedem a sincronização do TMDB. Séries sem `season_posters` (anteriores à coluna)
recebem só a ficha da série, uma vez. Sinal `syncing` durante o processo.
Consequência: uma data de estreia acabada de anunciar pode demorar até ~12 h a aparecer no Brevemente.

## 7. Constantes afináveis (`src/app/core/library.service.ts`)
`SYNC_HOURS = 12`, `RECENT_DAYS = 30`, `CURRENT_AIR_DAYS = 90`, `CURRENT_MAX_REMAINING = 3`, `MIGRATION_DATE = '2026-10-09'`.

## 8. Ideias em aberto (não implementadas)
- Toggle manual "a acompanhar" por série, caso a divisão automática da Lista para ver não bata certo.
- Barra de estado também na grelha do Explorar.
- Botão para forçar atualização de uma série a partir do TMDB na página da série.

## 9. Histórico de alterações
- 2026-10-08 — Projeto criado; importação inicial do histórico.
- 2026-10-09 — ✓ por temporada na página da série (marca/desmarca todos os emitidos).
- 2026-10-09 — Posters por temporada nos cartões das listas (coluna `season_posters`).
- 2026-10-09 — Animações, feedback imediato no ✓, confetis ao completar temporada, nome da série em pill.
- 2026-10-09 — Aviso de nova versão (service worker) com botão Atualizar.
- 2026-10-09 — Página da série: aba Episódios redesenhada (posters de temporada, stills, S01 E01, seta de expandir).
- 2026-10-09 — Removido o conceito de favorita (só existe seguir); Perfil com uma única grelha "As minhas séries" e estatística de episódios por ver; ✓ no Explorar para séries seguidas.
- 2026-10-09 — Ícone e nome da app (manifest, favicon, apple-touch-icon); correção YAML do workflow.
- 2026-10-09 — Barra de estado e ordenação em "Todas as séries"; Lista para ver dividida em "A acompanhar" / "Há algum tempo sem ver"
  (vista `next_to_watch` com `last_watched_at` e `last_watched_air_date`); scroll correto nas duas abas.
- 2026-10-13 — Correção: barra de estado dos posters deixava de ficar por baixo do menu inferior ao fazer scroll (`.tabbar` sem z-index).
- 2026-10-14 — Hora de lançamento dos episódios (TVmaze → `episodes.air_at`, `shows.tvmaze_id`; função `release_at` e vista `episode_releases`;
  `next_to_watch`/`stats` por instante em vez de dia). Lista para ver só a partir da hora; Brevemente e página da série mostram a hora de Lisboa.
  Correr `supabase/2026-10-14-hora-de-lancamento.sql`.
