/**
 * Hours on a desk (Nov 6): the app edits groups of days (page-hours.ts); the
 * web shows one row per day in a table, per set of dates. These turn one into
 * the other. Saving folds days with the same openings and note back into the
 * grouped rows the database stores, through the app's own rowsFromSets.
 */
import {
  type DayGroup,
  type HoursSet,
  MAX_HOURS_NOTE,
  MAX_HOURS_ROWS,
  newKey,
  normalizeTime,
  type Opening,
  rowsFromSets,
  type Season,
} from "@/lib/page-hours";

export type DayRow = { openings: Opening[]; note: string };
/** Seven days, Monday first. A day with no openings is closed. */
export type DeskSet = { key: string; season: Season | null; days: DayRow[] };

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const closedDay = (): DayRow => ({ openings: [], note: "" });

export function deskFromSets(sets: HoursSet[]): DeskSet[] {
  return sets.map((set) => {
    const days = Array.from({ length: 7 }, closedDay);
    for (const g of set.groups) {
      for (const d of g.days) days[d - 1] = { openings: g.openings.map((o) => ({ ...o })), note: g.note };
    }
    return { key: set.key, season: set.season, days };
  });
}

const dayKey = (d: DayRow) => `${d.openings.map((o) => `${o.start}-${o.end}`).join(",")}|${d.note.trim()}`;

/** Days with the same openings and note become one group; closed days drop out. */
export function setsFromDesk(desk: DeskSet[]): HoursSet[] {
  return desk.map((set) => {
    const groups: DayGroup[] = [];
    set.days.forEach((day, i) => {
      if (!day.openings.length) return;
      const openings = [...day.openings].sort((a, b) => a.start.localeCompare(b.start));
      const key = dayKey({ openings, note: day.note });
      const group = groups.find((g) => dayKey(g) === key);
      if (group) group.days.push(i + 1);
      else groups.push({ key: newKey(), days: [i + 1], openings, note: day.note.trim() });
    });
    return { key: set.key, season: set.season, groups };
  });
}

/** The rows set_page_hours takes, sorted so two equal sets of hours compare equal. */
export function comparableRows(desk: DeskSet[]) {
  return rowsFromSets(setsFromDesk(desk))
    .map((r) => JSON.stringify(r))
    .sort()
    .join("\n");
}

export function blankDay(): DayRow {
  return { openings: [{ start: "10:00", end: "17:00" }], note: "" };
}

export function copyDays(days: DayRow[]): DayRow[] {
  return days.map((d) => ({ openings: d.openings.map((o) => ({ ...o })), note: d.note }));
}

/** What's wrong with the hours as typed, or null. Checked before saving; the database checks again. */
export function hoursProblem(desk: DeskSet[]): string | null {
  for (const set of desk) {
    for (const [i, day] of set.days.entries()) {
      for (const o of day.openings) {
        if (!normalizeTime(o.start) || !normalizeTime(o.end)) return `${WEEKDAYS[i]}: write times like 10:00 or 17:30.`;
        if (normalizeTime(o.start) === normalizeTime(o.end)) return `${WEEKDAYS[i]}: an opening can't start and end at the same time.`;
      }
      if (day.note.trim().length > MAX_HOURS_NOTE) return `${WEEKDAYS[i]}: the note is over ${MAX_HOURS_NOTE} characters.`;
    }
  }
  if (rowsFromSets(setsFromDesk(desk)).length > MAX_HOURS_ROWS) {
    return `That's more than ${MAX_HOURS_ROWS} openings in all. Join some days or dates.`;
  }
  return null;
}

/** Times as typed, tidied to HH:MM where they can be. */
export function tidy(desk: DeskSet[]): DeskSet[] {
  return desk.map((s) => ({
    ...s,
    days: s.days.map((d) => ({
      note: d.note,
      openings: d.openings.map((o) => ({ start: normalizeTime(o.start) ?? o.start, end: normalizeTime(o.end) ?? o.end })),
    })),
  }));
}
