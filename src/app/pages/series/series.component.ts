import { AfterViewChecked, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { LibraryService } from '../../core/library.service';
import { EpisodeCardComponent } from '../../shared/episode-card.component';
import { confetti } from '../../shared/confetti';

@Component({
  selector: 'app-series',
  imports: [EpisodeCardComponent, DatePipe],
  template: `
    <div class="toptabs">
      <button [class.on]="tab() === 'lista'" (click)="setTab('lista')">LISTA PARA VER</button>
      <button [class.on]="tab() === 'breve'" (click)="setTab('breve')">BREVEMENTE</button>
    </div>

    @if (!lib.loaded()) { <div class="spinner"></div> }
    @else if (tab() === 'lista') {
      <div class="fade">
      <!-- passado (mais antigo em cima, mais recente logo acima do primeiro por ver) -->
      @for (h of pastOldestFirst(); track h.episode_id) {
        <app-episode-card [showId]="h.show_id" [season]="h.episode.season" [number]="h.episode.number"
          [title]="h.episode.name" [watched]="true" (toggle)="lib.unmarkWatched(h.episode_id)" />
      }
      <div id="first-to-watch"></div>
      @if (!lib.next().length) {
        <div class="empty"><h2>Tudo visto</h2><p>Não há episódios por ver nas séries que segues.</p></div>
      }
      @if (lib.nextRecent().length) {
        <div class="daylabel">A acompanhar</div>
        @for (n of lib.nextRecent(); track n.episode_id; let i = $index) {
          <app-episode-card [showId]="n.show_id" [season]="n.season" [number]="n.number" [title]="n.name" [index]="i"
            [remaining]="n.remaining" (toggle)="watch(n.episode_id, n.show_id, n.season)" />
        }
      }
      @if (lib.nextOther().length) {
        <div class="daylabel">Há algum tempo sem ver</div>
        @for (n of lib.nextOther(); track n.episode_id; let i = $index) {
          <app-episode-card [showId]="n.show_id" [season]="n.season" [number]="n.number" [title]="n.name" [index]="i"
            [remaining]="n.remaining" (toggle)="watch(n.episode_id, n.show_id, n.season)" />
        }
      }
      </div>
    }
    @else {
      <div class="fade">
      @for (g of upcomingByDay(); track g.day) {
        <div class="daylabel">{{ g.day | date:'EEEE, d MMMM':'':'pt-PT' }}</div>
        @for (e of g.items; track e.tmdb_id; let i = $index) {
          <app-episode-card [showId]="e.show_id" [season]="e.season" [number]="e.number" [title]="e.name" [index]="i"
            (toggle)="lib.markWatched(e.tmdb_id, e.show_id)" />
        }
      } @empty {
        <div class="empty"><h2>Nada agendado</h2><p>Quando as séries que segues tiverem datas de estreia, aparecem aqui.</p></div>
      }
      </div>
    }
  `,
})
export class SeriesComponent implements AfterViewChecked {
  lib = inject(LibraryService);
  private el = inject(ElementRef<HTMLElement>);
  tab = signal<'lista' | 'breve'>('lista');
  private scrolled = false;

  pastOldestFirst = computed(() => [...this.lib.history()].reverse());
  upcomingByDay = computed(() => {
    const groups = new Map<string, typeof this.lib.upcoming extends () => infer T ? T : never>();
    for (const e of this.lib.upcoming()) {
      const day = e.air_date ?? '';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(e);
    }
    return [...groups.entries()].map(([day, items]) => ({ day, items }));
  });

  /** Marca como visto e, se com isso a temporada ficou completa (o próximo por ver é de outra temporada ou não há), confetis. */
  async watch(episodeId: number, showId: number, season: number) {
    await this.lib.markWatched(episodeId, showId);
    const next = this.lib.next().find(n => n.show_id === showId);
    if (!next || next.season !== season) confetti();
  }

  /** Muda de aba e repõe o scroll: Brevemente começa na data mais próxima (topo); Lista volta ao primeiro por ver. */
  setTab(t: 'lista' | 'breve') {
    this.tab.set(t);
    this.scrolled = false;
    if (t === 'breve') setTimeout(() => window.scrollTo({ top: 0 }), 0);
  }

  constructor() {
    if (!this.lib.loaded()) this.lib.loadAll().then(() => this.lib.syncFollowed());
  }

  /** Ao abrir, posiciona o scroll no primeiro episódio por ver (o passado fica acima). */
  ngAfterViewChecked() {
    if (this.scrolled || !this.lib.loaded() || this.tab() !== 'lista') return;
    const anchor = this.el.nativeElement.querySelector('#first-to-watch') as HTMLElement | null;
    if (!anchor) return;
    this.scrolled = true;
    // As abas do topo são sticky: compensa a altura delas para o primeiro episódio por ver ficar mesmo visível no topo.
    const tabs = this.el.nativeElement.querySelector('.toptabs') as HTMLElement | null;
    const scroll = () => {
      anchor.style.scrollMarginTop = `${tabs?.offsetHeight ?? 0}px`;
      anchor.scrollIntoView({ block: 'start' });
    };
    setTimeout(scroll, 0);
    setTimeout(scroll, 300);   // segunda passagem depois de as imagens/alturas estabilizarem
  }
}
