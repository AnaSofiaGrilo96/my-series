/** Nome que o TMDB inventa quando um episódio não tem título (ou não o tem traduzido): "Episódio 3", "Episode 3". */
export const GENERIC_EPISODE_NAME = /^(epis[oó]dio|episode)\s*#?\d+$/i;

/** O título do episódio, ou null se estiver vazio ou for só a numeração repetida ("Episódio 3"). */
export const realEpisodeName = (name?: string | null): string | null =>
  name?.trim() && !GENERIC_EPISODE_NAME.test(name.trim()) ? name.trim() : null;
