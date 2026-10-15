/** Fuso de referência da app: as horas mostram-se sempre em hora de Lisboa (UTC no inverno, UTC+1 no verão — o Intl trata da mudança). */
export const TZ = 'Europe/Lisbon';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-PT', { timeZone: TZ, ...opts });
const HOUR = fmt({ hour: '2-digit', minute: '2-digit' });
const DAY_LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const DAY_SHORT = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const DAY_KEY = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

/** "21:00h" */
export const hourOf = (iso: string) => HOUR.format(new Date(iso)) + 'h';
/** "quinta-feira, 29 de outubro" */
export const dayLong = (iso: string) => DAY_LONG.format(new Date(iso));
/** "29 out 2026" */
export const dayShort = (iso: string) => DAY_SHORT.format(new Date(iso)).replace('.', '');
/** Dia de Lisboa em que o instante cai, como "AAAA-MM-DD" (para agrupar) */
export const dayKey = (iso: string) => { const p = DAY_KEY.formatToParts(new Date(iso)); const g = (t: string) => p.find(x => x.type === t)!.value; return `${g('year')}-${g('month')}-${g('day')}`; };
