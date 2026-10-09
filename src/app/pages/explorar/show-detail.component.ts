import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe, Location } from '@angular/common';
import { EpisodeWithWatched, LibraryService } from '../../core/library.service';
import { IMG, ShowDetail, TmdbService } from '../../core/tmdb.service';
import { confetti, tap } from '../../shared/confetti';

@Component({
  selector: 'app-show-detail',
  imports: [DatePipe],
  template: `
    <button class="back" (click)="loc.back()" aria-label="Voltar">←</button>
    @if (!detail()) { <div class="spinner"></div> }
    @else {
      <header class="hero" [style.background-image]="'url(' + backdrop() + ')'">
        <div class="shade">
          <h1>{{ detail()!.name }}</h1>
          <div class="meta">{{ detail()!.first_air_date?.slice(0,4) }} · {{ statusLabel() }} · {{ detail()!.networks?.join(', ') }}</div>
        </div>
      </header>

      <div class="actions">
        @if (!saved()) {
          <button class="btn" (click)="add()" [disabled]="busy()">+ Seguir série</button>
        } @else {
          <button class="btn ghost" (click)="toggleFollow()" [disabled]="busy()">{{ saved()!.followed ? 'A seguir ✓' : 'Seguir' }}</button>
          <button class="btn ghost danger" (click)="remove()" [disabled]="busy()">Remover</button>
        }
      </div>

      @if (busy()) { <div class="spinner"></div> }

      <div class="toptabs sub">
        <button [class.on]="tab() === 'sobre'" (click)="tab.set('sobre')">SOBRE</button>
        <button [class.on]="tab() === 'eps'" (click)="tab.set('eps')" [disabled]="!saved()">EPISÓDIOS</button>
      </div>

      @if (tab() === 'sobre') {
        <section class="about">
          <p class="genres">{{ detail()!.genres?.join(', ') }} @if (detail()!.episode_run_time) { · {{ detail()!.episode_run_time }} min }</p>
          <p>{{ detail()!.overview || 'Sem sinopse disponível.' }}</p>
        </section>
      } @else {
        @for (s of seasons(); track s.season) {
          <div class="season" [class.open]="open() === s.season">
            <div class="season-h">
              <button class="expand" (click)="open.set(open() === s.season ? null : s.season)" [attr.aria-expanded]="open() === s.season">
                @if (seasonPoster(s.season)) { <img class="sposter" [src]="seasonPoster(s.season)" alt="" loading="lazy" /> } @else { <div class="sposter noimg"></div> }
                <div class="sbody">
                  <div class="st">Temporada {{ s.season }}</div>
                  <div class="sd">{{ s.watched }}/{{ s.aired }} vistos @if (s.items.length > s.aired) { · {{ s.items.length - s.aired }} por estrear }</div>
                </div>
                <svg class="chev" viewBox="0 0 24 24"><path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              @if (s.aired > 0) {
                <button class="check" [class.done]="s.watched === s.aired" [class.pop]="justSeason() === s.season" (click)="toggleSeason(s)"
                  [attr.aria-label]="s.watched === s.aired ? 'Desmarcar temporada' : 'Marcar temporada como vista'">
                  <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              }
            </div>
            @if (open() === s.season) {
              @for (e of s.items; track e.tmdb_id; let i = $index) {
                <div class="row fade-in" [class.future]="isFuture(e.air_date)" [style.--i]="i">
                  @if (e.still_path) { <img class="still" [src]="still(e.still_path)" alt="" loading="lazy" /> } @else { <div class="still noimg"></div> }
                  <div class="body">
                    <div class="code">S{{ pad(e.season) }} E{{ pad(e.number) }}</div>
                    <div class="t">{{ e.name || 'Sem título' }}</div>
                    <div class="d">{{ e.air_date ? (e.air_date | date:'d MMM yyyy':'':'pt-PT') : 'Sem data' }}</div>
                  </div>
                  @if (!isFuture(e.air_date)) {
                    <button class="check" [class.done]="e.watched" [class.pop]="e.watched && justToggled() === e.tmdb_id" (click)="toggleEp(e)" [attr.aria-label]="e.watched ? 'Desmarcar' : 'Marcar como visto'">
                      <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                  }
                </div>
              }
            }
          </div>
        }
      }
    }
  `,
  styles: [`
    .back { position: fixed; top: calc(var(--safe-top) + 12px); left: 12px; z-index: 3; width: 40px; height: 40px; border-radius: 50%; background: rgba(0,0,0,.55); font-size: 22px; }
    .hero { aspect-ratio: 16/9; background: var(--surface) center/cover; display: flex; align-items: flex-end;
      .shade { width: 100%; padding: 60px 16px 14px; background: linear-gradient(transparent, rgba(0,0,0,.95)); }
      h1 { font-size: 28px; } .meta { color: var(--muted); font-size: 13px; margin-top: 4px; } }
    .actions { display: flex; gap: 8px; padding: 14px 16px; overflow-x: auto; .btn { white-space: nowrap; padding: 10px 16px; font-size: 14px; } .danger { color: #ff6b6b; border-color: #ff6b6b; } }
    .toptabs.sub { position: static; padding-top: 0; border-bottom: 1px solid var(--line); button { padding: 10px 0; font-size: 13px; } }
    .about { padding: 16px; color: #ddd; .genres { color: var(--muted); font-size: 14px; } }
    .noimg { background: var(--surface-2); }
    .season-h { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line);
      .expand { flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px; text-align: left; }
      .check { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); color: var(--muted); flex: none; &.done { background: var(--ok); color: #fff; } svg { width: 22px; height: 22px; } }
      .sposter { width: 56px; height: 84px; border-radius: 8px; object-fit: cover; flex: none; }
      .sbody { flex: 1; min-width: 0; } .st { font-size: 17px; font-weight: 800; } .sd { color: var(--muted); font-size: 13px; margin-top: 2px; }
      .chev { width: 26px; height: 26px; color: var(--muted); flex: none; transition: transform .2s; } }
    .season.open .season-h { .chev { transform: rotate(180deg); color: var(--accent); } }
    .row { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--line); &.future { opacity: .45; }
      .still { width: 112px; height: 63px; border-radius: 8px; object-fit: cover; flex: none; }
      .body { flex: 1; min-width: 0; } .code { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--accent); }
      .t { font-size: 15px; font-weight: 600; margin-top: 2px; } .d { color: var(--muted); font-size: 12px; margin-top: 2px; }
      .check { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); color: var(--muted); flex: none; &.done { background: var(--ok); color: #fff; } svg { width: 22px; height: 22px; } } }
  `],
})
export class ShowDetailComponent {
  lib = inject(LibraryService);
  loc = inject(Location);
  private tmdb = inject(TmdbService);

