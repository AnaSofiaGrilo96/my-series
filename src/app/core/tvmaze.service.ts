import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

const BASE = 'https://api.tvmaze.com';
/** O TVmaze aceita ~20 pedidos por 10 s: intervalo mínimo entre pedidos. */
const MIN_GAP_MS = 550;
/** Valor guardado em `shows.tvmaze_id` quando a série não existe no TVmaze (para não voltar a procurar). */
export const TVMAZE_NOT_FOUND = 0;

/** TVmaze: a fonte da hora de emissão (o TMDB só tem a data). Sem chave; horas em `airstamp` (ISO com fuso do canal). */
@Injectable({ providedIn: 'root' })
export class TvmazeService {
  private http = inject(HttpClient);
  private last = 0;

  private async get<T>(path: string): Promise<T | null> {
    const wait = this.last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.last = Date.now();
    try { return await firstValueFrom(this.http.get<T>(`${BASE}${path}`)); }
    catch (e: any) {
      if (e?.status === 429) { await new Promise(r => setTimeout(r, 5000)); return this.get<T>(path); }
      if (e?.status === 404) return null;
      throw e;
    }
  }

  /** Id TVmaze da série a partir dos ids externos do TMDB (IMDb primeiro, depois TVDB); `TVMAZE_NOT_FOUND` se não existir. */
  async lookup(ext: { imdb_id?: string | null; tvdb_id?: number | null }): Promise<number> {
    const tries = [ext.imdb_id && `imdb=${ext.imdb_id}`, ext.tvdb_id && `thetvdb=${ext.tvdb_id}`].filter(Boolean) as string[];
    for (const q of tries) {
      const r = await this.get<{ id: number }>(`/lookup/shows?${q}`);
      if (r?.id) return r.id;
    }
    return TVMAZE_NOT_FOUND;
  }

  /** Instante de emissão por episódio, indexado por "temporada-número". Só episódios com hora conhecida. */
  async airstamps(tvmazeId: number): Promise<Map<string, string>> {
    const eps = await this.get<{ season: number; number: number | null; airtime: string; airstamp: string | null }[]>(`/shows/${tvmazeId}/episodes`);
    const map = new Map<string, string>();
    for (const e of eps ?? []) if (e.number != null && e.airtime && e.airstamp) map.set(`${e.season}-${e.number}`, e.airstamp);
    return map;
  }
}
