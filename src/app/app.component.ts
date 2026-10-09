import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SupabaseService } from './core/supabase.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main class="page"><router-outlet /></main>
    @if (sb.session()) {
      <nav class="tabbar">
        <a routerLink="/series" routerLinkActive="on">
          <svg viewBox="0 0 24 24"><path d="M4 7h16v12H4z M8 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          <span>Séries</span>
        </a>
        <a routerLink="/explorar" routerLinkActive="on">
          <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <span>Explorar</span>
        </a>
        <a routerLink="/perfil" routerLinkActive="on">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
          <span>Perfil</span>
        </a>
      </nav>
    }
  `,
})
export class AppComponent { sb = inject(SupabaseService); }
