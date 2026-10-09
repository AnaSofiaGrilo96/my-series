import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { EpisodeWithWatched, LibraryService } from '../../core/library.service';
import { IMG, ShowDetail, TmdbService } from '../../core/tmdb.service';

@Component({
  selector: 'app-show-detail',
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
          <div class="season">
            <button class="season-h" (click)="open.set(open() === s.season ? null : s.season)">
              <span>Temporada {{ s.season }}</span>
              <span class="count">{{ s.watched }}/{{ s.aired }}</span>
            </button>
            @if (open() === s.season) {
              @for (e of s.items; track e.tmdb_id) {
                <div class="row" [class.future]="isFuture(e.air_date)">
                  <div class="num">{{ e.number }}</div>
                  <div class="body">
                    <div class="t">{{ e.name }}</div>
                    <div class="d">{{ e.air_date || 'Sem data' }}</div>
                  </div>
                  @if (!isFuture(e.air_date)) {
                    <button class="check" [class.done]="e.watched" (click)="toggleEp(e)">
                      <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                  }
                </div>
              }
              <button class="markall" (click)="markSeason(s)">Marcar temporada {{ s.season }} como vista</button>
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
    .season-h { width: 100%; display: flex; justify-content: space-between; padding: 14px 16px; font-weight: 800; border-bottom: 1px solid var(--line); .count { color: var(--muted); } }
    .row { display: flex; align-items: center; gap: 12px; padding: 10px 16px; &.future { opacity: .45; }
      .num { width: 28px; color: var(--muted); font-weight: 800; } .body { flex: 1; min-width: 0; } .t { font-size: 15px; } .d { color: var(--muted); font-size: 12px; }
      .check { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); color: var(--muted); &.done { background: var(--ok); color: #fff; } svg { width: 20px; height: 20px; } } }
    .markall { display: block; margin: 8px 16px 16px; color: var(--accent); font-weight: 700; font-size: 14px; }
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

  private async reloadEpisodes() { if (this.lib.showById().get(+this.id())) this.episodes.set(await this.lib.episodesOf(+this.id())); }
  private async run(fn: () => Promise<unknown>) { this.busy.set(true); try { await fn(); await this.reloadEpisodes(); } finally { this.busy.set(false); } }

  add() { return this.run(() => this.lib.addShow(+this.id())).then(() => this.tab.set('eps')); }
  toggleFollow() { const s = this.saved()!; return this.run(() => this.lib.setFollowed(s.tmdb_id, !s.followed)); }
  remove() { if (confirm('Remover esta série e todo o histórico de episódios vistos?')) return this.run(() => this.lib.removeShow(+this.id())).then(() => this.loc.back()); return; }
  toggleEp(e: EpisodeWithWatched) { return this.run(() => e.watched ? this.lib.unmarkWatched(e.tmdb_id) : this.lib.markWatched(e.tmdb_id, e.show_id)); }
  markSeason(s: { season: number; items: EpisodeWithWatched[] }) {
    const last = [...s.items].reverse().find(i => !this.isFuture(i.air_date)); if (!last) return;
    return this.run(() => this.lib.markUpTo(+this.id(), s.season, last.number));
  }
}