  id = input.required<string>();
  detail = signal<ShowDetail | null>(null);
  episodes = signal<EpisodeWithWatched[]>([]);
  tab = signal<'sobre' | 'eps'>('sobre');
  open = signal<number | null>(null);
  busy = signal(false);

  saved = computed(() => this.lib.showById().get(+this.id()));
  backdrop = computed(() => IMG.backdrop(this.detail()?.backdrop_path) ?? IMG.poster(this.detail()?.poster_path));
  statusLabel = computed(() => ({ 'Returning Series': 'Em emissão', 'Ended': 'Terminada', 'Canceled': 'Cancelada', 'In Production': 'Em produção', 'Planned': 'Planeada' } as any)[this.detail()?.status ?? ''] ?? this.detail()?.status);
  seasons = computed(() => {
    const map = new Map<number, EpisodeWithWatched[]>();
    for (const e of this.episodes()) { if (e.season === 0) continue; (map.get(e.season) ?? map.set(e.season, []).get(e.season))!.push(e); }
    return [...map.entries()].map(([season, items]) => ({
      season, items, aired: items.filter(i => !this.isFuture(i.air_date)).length, watched: items.filter(i => i.watched).length,
    }));
  });

  constructor() {
    effect(() => { const id = +this.id(); this.tmdb.show(id).then(d => this.detail.set(d)); this.reloadEpisodes(); });
    if (!this.lib.loaded()) this.lib.loadAll();
  }
  isFuture = (d?: string | null) => !d || d > new Date().toISOString().slice(0, 10);
  pad = (n: number) => String(n).padStart(2, '0');
  still = IMG.still;
  seasonPoster = (n: number) => IMG.poster(this.detail()?.seasons.find(s => s.season_number === n)?.poster_path);

  private async reloadEpisodes() { if (this.lib.showById().get(+this.id())) this.episodes.set(await this.lib.episodesOf(+this.id())); }
  private async run(fn: () => Promise<unknown>) { this.busy.set(true); try { await fn(); await this.reloadEpisodes(); } finally { this.busy.set(false); } }

  add() { return this.run(() => this.lib.addShow(+this.id())).then(() => this.tab.set('eps')); }
  toggleFollow() { const s = this.saved()!; return this.run(() => this.lib.setFollowed(s.tmdb_id, !s.followed)); }
  remove() { if (confirm('Remover esta série e todo o histórico de episódios vistos?')) return this.run(() => this.lib.removeShow(+this.id())).then(() => this.loc.back()); return; }
  justToggled = signal<number | null>(null);
  private seasonDone(season: number) {
    const s = this.seasons().find(x => x.season === season); return !!s && s.aired > 0 && s.watched === s.aired;
  }
  /** Otimista: muda logo na lista e grava em segundo plano; confetis se a temporada ficou completa. */
  async toggleEp(e: EpisodeWithWatched) {
    tap();
    const wasDone = this.seasonDone(e.season);
    this.episodes.update(list => list.map(x => x.tmdb_id === e.tmdb_id ? { ...x, watched: !e.watched } : x));
    this.justToggled.set(e.tmdb_id);
    if (!wasDone && this.seasonDone(e.season)) confetti();
    try { await (e.watched ? this.lib.unmarkWatched(e.tmdb_id) : this.lib.markWatched(e.tmdb_id, e.show_id)); }
    finally { await this.reloadEpisodes(); }
  }
  justSeason = signal<number | null>(null);
  /** ✓ da temporada: marca todos os episódios emitidos (ou desmarca todos, se já estava completa). Otimista. */
  async toggleSeason(s: { season: number; aired: number; watched: number }) {
    tap();
    const mark = s.watched !== s.aired;
    this.episodes.update(list => list.map(x => x.season === s.season && !this.isFuture(x.air_date) ? { ...x, watched: mark } : x));
    this.justSeason.set(mark ? s.season : null);
    if (mark) confetti({ count: 220 });
    try { await this.lib.setSeasonWatched(+this.id(), s.season, mark); } finally { await this.reloadEpisodes(); }
  }
}
