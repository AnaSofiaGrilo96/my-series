import { Injectable, computed, inject, signal } from '@angular/core';
import { GENERIC_EPISODE_NAME, realEpisodeName } from '../shared/episode-name';
import { Episode, NextToWatch, Show, Stats, WatchedRow } from './models';
import { SupabaseService } from './supabase.service';
import { TmdbService } from './tmdb.service';
import { TVMAZE_NOT_FOUND, TvmazeEpisode, TvmazeService } from './tvmaze.service';

const SYNC_HOURS = 12;
/** Série "a acompanhar": viu algum episódio nos últimos N dias... */
export const RECENT_DAYS = 30;
/** ...ou está em dia com uma série em emissão: o último episódio visto foi emitido há menos de N dias e faltam poucos. */
export const CURRENT_AIR_DAYS = 90;
export const CURRENT_MAX_REMAINING = 3;
/** Visualizações registadas antes desta data vieram da migração (todas no mesmo dia) e não dizem nada sobre o hábito. */
export const MIGRATION_DATE = '2026-10-09';
/** Intervalo máximo entre verificações de "já chegou a hora de algum episódio?" com a app aberta. */
const RELEASE_CHECK_MAX_MS = 3600_000;
/** Linhas por pedido ao Supabase (o limite por omissão da Data API). */
const PAGE_ROWS = 1000;
/** Correção dos nomes genéricos já gravados: número máximo de voltas por abertura da app. */
const NAME_FIX_MAX_ROUNDS = 30;
/** Código do Postgres para "já existe uma linha com este valor único" — aqui, dois episódios no mesmo SxxExx. */
const UNIQUE_VIOLATION = '23505';
/** Número provisório de um episódio tirado do caminho enquanto se trocam posições (nunca coincide com um número real). */
const PARKED = -1_000_000;
export type HistoryRow = WatchedRow & { episode: Episode };
export type EpisodeWithWatched = Episode & { watched: boolean };
export type ShowState = 'pending' | 'ended' | 'done';

