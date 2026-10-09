import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TmdbSearchResult } from '../../core/models';
import { LibraryService } from '../../core/library.service';
import { IMG, TmdbService } from '../../core/tmdb.service';

@Component({
  selector: 'app-explorar',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="search">
      <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <input type="search" placeholder="Pesquisa" [ngModel]="query()" (ngModelChange)="onQuery($event)" autocomplete="off" />
    </div>
    <h2 class="section">{{ query() ? 'Resultados' : 'Em alta esta semana' }}</h2>
    @if (busy()) { <div class="spinner"></div> }
    @else {
      <div class="grid">
        @for (r of results(); track r.id) {
          <a [routerLink]="['/serie', r.id]">
            @if (r.poster_path) { <img [src]="img(r.poster_path)" alt="" loading="lazy" /> }
            <div class="name">{{ r.name }}</div>
            @if (lib.showById().get(r.id)?.followed) { <div class="badge" title="A seguir">✓</div> }
          </a>
        } @empty { <div class="empty" style="grid-column: 1/-1">Sem resultados.</div> }
      </div>
    }
  `,
  styles: [`
    .search { display: flex; gap: 12px; align-items: center; margin: 0 16px; padding: calc(var(--safe-top) + 14px) 0 10px; border-bottom: 2px solid var(--line);
      svg { width: 28px; height: 28px; color: var(--muted); flex: none; }
      input { flex: 1; background: none; border: 0; color: var(--text); font-size: 22px; outline: none; &::placeholder { color: var(--muted); } } }
    .section { font-size: 18px; padding: 18px 14px 4px; }
  `],
})
export class ExplorarComponent {
  lib = inject(LibraryService);
  private tmdb = inject(TmdbService);
  query = signal(''); results = signal<TmdbSearchResult[]>([]); busy = signal(false);
  private q$ = new Subject<string>();
  img = IMG.poster;

  constructor() {
    this.q$.pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed()).subscribe(q => this.load(q));
    this.load('');
    if (!this.lib.loaded()) this.lib.loadAll();
  }
  onQuery(q: string) { this.query.set(q); this.q$.next(q.trim()); }
  private async load(q: string) {
    this.busy.set(true);
    try { this.results.set(q ? await this.tmdb.search(q) : await this.tmdb.trending()); }
    finally { this.busy.set(false); }
  }
}
