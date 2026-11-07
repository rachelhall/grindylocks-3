"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { dayRanges, formatClock, formatMonthDay, localNow, weekdayName } from "@/lib/hours";
import {
  firstOverlap,
  inSeason,
  MAX_HOURS_NOTE,
  monthDays,
  nextSeasonAfter,
  normalizeTime,
  rowsFromSets,
  type Season,
  setsFromRows,
  uncoveredRuns,
} from "@/lib/page-hours";
import { MAX_CLOSED_NOTE } from "@/lib/page-fields";
import type { ManagedPage } from "@/lib/page-tools";
import { cn } from "@/lib/utils";

import { saveHours } from "./actions";
import {
  blankDay,
  comparableRows,
  copyDays,
  type DayRow,
  type DeskSet,
  deskFromSets,
  hoursProblem,
  setsFromDesk,
  tidy,
  WEEKDAYS,
} from "./hours-model";
import { SaveBar } from "./save-bar";
import { Block, Hint, Notice } from "./section-shell";

type Closed = { closed: boolean; until: string; noDate: boolean; note: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function closedFrom(page: ManagedPage): Closed {
  const t = page.tempClosed;
  return { closed: Boolean(t), until: t?.until ?? "", noDate: Boolean(t) && !t?.until, note: t?.note ?? "" };
}

const sameClosed = (a: Closed, b: Closed) =>
  a.closed === b.closed && (!a.closed || (a.note.trim() === b.note.trim() && (a.noDate ? "" : a.until) === (b.noDate ? "" : b.until)));

/**
 * Hours and closures (mockup: Web · page hours, staff view): Closed for a
 * while, then the hours as one row per day per set of dates, with a Closed
 * box and an optional note. Everyone on the team can change both, so they
 * share one screen and one Save. A preview shows the page today.
 */
export function HoursSection({ page }: { page: ManagedPage }) {
  const router = useRouter();
  const startDesk = () => deskFromSets(setsFromRows(page.hours));
  const [desk, setDesk] = useState<DeskSet[]>(startDesk);
  const [closed, setClosed] = useState<Closed>(() => closedFrom(page));
  const [editingDates, setEditingDates] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const us = page.timeZone?.startsWith("America/") ?? false;
  const locale = us ? "en-US" : "en-GB";
  const hoursChanged = comparableRows(tidy(desk)) !== comparableRows(startDesk());
  const closedChanged = !sameClosed(closed, closedFrom(page));
  const changes = [
    ...(closedChanged ? [closed.closed ? (closed.noDate || !closed.until ? "closed for now" : `closed until ${dateLabel(closed.until, locale)}`) : "open as usual"] : []),
    ...(hoursChanged ? ["hours"] : []),
  ];

  const seasonal = desk.some((s) => s.season);
  const sets = setsFromDesk(desk);
  const gaps = uncoveredRuns(sets);
  const overlap = firstOverlap(sets);

  function update(key: string, fn: (s: DeskSet) => DeskSet) {
    setDesk((d) => d.map((s) => (s.key === key ? fn(s) : s)));
  }
  function updateDay(key: string, i: number, fn: (d: DayRow) => DayRow) {
    update(key, (s) => ({ ...s, days: s.days.map((d, j) => (j === i ? fn(d) : d)) }));
  }

  function setMode(next: "all" | "dates") {
    if (next === "all") {
      setDesk((d) => [{ ...(d[0] ?? emptySet()), season: null }]);
    } else if (!seasonal) {
      const base = desk[0] ?? emptySet();
      setDesk([
        { key: base.key, season: { startMonth: 1, startDay: 1, endMonth: 6, endDay: 30 }, days: base.days },
        { key: crypto.randomUUID(), season: { startMonth: 7, startDay: 1, endMonth: 12, endDay: 31 }, days: copyDays(base.days) },
      ]);
    }
  }

  function discard() {
    setDesk(startDesk());
    setClosed(closedFrom(page));
    setEditingDates(null);
    setError(null);
  }

  function save() {
    setError(null);
    const tidied = tidy(desk);
    const problem = hoursChanged ? hoursProblem(tidied) : null;
    if (problem) return setError(problem);
    if (hoursChanged && overlap) return setError(`Two sets of dates both cover ${formatMonthDay(overlap.month, overlap.day, locale)}. Change one so they don't overlap.`);
    if (closedChanged && closed.closed) {
      if (!closed.note.trim()) return setError("Add a note for your page, like why you're closed.");
      if (!closed.noDate && !closed.until) return setError("Pick the date you open again, or tick No date yet.");
    }
    startTransition(async () => {
      const result = await saveHours(page.handle, {
        hours: hoursChanged ? rowsFromSets(setsFromDesk(tidied)) : null,
        closed: closedChanged ? { closed: closed.closed, until: closed.noDate ? null : closed.until || null, note: closed.note } : null,
      });
      if (!result.ok) return setError(result.error);
      setSaved("Saved. Your page shows it now.");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-start gap-10 px-6 pb-6">
        <form className="flex max-w-[860px] min-w-0 flex-[999_1_560px] flex-col" onSubmit={(e) => e.preventDefault()}>
          <Block id="closed-h" title="Closed for a while" first>
            <Segmented
              label="Closed for a while"
              value={closed.closed ? "closed" : "open"}
              options={[
                { value: "open", label: "Open as usual" },
                { value: "closed", label: "Closed for a while" },
              ]}
              onChange={(v) => setClosed((c) => ({ ...c, closed: v === "closed" }))}
            />
            {closed.closed && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="closed-until" className="type-label text-gl-text-secondary">
                      Closed until
                    </label>
                    <Input
                      id="closed-until"
                      type="date"
                      value={closed.until}
                      disabled={closed.noDate}
                      min={todayIn(page.timeZone)}
                      onChange={(e) => setClosed((c) => ({ ...c, until: e.target.value }))}
                      className="w-[200px] type-body-sm"
                    />
                  </div>
                  <label className="flex h-control items-center gap-2.5 type-body-sm">
                    <input
                      type="checkbox"
                      checked={closed.noDate}
                      onChange={(e) => setClosed((c) => ({ ...c, noDate: e.target.checked }))}
                      className="size-[18px] accent-gl-accent focus-ring"
                    />
                    No date yet (&ldquo;Closed for now&rdquo;)
                  </label>
                </div>
                <label htmlFor="closed-note" className="type-label text-gl-text-secondary">
                  Note on your page
                </label>
                <textarea
                  id="closed-note"
                  rows={2}
                  maxLength={MAX_CLOSED_NOTE}
                  value={closed.note}
                  onChange={(e) => setClosed((c) => ({ ...c, note: e.target.value }))}
                  className="resize-y border-2 border-gl-border bg-gl-surface-sunk px-2.5 py-2 type-body text-gl-text focus-ring"
                />
                <Hint>On the day after the date, the page opens again by itself.</Hint>
              </div>
            )}
          </Block>

          <Block id="hours-h" title="Hours">
            <Segmented
              label="Hours"
              value={seasonal ? "dates" : "all"}
              options={[
                { value: "all", label: "Same all year" },
                { value: "dates", label: "Change with the dates" },
              ]}
              onChange={(v) => setMode(v as "all" | "dates")}
            />
            {desk.length === 0 && (
              <Button variant="outline" className="self-start" onClick={() => setDesk([emptySet()])}>
                <Icon name="add" />
                Add hours
              </Button>
            )}
            {desk.map((set, si) => (
              <div key={set.key} className="flex flex-col gap-3 border-2 border-gl-border p-4">
                {set.season && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-auto type-headline">{seasonLabel(set.season, locale)}</span>
                    <Button variant="outline" onClick={() => setEditingDates(editingDates === set.key ? null : set.key)} aria-expanded={editingDates === set.key}>
                      <Icon name="edit_calendar" />
                      Change dates
                    </Button>
                    {si > 0 && (
                      <Button variant="outline" onClick={() => update(set.key, (s) => ({ ...s, days: copyDays(desk[0].days) }))}>
                        Copy the other dates&apos; hours
                      </Button>
                    )}
                    {desk.length > 1 && (
                      <Button variant="danger" onClick={() => setDesk((d) => d.filter((s) => s.key !== set.key))}>
                        Remove these dates
                      </Button>
                    )}
                  </div>
                )}
                {set.season && editingDates === set.key && (
                  <SeasonEditor season={set.season} onChange={(season) => update(set.key, (s) => ({ ...s, season }))} />
                )}
                <DayTable set={set} onDay={(i, fn) => updateDay(set.key, i, fn)} />
              </div>
            ))}
            {seasonal && (
              <Button
                variant="outline"
                className="self-start border-dashed"
                onClick={() => setDesk((d) => [...d, { key: crypto.randomUUID(), season: nextSeasonAfter(setsFromDesk(d)), days: copyDays(d[d.length - 1]?.days ?? emptySet().days) }])}
              >
                <Icon name="add" />
                Add hours for other dates
              </Button>
            )}
            {seasonal && overlap ? (
              <Notice icon="warning" tone="warning">
                Two sets of dates both cover {formatMonthDay(overlap.month, overlap.day, locale)}. Change one so they don&apos;t
                overlap.
              </Notice>
            ) : seasonal && gaps.length ? (
              <Notice icon="warning" tone="warning">
                No hours for {gaps.map((g) => `${formatMonthDay(g.from.month, g.from.day, locale)} – ${formatMonthDay(g.to.month, g.to.day, locale)}`).join(", ")}.
                Those dates show as closed.
              </Notice>
            ) : (
              <Hint>
                {seasonal ? "Every date of the year has hours. " : ""}Days with the same hours are joined on your page
                (Mon–Tue).
              </Hint>
            )}
          </Block>
        </form>

        <TodayPreview desk={desk} closed={closed} timeZone={page.timeZone} locale={locale} cityName={page.metro?.name ?? page.city} />
      </div>
      <SaveBar changes={changes} pending={pending} error={error} saved={saved && !changes.length ? saved : null} onDiscard={discard} onSave={save} />
    </>
  );
}

function emptySet(): DeskSet {
  return { key: crypto.randomUUID(), season: null, days: Array.from({ length: 7 }, (_, i) => (i < 6 ? blankDay() : { openings: [], note: "" })) };
}

function DayTable({ set, onDay }: { set: DeskSet; onDay: (i: number, fn: (d: DayRow) => DayRow) => void }) {
  const id = set.key.slice(0, 8);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse type-body-sm">
        <thead>
          <tr className="border-b-2 border-gl-border text-left">
            <th scope="col" className="h-control pr-3 type-label text-gl-text-secondary">
              Day
            </th>
            <th scope="col" className="pr-3 type-label text-gl-text-secondary">
              Open
            </th>
            <th scope="col" className="pr-3 type-label text-gl-text-secondary">
              Closed
            </th>
            <th scope="col" className="type-label text-gl-text-secondary">
              Note
            </th>
          </tr>
        </thead>
        <tbody>
          {set.days.map((day, i) => {
            const name = WEEKDAYS[i];
            const isClosed = day.openings.length === 0;
            return (
              <tr key={i} className="border-t border-gl-border-subtle align-top">
                <th scope="row" className="py-2 pr-3 text-left font-semibold whitespace-nowrap">
                  <span className="flex h-control items-center">{name}</span>
                </th>
                <td className="py-2 pr-3">
                  {isClosed ? (
                    <span className="flex h-control items-center text-gl-text-secondary">Closed</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {day.openings.map((o, oi) => (
                        <Fragment key={oi}>
                          <span className="flex items-center gap-1">
                            <TimeInput
                              id={`${id}-${i}-${oi}-from`}
                              label={`${name} opening ${oi + 1} from`}
                              value={o.start}
                              onChange={(v) => onDay(i, (d) => ({ ...d, openings: d.openings.map((x, j) => (j === oi ? { ...x, start: v } : x)) }))}
                            />
                            –
                            <TimeInput
                              id={`${id}-${i}-${oi}-to`}
                              label={`${name} opening ${oi + 1} to`}
                              value={o.end}
                              onChange={(v) => onDay(i, (d) => ({ ...d, openings: d.openings.map((x, j) => (j === oi ? { ...x, end: v } : x)) }))}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label={`Remove ${name} opening ${oi + 1}`}
                              title="Remove this opening"
                              onClick={() => onDay(i, (d) => ({ ...d, openings: d.openings.filter((_, j) => j !== oi) }))}
                            >
                              <Icon name="close" />
                            </Button>
                          </span>
                        </Fragment>
                      ))}
                      <button
                        type="button"
                        onClick={() => onDay(i, (d) => ({ ...d, openings: [...d.openings, nextOpening(d.openings)] }))}
                        className="inline-flex h-control items-center gap-1 px-1 type-body-sm font-semibold text-gl-text-secondary focus-ring hover:text-gl-text"
                        aria-label={`Add an opening on ${name}`}
                      >
                        <Icon name="add" size={18} />
                        Opening
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className="flex h-control items-center">
                    <input
                      type="checkbox"
                      aria-label={`${name} closed`}
                      checked={isClosed}
                      onChange={(e) => onDay(i, (d) => (e.target.checked ? { openings: [], note: "" } : { ...blankDay(), note: d.note }))}
                      className="size-[18px] accent-gl-accent focus-ring"
                    />
                  </span>
                </td>
                <td className="py-2">
                  <label htmlFor={`${id}-${i}-note`} className="sr-only">
                    {name} note
                  </label>
                  <Input
                    id={`${id}-${i}-note`}
                    value={day.note}
                    maxLength={MAX_HOURS_NOTE}
                    disabled={isClosed}
                    placeholder={isClosed ? "" : "Optional"}
                    onChange={(e) => onDay(i, (d) => ({ ...d, note: e.target.value }))}
                    className="min-w-[160px] type-body-sm"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TimeInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const bad = value.trim() !== "" && !normalizeTime(value);
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        inputMode="numeric"
        placeholder="10:00"
        aria-invalid={bad || undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = normalizeTime(value);
          if (n && n !== value) onChange(n);
        }}
        className="w-[76px] text-center type-body-sm tabular-nums"
      />
    </>
  );
}

/** After the day's last opening: an hour later, for two hours (a split day's second half). */
function nextOpening(openings: { start: string; end: string }[]) {
  const last = openings[openings.length - 1];
  const end = normalizeTime(last?.end ?? "") ?? "12:00";
  const [h, m] = end.split(":").map(Number);
  const from = Math.min(22, h + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${pad(from)}:${pad(m)}`, end: `${pad(Math.min(23, from + 2))}:${pad(m)}` };
}

function SeasonEditor({ season, onChange }: { season: Season; onChange: (s: Season) => void }) {
  const select = "h-control border-2 border-gl-border bg-gl-surface-sunk px-2 type-body-sm focus-ring";
  const part = (which: "start" | "end") => {
    const month = which === "start" ? season.startMonth : season.endMonth;
    const day = which === "start" ? season.startDay : season.endDay;
    const set = (m: number, d: number) =>
      onChange(which === "start" ? { ...season, startMonth: m, startDay: Math.min(d, monthDays(m)) } : { ...season, endMonth: m, endDay: Math.min(d, monthDays(m)) });
    return (
      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">{which === "start" ? "From" : "To"}</legend>
        <span className="type-label text-gl-text-secondary">{which === "start" ? "From" : "To"}</span>
        <select aria-label={`${which === "start" ? "From" : "To"} day`} value={day} onChange={(e) => set(month, Number(e.target.value))} className={select}>
          {Array.from({ length: monthDays(month) }, (_, i) => (
            <option key={i} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <select aria-label={`${which === "start" ? "From" : "To"} month`} value={month} onChange={(e) => set(Number(e.target.value), day)} className={select}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </fieldset>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-4 bg-gl-surface-raised p-3">
      {part("start")}
      {part("end")}
      <Hint>Every year, so 1 Nov – 31 Mar runs over the new year.</Hint>
    </div>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap self-start border-2 border-gl-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-[36px] border-r-2 border-gl-border px-4 type-body-sm font-semibold last:border-r-0 focus-ring",
            value === o.value ? "bg-gl-text font-bold text-gl-surface" : "bg-gl-surface hover:bg-gl-surface-raised",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** On your page today: the closed note, then this date's hours with days joined (Mon–Tue), as the app shows them. */
function TodayPreview({ desk, closed, timeZone, locale, cityName }: { desk: DeskSet[]; closed: Closed; timeZone: string | null; locale: string; cityName: string | null }) {
  // The date on the shop's clock.
  const today = localNow(new Date(), timeZone);
  const set = desk.find((s) => inSeason(s.season, today.month, today.day)) ?? desk[0];
  const next = set?.season ? desk.find((s) => s !== set && s.season) : null;
  const lines = set ? dayLines(set, locale) : [];
  const isClosed = closed.closed && closed.note.trim();

  return (
    <aside aria-label="On your page today" className="flex max-w-[360px] min-w-0 flex-[1_1_300px] flex-col gap-3 pt-5">
      <span className="type-label text-gl-text-secondary">On your page today</span>
      <div className="flex flex-col gap-3 border-2 border-gl-border p-4">
        {isClosed && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 self-start bg-gl-text px-2 py-0.5 type-label text-gl-surface">
              <Icon name="event_busy" size={16} />
              {closed.noDate || !closed.until ? "Closed for now" : `Closed until ${dateLabel(closed.until, locale)}`}
            </span>
            <p className="type-body-sm">{closed.note.trim()}</p>
          </div>
        )}
        <span className="type-label text-gl-text-secondary">Hours{cityName ? ` · ${cityName} time` : ""}</span>
        {lines.length ? (
          <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-body-sm", isClosed && "opacity-50")}>
            {lines.map((l) => (
              <Fragment key={l.days}>
                <dt className="font-semibold">{l.days}</dt>
                <dd className="tabular-nums">
                  {l.times.map((t) => (
                    <span key={t} className="block">
                      {t}
                    </span>
                  ))}
                  {l.note && <span className="block text-gl-text-secondary">{l.note}</span>}
                </dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className="type-body-sm text-gl-text-secondary">No hours yet.</p>
        )}
        {next?.season && <span className="type-body-sm text-gl-text-secondary">Hours from {formatMonthDay(next.season.startMonth, next.season.startDay, locale)} ›</span>}
      </div>
      <Hint>While you&apos;re closed for a while, your usual hours show greyed under your note, and Open now stays off.</Hint>
    </aside>
  );
}

function dayLines(set: DeskSet, locale: string) {
  const out: { days: string; times: string[]; note: string }[] = [];
  const key = (d: DayRow) => `${d.openings.map((o) => `${normalizeTime(o.start)}-${normalizeTime(o.end)}`).join(",")}|${d.note.trim()}`;
  const seen = new Set<string>();
  set.days.forEach((d) => {
    const k = key(d);
    if (seen.has(k)) return;
    seen.add(k);
    const days = set.days.map((x, i) => (key(x) === k ? i + 1 : 0)).filter(Boolean);
    const label = dayRanges(days)
      .map(([a, b]) => (a === b ? (days.length === 1 ? WEEKDAYS[a - 1] : weekdayName(a, locale)) : `${weekdayName(a, locale)}–${weekdayName(b, locale)}`))
      .join(", ");
    const times = d.openings.length
      ? d.openings.map((o) => `${clock(o.start, locale)}–${clock(o.end, locale)}`)
      : ["Closed"];
    out.push({ days: label, times, note: d.note.trim() });
  });
  // Already in order: each line starts at the first day it covers, Monday first.
  return out;
}

function clock(time: string, locale: string) {
  const n = normalizeTime(time);
  if (!n) return time;
  const [h, m] = n.split(":").map(Number);
  return formatClock(h * 60 + m, locale);
}

function seasonLabel(s: Season, locale: string) {
  return `${formatMonthDay(s.startMonth, s.startDay, locale)} – ${formatMonthDay(s.endMonth, s.endDay, locale)}`;
}

function dateLabel(iso: string, locale: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function todayIn(timeZone: string | null) {
  const n = localNow(new Date(), timeZone);
  return `${n.year}-${String(n.month).padStart(2, "0")}-${String(n.day).padStart(2, "0")}`;
}
