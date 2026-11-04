/**
 * A shop's hours as Edit page › Hours edits them (part A PR 7b, the
 * Page-Hours, Page-Hours-Row and Page-Hours-Seasons mockups).
 *
 * In the database each opening is a `page_hours` row. The editor groups
 * them: a set of dates (a season, or all year), then groups of days with the
 * same openings and note, so 8SET's Wednesday (11:00–14:30 and 15:45–17:00)
 * is one group with two openings. Saving flattens the groups back into rows
 * through `set_page_hours()`, which replaces them all in one go.
 *
 * Shops use clock times only; the sunrise and sunset anchors stay for parks.
 */
import type { HoursRow } from './hours';

export type Opening = { start: string; end: string };
export type DayGroup = { key: string; days: number[]; openings: Opening[]; note: string };
export type Season = { startMonth: number; startDay: number; endMonth: number; endDay: number };
export type HoursSet = { key: string; season: Season | null; groups: DayGroup[] };
export type MonthDay = { month: number; day: number };

export const MAX_HOURS_ROWS = 60;
export const MAX_HOURS_NOTE = 140;

let nextKey = 0;
export const newKey = () => `k${++nextKey}`;

/** The last day of a month, counting 29 February (seasons repeat every year). */
export const monthDays = (month: number) => (month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31);

/** "9:00", "09.00", "9" → "09:00"; anything else → null. */
export function normalizeTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const hhmm = (time: string | null) => (time ?? '').slice(0, 5);
const seasonKey = (s: Season | null) => (s ? `${s.startMonth}-${s.startDay}-${s.endMonth}-${s.endDay}` : 'all');
const ord = (m: number, d: number) => m * 100 + d;

function seasonOf(row: HoursRow): Season | null {
  if (!row.season_start_month || !row.season_end_month) return null;
  return {
    startMonth: row.season_start_month,
    startDay: row.season_start_day ?? 1,
    endMonth: row.season_end_month,
    endDay: row.season_end_day ?? monthDays(row.season_end_month),
  };
}

/** Rows → sets of dates → groups of days. Rows with sunrise or sunset times are skipped. */
export function setsFromRows(rows: HoursRow[]): HoursSet[] {
  const sets = new Map<string, HoursSet>();
  for (const row of rows) {
    if (!row.start_time || !row.end_time) continue;
    const season = seasonOf(row);
    const sk = seasonKey(season);
    const set = sets.get(sk) ?? { key: newKey(), season, groups: [] };
    sets.set(sk, set);
    const days = [...row.days].sort((a, b) => a - b);
    const note = row.note ?? '';
    let group = set.groups.find((g) => g.days.join() === days.join() && g.note === note);
    if (!group) {
      group = { key: newKey(), days, openings: [], note };
      set.groups.push(group);
    }
    group.openings.push({ start: hhmm(row.start_time), end: hhmm(row.end_time) });
  }
  const out = [...sets.values()];
  for (const set of out) {
    for (const g of set.groups) g.openings.sort((a, b) => a.start.localeCompare(b.start));
    set.groups.sort((a, b) => a.days[0] - b.days[0] || a.openings[0].start.localeCompare(b.openings[0].start));
  }
  return out.sort((a, b) =>
    a.season && b.season ? ord(a.season.startMonth, a.season.startDay) - ord(b.season.startMonth, b.season.startDay) : a.season ? 1 : -1,
  );
}

/** What `set_page_hours()` takes: one entry per opening. */
export function rowsFromSets(sets: HoursSet[]) {
  return sets.flatMap((set) =>
    set.groups.flatMap((g) =>
      g.openings.map((o) => ({
        days: g.days,
        start: o.start,
        end: o.end,
        note: g.note.trim() || null,
        season: set.season
          ? {
              start_month: set.season.startMonth,
              start_day: set.season.startDay,
              end_month: set.season.endMonth,
              end_day: set.season.endDay,
            }
          : null,
      })),
    ),
  );
}

export const rowCount = (sets: HoursSet[]) => sets.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.openings.length, 0), 0);

export function inSeason(season: Season | null, month: number, day: number): boolean {
  if (!season) return true;
  const v = ord(month, day);
  const start = ord(season.startMonth, season.startDay);
  const end = ord(season.endMonth, season.endDay);
  return start <= end ? v >= start && v <= end : v >= start || v <= end;
}

/** Every day of a leap year, in order. */
const YEAR: MonthDay[] = Array.from({ length: 12 }, (_, i) =>
  Array.from({ length: monthDays(i + 1) }, (__, d) => ({ month: i + 1, day: d + 1 })),
).flat();

/**
 * Dates that no set of hours covers, as runs ("Oct 1 – Oct 31"), joining a
 * run over the new year. Empty when hours are the same all year.
 */
export function uncoveredRuns(sets: HoursSet[]): { from: MonthDay; to: MonthDay }[] {
  if (sets.length === 0 || sets.some((s) => !s.season)) return [];
  const covered = (month: number, day: number) => sets.some((s) => inSeason(s.season, month, day));
  // 29 February only comes every fourth year: a set that ends on the 28th covers it.
  const open = YEAR.map((d) => covered(d.month, d.day) || (d.month === 2 && d.day === 29 && covered(2, 28)));
  const runs: { from: number; to: number }[] = [];
  open.forEach((covered, i) => {
    if (covered) return;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i });
  });
  if (runs.length > 1 && runs[0].from === 0 && runs[runs.length - 1].to === YEAR.length - 1) {
    const tail = runs.pop()!;
    runs[0].from = tail.from;
  }
  return runs.map((r) => ({ from: YEAR[r.from], to: YEAR[r.to] }));
}

/** The first date two sets both cover, if any. */
export function firstOverlap(sets: HoursSet[]): MonthDay | null {
  if (sets.length < 2) return null;
  return YEAR.find((d) => sets.filter((s) => inSeason(s.season, d.month, d.day)).length > 1) ?? null;
}

/** A sensible next set of dates: the day after the last set ends, for three months. */
export function nextSeasonAfter(sets: HoursSet[]): Season {
  const last = [...sets].reverse().find((s) => s.season)?.season;
  if (!last) return { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 };
  const i = YEAR.findIndex((d) => d.month === last.endMonth && d.day === last.endDay);
  const skipLeapDay = YEAR[(i + 1) % YEAR.length].month === 2 && YEAR[(i + 1) % YEAR.length].day === 29 ? 1 : 0;
  const from = YEAR[(i + 1 + skipLeapDay) % YEAR.length];
  const to = YEAR[(i + 91 + skipLeapDay) % YEAR.length];
  return { startMonth: from.month, startDay: from.day, endMonth: to.month, endDay: to.day };
}