/** O supabase-js não lança exceções: devolve `{ error }`. Nas escritas passa-se por aqui, para um erro nunca ficar calado. */
function ok<T extends { error: { message: string } | null }>(r: T): T { if (r.error) throw new Error(r.error.message); return r; }

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private sb = inject(SupabaseService).client;
  private tmdb = inject(TmdbService);
  private tvmaze = inject(TvmazeService);
  private releaseTimer: any;

  readonly shows = signal<Show[]>([]);
  readonly next = signal<NextToWatch[]>([]);
  readonly upcoming = signal<Episode[]>([]);
  readonly history = signal<HistoryRow[]>([]);
  readonly stats = signal<Stats | null>(null);
  readonly syncing = signal(false);
  /** Último erro da sincronização (escrita recusada pelo Supabase, TMDB em baixo…); null = correu bem. Mostrado no topo da página Séries. */
  readonly syncError = signal<string | null>(null);
  readonly loaded = signal(false);

  readonly showById = computed(() => new Map(this.shows().map(s => [s.tmdb_id, s])));
  /** Lista para ver, dividida: séries vistas recentemente (a acompanhar) e as que já não vê há algum tempo. */
  readonly nextRecent = computed(() => this.next().filter(n => this.isRecent(n)));
  readonly nextOther = computed(() => this.next().filter(n => !this.isRecent(n)));
  private isRecent(n: NextToWatch) {
    const days = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86400_000;
    // 1) viu mesmo um episódio recentemente (ignora as datas da importação inicial)
    if (n.last_watched_at && n.last_watched_at >= MIGRATION_DATE && days(n.last_watched_at) < RECENT_DAYS) return true;
    // 2) está em dia com uma série em emissão
    return !!n.last_watched_air_date && days(n.last_watched_air_date) < CURRENT_AIR_DAYS && n.remaining <= CURRENT_MAX_REMAINING;
  }
  /** Séries com episódios já emitidos por ver. */
  readonly pendingShows = computed(() => new Set(this.next().map(n => n.show_id)));

  /** Estado de uma série: 'pending' (episódios por ver), 'ended' (terminada/cancelada) ou 'done' (tudo visto). */
  stateOf(show: Show): ShowState {
    if (this.pendingShows().has(show.tmdb_id)) return 'pending';
    if (['Ended', 'Canceled'].includes(show.status ?? '')) return 'ended';
    return 'done';
  }

  async loadAll() {
    await this.loadShows();
    await Promise.all([this.loadNext(), this.loadUpcoming(), this.loadHistory(), this.loadStats()]);
    this.loaded.set(true);
  }
  async loadShows() {
    const { data } = await this.sb.from('shows').select('*').order('name');
    this.shows.set((data ?? []) as Show[]);
  }
  async loadNext() {
    const { data } = await this.sb.from('next_to_watch').select('*').order('release_at');
    this.next.set((data ?? []) as NextToWatch[]);
  }
  /** Episódios ainda não lançados (instante de lançamento > agora, calculado na BD em hora de Lisboa). */
  async loadUpcoming() {
    const followed = this.shows().filter(s => s.followed).map(s => s.tmdb_id);
    if (!followed.length) { this.upcoming.set([]); return; }
    const { data } = await this.sb.from('episode_releases').select('*')
      .in('show_id', followed).gt('release_at', new Date().toISOString()).gt('season', 0).order('release_at').limit(200);
    this.upcoming.set((data ?? []) as Episode[]);
    this.scheduleReleaseCheck();
  }
  /** Quando o próximo lançamento acontecer com a app aberta, passa do Brevemente para a Lista para ver sem recarregar. */
  private scheduleReleaseCheck() {
    clearTimeout(this.releaseTimer);
    const next = this.upcoming()[0]?.release_at;
    if (!next) return;
    const ms = Math.min(Math.max(new Date(next).getTime() - Date.now(), 1000) + 2000, RELEASE_CHECK_MAX_MS);
    this.releaseTimer = setTimeout(() => Promise.all([this.loadNext(), this.loadUpcoming(), this.loadStats()]), ms);
  }
  async loadHistory(limit = 80) {
    const { data } = await this.sb.from('watched').select('*, episode:episodes(*)')
      .order('watched_at', { ascending: false }).limit(limit);
    this.history.set((data ?? []) as any);
  }
  async loadStats() {
    const { data } = await this.sb.from('stats').select('*').single();
    this.stats.set(data as Stats);
  }

  /** Adiciona (ou atualiza) uma série e todos os seus episódios a partir do TMDB. */
  async addShow(tmdbId: number) {
    const existing = this.showById().get(tmdbId);
    const { seasons, ...show } = await this.tmdb.show(tmdbId);
    const tvmaze_id = await this.resolveTvmaze(tmdbId, existing?.tvmaze_id);
    const row: Show = {
      ...show,
      followed: true,
      favorite: existing?.favorite ?? false,   // coluna legada, já não usada na UI
      last_synced_at: new Date().toISOString(),
      tvmaze_id,
    };
    ok(await this.sb.from('shows').upsert(row));
    await this.upsertEpisodes(tmdbId, seasons.map(s => s.season_number), tvmaze_id);
    await this.loadAll();
  }
  /** Id TVmaze da série: o já guardado, ou procura-o pelos ids externos do TMDB (0 = não existe; não volta a procurar). */
  private async resolveTvmaze(tmdbId: number, current?: number | null): Promise<number> {
    if (current != null) return current;
    try { return await this.tvmaze.lookup(await this.tmdb.externalIds(tmdbId)); }
    catch { return TVMAZE_NOT_FOUND; }
  }
  /** Episódios do TMDB + hora de emissão do TVmaze (quando a série lá existe e o episódio tem hora), gravados em `episodes`.
   *  Título: o do TMDB; se o TMDB não o tiver, o do TVmaze — só quando o mesmo SxxExx tem lá o mesmo dia de emissão (numerações diferentes não se misturam). */
  private async upsertEpisodes(tmdbId: number, seasonNumbers: number[], tvmazeId?: number | null) {
    const eps = await this.tmdb.episodes(tmdbId, seasonNumbers);
    if (!eps.length) return;
    let tv = new Map<string, TvmazeEpisode>();
    if (tvmazeId) { try { tv = await this.tvmaze.episodes(tvmazeId); } catch { /* sem TVmaze desta vez; fica a hora do dia e o título do TMDB */ } }
    const rows = eps.map(e => {
      const t = tv.get(`${e.season}-${e.number}`);
      return { ...e, name: e.name ?? (t && t.airdate === e.air_date ? realEpisodeName(t.name) : null), air_at: t?.airstamp ?? null };
    });
    await this.saveEpisodes(tmdbId, rows);
  }
  /** Grava todos os episódios de uma série (upsert pelo id do TMDB). A BD só aceita um episódio por SxxExx; quando o TMDB troca dois ids
   *  de posição (ex.: o E5 e o E6 trocaram entre si) ou substitui o id de um episódio, o upsert é recusado em bloco e a série deixava de
   *  receber episódios e nomes. Nesse caso tiram-se do caminho os episódios que ocupam a posição de outro id e repete-se o upsert;
   *  um id que deixou de existir no TMDB passa o "visto" ao episódio que ficou no lugar dele e é apagado. */
  private async saveEpisodes(showId: number, rows: Episode[]) {
    const upsert = () => this.sb.from('episodes').upsert(rows, { onConflict: 'tmdb_id' });
    let res = await upsert();
    if (res.error?.code === UNIQUE_VIOLATION) {
      const incoming = new Map(rows.map(e => [`${e.season}-${e.number}`, e.tmdb_id]));
      const ids = new Set(rows.map(e => e.tmdb_id));
      const moved = (await this.episodePositions(showId)).filter(d => (incoming.get(`${d.season}-${d.number}`) ?? d.tmdb_id) !== d.tmdb_id);
      for (const d of moved) ok(await this.sb.from('episodes').update({ number: PARKED - d.number }).eq('tmdb_id', d.tmdb_id));
      res = await upsert();
      if (res.error) {   // não era (só) isto: repõe as posições e deixa o erro seguir
        for (const d of moved) await this.sb.from('episodes').update({ number: d.number }).eq('tmdb_id', d.tmdb_id);
      } else for (const d of moved.filter(d => !ids.has(d.tmdb_id))) {
        const { data: w } = await this.sb.from('watched').select('watched_at').eq('episode_id', d.tmdb_id).maybeSingle();
        if (w) ok(await this.sb.from('watched').upsert({ episode_id: incoming.get(`${d.season}-${d.number}`)!, show_id: showId, watched_at: w.watched_at }, { onConflict: 'episode_id', ignoreDuplicates: true }));
        ok(await this.sb.from('episodes').delete().eq('tmdb_id', d.tmdb_id));
      }
    }
    ok(res);
  }
  /** Id e posição (temporada, número) de todos os episódios gravados de uma série. */
  private async episodePositions(showId: number) {
    const all: { tmdb_id: number; season: number; number: number }[] = [];
    for (let from = 0; ; from += PAGE_ROWS) {
      const { data } = ok(await this.sb.from('episodes').select('tmdb_id,season,number').eq('show_id', showId).order('tmdb_id').range(from, from + PAGE_ROWS - 1));
      all.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE_ROWS) return all;
    }
  }
  async setFollowed(tmdbId: number, followed: boolean) {
    await this.sb.from('shows').update({ followed }).eq('tmdb_id', tmdbId);
    await this.loadAll();
  }
  async removeShow(tmdbId: number) {
    await this.sb.from('shows').delete().eq('tmdb_id', tmdbId);
    await this.loadAll();
  }

  async markWatched(episodeId: number, showId: number) {
    await this.sb.from('watched').upsert({ episode_id: episodeId, show_id: showId, watched_at: new Date().toISOString() });
    await this.refreshAfterWatch();
  }
  async unmarkWatched(episodeId: number) {
    await this.sb.from('watched').delete().eq('episode_id', episodeId);
    await this.refreshAfterWatch();
  }
  /** Marca como vistos todos os episódios até ao indicado (inclusive). */
  async markUpTo(showId: number, season: number, number: number) {
    const { data } = await this.sb.from('episodes').select('tmdb_id,season,number')
      .eq('show_id', showId).gt('season', 0)
      .or(`season.lt.${season},and(season.eq.${season},number.lte.${number})`);
    const now = new Date().toISOString();
    const rows = (data ?? []).map(e => ({ episode_id: e.tmdb_id, show_id: showId, watched_at: now }));
    if (rows.length) await this.sb.from('watched').upsert(rows, { onConflict: 'episode_id', ignoreDuplicates: true });
    await this.refreshAfterWatch();
  }
  /** Marca (ou desmarca) como vistos todos os episódios já emitidos de uma temporada. */
  async setSeasonWatched(showId: number, season: number, watched: boolean) {
    const { data } = await this.sb.from('episode_releases').select('tmdb_id').eq('show_id', showId).eq('season', season).lte('release_at', new Date().toISOString());
    const ids = (data ?? []).map(e => e.tmdb_id);
    if (!ids.length) return;
    if (watched) {
      const now = new Date().toISOString();
      await this.sb.from('watched').upsert(ids.map(id => ({ episode_id: id, show_id: showId, watched_at: now })), { onConflict: 'episode_id', ignoreDuplicates: true });
    } else {
      await this.sb.from('watched').delete().in('episode_id', ids);
    }
    await this.refreshAfterWatch();
  }
  private refreshAfterWatch() {
    return Promise.all([this.loadNext(), this.loadHistory(), this.loadStats()]);
  }

  /** Poster da temporada (ou da série, se não houver). */
  posterFor(showId: number, season: number) {
    const s = this.showById().get(showId);
    return s?.season_posters?.[String(season)] ?? s?.poster_path ?? null;
  }

  /** Corre ao abrir a app: atualiza as séries seguidas ainda em emissão e corrige nomes de episódio genéricos que ainda estejam gravados. */
  async syncFollowed() {
    this.syncError.set(null);
    await this.syncStale();
    await this.fixGenericNames();
  }
  /** Regista um erro da sincronização sem a interromper (fica o primeiro; os seguintes costumam ser o mesmo, repetido por série). */
  private syncFailed(what: string, err: unknown) {
    console.error('sincronização:', what, err);
    if (!this.syncError()) this.syncError.set(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
  /** Atualiza episódios das séries seguidas ainda em emissão. Uma série que falhe não impede as seguintes. */
  private async syncStale() {
    const cutoff = Date.now() - SYNC_HOURS * 3600_000;
    // sem `tvmaze_id` (null = nunca procurado): sincroniza já, para receber as horas de emissão sem esperar pelas 12 h
    const stale = this.shows().filter(s => s.followed
      && !['Ended', 'Canceled'].includes(s.status ?? '')
      && (s.tvmaze_id == null || !s.last_synced_at || new Date(s.last_synced_at).getTime() < cutoff))
      // as que estão há mais tempo por sincronizar primeiro: se a app for fechada a meio, a próxima abertura continua em vez de repetir as mesmas
      .sort((a, b) => (a.last_synced_at ?? '').localeCompare(b.last_synced_at ?? ''));
    // séries antigas sem posters de temporada: só a ficha da série, uma vez (não os episódios)
    const noPosters = this.shows().filter(s => !s.season_posters && !stale.includes(s));
    if (!stale.length && !noPosters.length) return;
    this.syncing.set(true);
    try {
      for (const s of stale) {
        try {
          const { seasons, ...show } = await this.tmdb.show(s.tmdb_id);
          const tvmaze_id = await this.resolveTvmaze(s.tmdb_id, s.tvmaze_id);
          // primeiro os episódios; a série só fica marcada como sincronizada (`last_synced_at`) se eles ficaram gravados
          await this.upsertEpisodes(s.tmdb_id, seasons.map(x => x.season_number), tvmaze_id);
          ok(await this.sb.from('shows').update({ ...show, last_synced_at: new Date().toISOString(), tvmaze_id }).eq('tmdb_id', s.tmdb_id));
        } catch (err) { this.syncFailed(s.name, err); }
      }
      for (const s of noPosters) {
        try {
          const { seasons, ...show } = await this.tmdb.show(s.tmdb_id);
          ok(await this.sb.from('shows').update({ season_posters: show.season_posters }).eq('tmdb_id', s.tmdb_id));
        } catch (err) { this.syncFailed('posters das temporadas', err); break; }   // a causa é a mesma para todas: não insiste
      }
      await this.loadAll();
    } finally { this.syncing.set(false); }
  }

  /** Episódios gravados com a numeração no lugar do nome ("Episódio 3" — o TMDB não tinha o título em pt-PT): volta a pedir só as temporadas
   *  afetadas, de qualquer série (seguida ou não, terminada ou não), e grava o título original ou null. Depois de corrigido deixa de haver
   *  linhas assim (a sincronização normal já grava o nome certo), por isso nas aberturas seguintes é só uma leitura vazia.
   *  Não mexe em `air_at`. Uma série que falhe (TMDB em baixo, série removida) fica para a abertura seguinte. */
  private async fixGenericNames() {
    const failed = new Set<number>();
    let changed = false;
    try {
      for (let round = 0; round < NAME_FIX_MAX_ROUNDS; round++) {
        let q = this.sb.from('episodes').select('tmdb_id,show_id,season,number').filter('name', 'imatch', GENERIC_EPISODE_NAME.source).limit(PAGE_ROWS);
        if (failed.size) q = q.not('show_id', 'in', `(${[...failed].join(',')})`);
        const { data } = await q;
        if (!data?.length) break;
        this.syncing.set(true);
        const byShow = new Map<number, typeof data>();
        for (const r of data) byShow.set(r.show_id, [...(byShow.get(r.show_id) ?? []), r]);
        for (const [showId, rows] of byShow) {
          try {
            const eps = await this.tmdb.episodes(showId, [...new Set(rows.map(r => r.season))]);
            const byId = new Map(eps.map(e => [e.tmdb_id, e]));
            const byPos = new Map(eps.map(e => [`${e.season}-${e.number}`, e.name ?? null]));
            const found = rows.filter(r => byId.has(r.tmdb_id)).map(r => byId.get(r.tmdb_id)!);
            if (found.length) ok(await this.sb.from('episodes').upsert(found, { onConflict: 'tmdb_id' }));
            // o id do episódio mudou no TMDB (raro): fica com o nome do mesmo SxxExx, ou sem nome
            for (const r of rows.filter(r => !byId.has(r.tmdb_id))) {
              ok(await this.sb.from('episodes').update({ name: byPos.get(`${r.season}-${r.number}`) ?? null }).eq('tmdb_id', r.tmdb_id));
            }
            changed = true;
          } catch (err) { this.syncFailed(`nomes dos episódios (série ${showId})`, err); failed.add(showId); }
        }
      }
      if (changed) await this.loadAll();
    } finally { this.syncing.set(false); }
  }

  async episodesOf(showId: number): Promise<EpisodeWithWatched[]> {
    const [{ data: eps }, { data: w }] = await Promise.all([
      this.sb.from('episode_releases').select('*').eq('show_id', showId).order('season').order('number'),
      this.sb.from('watched').select('episode_id').eq('show_id', showId),
    ]);
    const watched = new Set((w ?? []).map(x => x.episode_id));
    return ((eps ?? []) as Episode[]).map(e => ({ ...e, watched: watched.has(e.tmdb_id) }));
  }
}
