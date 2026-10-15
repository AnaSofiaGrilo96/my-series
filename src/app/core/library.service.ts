import { Injectable, computed, inject, signal } from '@angular/core';
import { Episode, NextToWatch, Show, Stats, WatchedRow } from './models';
import { SupabaseService } from './supabase.service';
import { TmdbService } from './tmdb.service';
import { TVMAZE_NOT_FOUND, TvmazeService } from './tvmaze.service';

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
export type HistoryRow = WatchedRow & { episode: Episode };
export type EpisodeWithWatched = Episode & { watched: boolean };
export type ShowState = 'pending' | 'ended' | 'done';

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
    await this.sb.from('shows').upsert(row);
    await this.upsertEpisodes(tmdbId, seasons.map(s => s.season_number), tvmaze_id);
    await this.loadAll();
  }
  /** Id TVmaze da série: o já guardado, ou procura-o pelos ids externos do TMDB (0 = não existe; não volta a procurar). */
  private async resolveTvmaze(tmdbId: number, current?: number | null): Promise<number> {
    if (current != null) return current;
    try { return await this.tvmaze.lookup(await this.tmdb.externalIds(tmdbId)); }
    catch { return TVMAZE_NOT_FOUND; }
  }
  /** Episódios do TMDB + hora de emissão do TVmaze (quando a série lá existe e o episódio tem hora), gravados em `episodes`. */
  private async upsertEpisodes(tmdbId: number, seasonNumbers: number[], tvmazeId?: number | null) {
    const eps = await this.tmdb.episodes(tmdbId, seasonNumbers);
    if (!eps.length) return;
    let stamps = new Map<string, string>();
    if (tvmazeId) { try { stamps = await this.tvmaze.airstamps(tvmazeId); } catch { /* sem hora desta vez; fica a do dia */ } }
    const rows = eps.map(e => ({ ...e, air_at: stamps.get(`${e.season}-${e.number}`) ?? null }));
    await this.sb.from('episodes').upsert(rows, { onConflict: 'tmdb_id' });
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

  /** Atualiza episódios das séries seguidas ainda em emissão (corre ao abrir a app). */
  async syncFollowed() {
    const cutoff = Date.now() - SYNC_HOURS * 3600_000;
    // sem `tvmaze_id` (null = nunca procurado): sincroniza já, para receber as horas de emissão sem esperar pelas 12 h
    const stale = this.shows().filter(s => s.followed
      && !['Ended', 'Canceled'].includes(s.status ?? '')
      && (s.tvmaze_id == null || !s.last_synced_at || new Date(s.last_synced_at).getTime() < cutoff));
    // séries antigas sem posters de temporada: só a ficha da série, uma vez (não os episódios)
    const noPosters = this.shows().filter(s => !s.season_posters && !stale.includes(s));
    if (!stale.length && !noPosters.length) return;
    this.syncing.set(true);
    try {
      for (const s of noPosters) {
        const { seasons, ...show } = await this.tmdb.show(s.tmdb_id);
        await this.sb.from('shows').update({ season_posters: show.season_posters }).eq('tmdb_id', s.tmdb_id);
      }
      for (const s of stale) {
        const { seasons, ...show } = await this.tmdb.show(s.tmdb_id);
        const tvmaze_id = await this.resolveTvmaze(s.tmdb_id, s.tvmaze_id);
        await this.sb.from('shows').update({ ...show, last_synced_at: new Date().toISOString(), tvmaze_id }).eq('tmdb_id', s.tmdb_id);
        await this.upsertEpisodes(s.tmdb_id, seasons.map(x => x.season_number), tvmaze_id);
      }
      await this.loadAll();
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
