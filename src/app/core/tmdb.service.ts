import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { Episode, Show, TmdbSearchResult } from './models';

const BASE = 'https://api.themoviedb.org/3';
export const IMG = {
  poster: (p?: string | null) => p ? `https://image.tmdb.org/t/p/w342${p}` : null,
  backdrop: (p?: string | null) => p ? `https://image.tmdb.org/t/p/w780${p}` : null,
  still: (p?: string | null) => p ? `https://image.tmdb.org/t/p/w300${p}` : null,
};

export type ShowDetail = Omit<Show, 'followed' | 'favorite'> & { seasons: { season_number: number }[] };

@Injectable({ providedIn: 'root' })
export class TmdbService {
  private http = inject(HttpClient);
  private headers = new HttpHeaders({ Authorization: `Bearer ${environment.tmdbToken}` });

  private get<T>(path: string, params: Record<string, string> = {}) {
    return firstValueFrom(this.http.get<T>(`${BASE}${path}`, {
      headers: this.headers, params: { language: environment.tmdbLanguage, ...params },
    }));
  }

  search(query: string) {
    return this.get<{ results: TmdbSearchResult[] }>('/search/tv', { query }).then(r => r.results);
  }
  trending() {
    return this.get<{ results: TmdbSearchResult[] }>('/trending/tv/week').then(r => r.results);
  }

  /** Detalhe da série, já no formato da tabela `shows`. */
  async show(id: number): Promise<ShowDetail> {
    const d = await this.get<any>(`/tv/${id}`);
    return {
      tmdb_id: d.id, name: d.name, original_name: d.original_name,
      poster_path: d.poster_path, backdrop_path: d.backdrop_path, overview: d.overview,
      status: d.status, first_air_date: d.first_air_date || null,
      episode_run_time: d.episode_run_time?.[0] ?? d.last_episode_to_air?.runtime ?? null,
      genres: d.genres?.map((g: any) => g.name) ?? [],
      networks: d.networks?.map((n: any) => n.name) ?? [],
      seasons: d.seasons ?? [],
    };
  }

  /** Todos os episódios de todas as temporadas. */
  async episodes(showId: number, seasonNumbers: number[]): Promise<Episode[]> {
    const seasons = await Promise.all(seasonNumbers.map(n => this.get<any>(`/tv/${showId}/season/${n}`)));
    return seasons.flatMap(s => (s.episodes ?? []).map((e: any): Episode => ({
      tmdb_id: e.id, show_id: showId, season: e.season_number, number: e.episode_number,
      name: e.name, air_date: e.air_date || null, runtime: e.runtime ?? null,
      overview: e.overview, still_path: e.still_path,
    })));
  }
}
