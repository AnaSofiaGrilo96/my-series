export interface Show {
  tmdb_id: number; name: string; original_name?: string | null;
  poster_path?: string | null; backdrop_path?: string | null; overview?: string | null;
  status?: string | null; first_air_date?: string | null; episode_run_time?: number | null;
  genres?: string[] | null; networks?: string[] | null;
  followed: boolean; favorite: boolean; added_at?: string; last_synced_at?: string | null;
}
export interface Episode {
  tmdb_id: number; show_id: number; season: number; number: number;
  name?: string | null; air_date?: string | null; runtime?: number | null;
  overview?: string | null; still_path?: string | null;
}
export interface NextToWatch {
  show_id: number; episode_id: number; season: number; number: number;
  name?: string | null; air_date?: string | null; runtime?: number | null; remaining: number;
  last_watched_at?: string | null; last_watched_air_date?: string | null;
}
export interface WatchedRow { episode_id: number; show_id: number; watched_at: string; }
export interface Stats {
  episodes_watched: number; minutes_watched: number; shows_followed: number;
  shows_favorite: number; shows_ended: number; shows_canceled: number; shows_completed: number;
}
export interface TmdbSearchResult {
  id: number; name: string; original_name: string; poster_path: string | null;
  first_air_date: string; overview: string; vote_average: number;
}
