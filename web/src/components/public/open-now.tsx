"use client";

import { useSyncExternalStore } from "react";

import { formatClock, openState, type SessionRow } from "@/lib/hours";

type Status = "open" | "temporarily_closed" | "seasonal_closure" | "coming_soon";

const STATUS_LABEL: Record<Exclude<Status, "open">, string> = {
  temporarily_closed: "Temporarily closed",
  seasonal_closure: "Closed for the season",
  coming_soon: "Coming soon",
};

/** The current minute, ticking once a minute; null while the page is built. */
function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(id);
}
const minuteNow = () => Math.floor(Date.now() / 60_000);
const notYet = () => null;

/**
 * "Open · until 10:00 PM", worked out in the browser by the park's own clock
 * with the app's hours code, so a cached page never shows a stale state
 * (Nov 6). Before it runs (and for crawlers), nothing is shown.
 */
export function OpenNow({
  status,
  sessions,
  latitude,
  longitude,
  timeZone,
  locale,
}: {
  status: Status;
  sessions: SessionRow[];
  latitude: number | null;
  longitude: number | null;
  timeZone: string | null;
  locale: string;
}) {
  const minute = useSyncExternalStore(subscribe, minuteNow, notYet);
  if (minute === null) return null;

  const state = openState(status, sessions, { latitude, longitude, timeZone }, new Date(minute * 60_000));
  let label: string;
  let tone: "open" | "closed" | "seasonal" | "soon";
  switch (state.kind) {
    case "open":
      label = `Open · until ${formatClock(state.until, locale)}`;
      tone = "open";
      break;
    case "closed":
      label = state.opensAt === null ? "Closed now" : `Closed · opens ${formatClock(state.opensAt, locale)}`;
      tone = "closed";
      break;
    case "closedToday":
      label = "Closed today";
      tone = "closed";
      break;
    case "unknown":
      label = "Open · hours not listed";
      tone = "open";
      break;
    case "status":
      label = STATUS_LABEL[state.status];
      tone = state.status === "seasonal_closure" ? "seasonal" : state.status === "coming_soon" ? "soon" : "closed";
      break;
  }
  const colour = {
    open: "border-[var(--gl-status-open)] text-[var(--gl-status-open)]",
    closed: "border-[var(--gl-status-closed)] text-[var(--gl-status-closed)]",
    seasonal: "border-[var(--gl-status-seasonal)] text-[var(--gl-status-seasonal)]",
    soon: "border-[var(--gl-status-soon)] text-[var(--gl-status-soon)]",
  }[tone];

  return <span className={`border-2 px-2 py-1 type-label uppercase ${colour}`}>{label}</span>;
}
