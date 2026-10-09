import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LibraryService } from '../core/library.service';
import { IMG } from '../core/tmdb.service';

/** Cartão de episódio: série, SxxExx, título e botão de "visto". */
@Component({
  selector: 'app-episode-card',
  imports: [RouterLink],
  template: `
    <div class="ep" [class.past]="watched()">
      @if (poster()) { <img [src]="poster()" alt="" loading="lazy" /> } @else { <div class="noimg"></div> }
      <div class="body">
        <a class="show" [routerLink]="['/serie', showId()]">{{ showName() }} ›</a>
        <div class="code">S{{ pad(season()) }} | E{{ pad(number()) }}
          @if (remaining() > 1) { <small>+{{ remaining() - 1 }}</small> }
        </div>
        <div class="title">{{ title() || subtitle() }}</div>
      </div>
      <button class="check" [class.done]="watched()" (click)="toggle.emit()" [attr.aria-label]="watched() ? 'Desmarcar' : 'Marcar como visto'">
        <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `,
})
export class EpisodeCardComponent {
  private lib = inject(LibraryService);
  showId = input.required<number>();
  season = input.required<number>();
  number = input.required<number>();
  title = input<string | null | undefined>();
  subtitle = input<string>('');
  remaining = input(0);
  watched = input(false);
  toggle = output<void>();

  showName = computed(() => this.lib.showById().get(this.showId())?.name ?? '');
  poster = computed(() => IMG.poster(this.lib.showById().get(this.showId())?.poster_path));
  pad = (n: number) => String(n).padStart(2, '0');
}
