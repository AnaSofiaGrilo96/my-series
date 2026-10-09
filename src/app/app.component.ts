import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { SupabaseService } from './core/supabase.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main class="page"><router-outlet /></main>
    @if (updateReady()) {
      <div class="update">
        <span>Há uma nova versão da app.</span>
        <button (click)="reload()">Atualizar</button>
      </div>
    }
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
export class AppComponent {
  sb = inject(SupabaseService);
  private swUpdate = inject(SwUpdate);
  /** Nova versão já descarregada pelo service worker: mostra o aviso para recarregar (senão só se aplicava ao fechar e reabrir a app). */
  updateReady = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) return;
    this.swUpdate.versionUpdates.pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.updateReady.set(true));
    const check = () => this.swUpdate.checkForUpdate().catch(() => {});
    check();
    // PWA instalada fica muito tempo aberta em segundo plano: volta a verificar sempre que regressa ao primeiro plano
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }
  reload() { document.location.reload(); }
}
