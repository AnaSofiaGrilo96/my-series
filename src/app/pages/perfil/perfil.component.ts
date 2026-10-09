import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LibraryService } from '../../core/library.service';
import { SupabaseService } from '../../core/supabase.service';
import { IMG } from '../../core/tmdb.service';

@Component({
  selector: 'app-perfil',
  imports: [RouterLink],
  template: `
    <header class="top"><h1>Perfil</h1><button (click)="logout()">Sair</button></header>
    @if (!lib.stats()) { <div class="spinner"></div> }
    @else {
      <section class="hours">
        <div class="big">{{ hours().d }}<span>d</span> {{ hours().h }}<span>h</span> {{ hours().m }}<span>m</span></div>
        <div class="label">a ver séries</div>
      </section>
      <section class="stats">
        <div><b>{{ s().episodes_watched }}</b><span>episódios vistos</span></div>
        <div><b>{{ s().shows_followed }}</b><span>séries a seguir</span></div>
        <div><b>{{ s().shows_completed }}</b><span>séries completas</span></div>
        <div><b>{{ s().shows_ended }}</b><span>terminadas</span></div>
        <div><b>{{ s().shows_canceled }}</b><span>canceladas</span></div>
        <div><b>{{ toWatch() }}</b><span>episódios por ver</span></div>
      </section>

      <h2 class="section">As minhas séries</h2>
      <div class="grid">
        @for (f of allSorted(); track f.tmdb_id) {
          <a [routerLink]="['/serie', f.tmdb_id]" [class.off]="!f.followed"><div class="state {{ lib.stateOf(f) }}"></div>@if (f.poster_path) { <img [src]="img(f.poster_path)" alt="" loading="lazy" /> }<div class="name">{{ f.name }}</div></a>
        } @empty { <div class="empty" style="grid-column:1/-1">Procura séries em Explorar e carrega em "Seguir".</div> }
      </div>
    }
  `,
  styles: [`
    .top { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--safe-top) + 16px) 16px 8px; h1 { font-size: 24px; } button { color: var(--muted); font-weight: 700; } }
    .hours { margin: 8px 16px; padding: 22px 16px; border-radius: 16px; background: var(--accent); color: var(--on-accent);
      .big { font-size: 40px; font-weight: 800; letter-spacing: -.02em; span { font-size: 18px; margin-right: 8px; } } .label { font-weight: 700; } }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px 16px;
      div { background: var(--surface); border-radius: 12px; padding: 14px 10px; text-align: center; display: flex; flex-direction: column; b { font-size: 24px; } span { color: var(--muted); font-size: 12px; } } }
    .section { font-size: 18px; padding: 20px 14px 4px; }
  `],
})
export class PerfilComponent {
  lib = inject(LibraryService);
  private sb = inject(SupabaseService);
  private router = inject(Router);
  img = IMG.poster;
  s = computed(() => this.lib.stats()!);
  /** Total de episódios emitidos por ver nas séries seguidas. */
  toWatch = computed(() => this.lib.next().reduce((t, n) => t + n.remaining, 0));
  /** Todas as séries: primeiro incompletas, depois completas, por fim terminadas (ordem alfabética dentro de cada grupo). */
  allSorted = computed(() => {
    const rank = { pending: 0, done: 1, ended: 2 };
    return [...this.lib.shows()].sort((a, b) => rank[this.lib.stateOf(a)] - rank[this.lib.stateOf(b)] || a.name.localeCompare(b.name, 'pt'));
  });
  hours = computed(() => { const min = this.s().minutes_watched; return { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60), m: min % 60 }; });
  constructor() { if (!this.lib.loaded()) this.lib.loadAll(); }
  async logout() { await this.sb.signOut(); this.router.navigateByUrl('/login'); }
}
