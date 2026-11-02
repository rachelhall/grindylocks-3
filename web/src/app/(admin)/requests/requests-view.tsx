"use client";

import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { AccessRequest, Discipline } from "@/lib/access-requests";
import { cn } from "@/lib/utils";

import { markRequestsSeen, setInvited } from "./actions";

type Status = "open" | "invited" | "all";

/** The v1 disciplines the request form offers. */
const FILTER_DISCIPLINES: readonly Discipline[] = ["inline", "quad", "skateboard"];

const disciplineLabel: Record<Discipline, string> = {
  inline: "Inline",
  quad: "Quad",
  skateboard: "Skateboard",
  bmx: "BMX",
  scooter: "Scooter",
};

const empty: Record<Status, string> = {
  open: "Nobody waiting. Requests from the grindylocks.com form show up here.",
  invited: "Nobody marked invited yet.",
  all: "No requests yet. They show up here when someone fills in the form on grindylocks.com.",
};

/** "No city given" has no key of its own, so the city filter uses this one. */
const NO_CITY = "__none__";

type Toast = { message: string; undo?: { ids: string[]; invited: boolean } };

/**
 * The Requests list (mockup: Admin · access requests): status tabs, a
 * discipline filter, a By city panel that filters by city, selection with
 * Mark invited and Copy emails, and a toast with Undo.
 *
 * Every request comes down at once and is filtered here: the form is
 * rate-limited, so the list stays small.
 */
export function RequestsView({ requests, seenAt }: { requests: AccessRequest[]; seenAt: string | null }) {
  // NEW means "since you last opened this page", fixed for the whole visit,
  // even after Mark invited refreshes the data underneath.
  const [since] = useState(seenAt);
  const [status, setStatus] = useState<Status>("open");
  const [discipline, setDiscipline] = useState<Discipline | "">("");
  const [city, setCity] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Opening the page counts as seeing what's on it. Doesn't refresh, so this
  // visit's NEW tags stay.
  useEffect(() => {
    void markRequestsSeen();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const counts = useMemo(() => {
    const invited = requests.filter((r) => r.invitedAt).length;
    return { open: requests.length - invited, invited, all: requests.length };
  }, [requests]);

  const visible = useMemo(
    () =>
      requests.filter(
        (r) =>
          (status === "all" || (status === "invited") === !!r.invitedAt) &&
          (!discipline || r.disciplines.includes(discipline)) &&
          (city === null || (r.cityKey ?? NO_CITY) === city),
      ),
    [requests, status, discipline, city],
  );

  // Only rows on screen count as selected, so a hidden row is never acted on.
  const picked = visible.filter((r) => selected.has(r.id));
  const pickedOpen = picked.filter((r) => !r.invitedAt);
  const pickedInvited = picked.filter((r) => r.invitedAt);
  const allPicked = visible.length > 0 && picked.length === visible.length;

  const cities = useMemo(() => {
    const groups = new Map<string, { label: string; count: number; hasParks: boolean }>();
    for (const r of requests) {
      if (r.invitedAt) continue;
      const key = r.cityKey ?? NO_CITY;
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { label: r.homeCity?.split(",")[0].trim() ?? "", count: 1, hasParks: r.cityHasParks });
    }
    return [...groups.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => (a.key === NO_CITY ? 1 : b.key === NO_CITY ? -1 : b.count - a.count || a.label.localeCompare(b.label)));
  }, [requests]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allPicked ? new Set() : new Set(visible.map((r) => r.id)));
  }

  function mark(ids: string[], invited: boolean, { isUndo = false } = {}) {
    if (!ids.length) return;
    setError(null);
    startTransition(async () => {
      const result = await setInvited(ids, invited);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      const people = ids.length === 1 ? "1 request" : `${ids.length} requests`;
      setToast({
        message: invited ? `Marked ${people} invited.` : `Marked ${people} not invited.`,
        undo: isUndo ? undefined : { ids, invited: !invited },
      });
    });
  }

  async function copyEmails() {
    const emails = picked.map((r) => r.email);
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setToast({ message: emails.length === 1 ? "Copied 1 email." : `Copied ${emails.length} emails.` });
    } catch {
      setError("Couldn't copy. Your browser blocked the clipboard.");
    }
  }

  return (
    <Tabs.Root
      value={status}
      onValueChange={(value) => setStatus(value as Status)}
      className="flex flex-1 flex-col"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-gl-border px-6 pt-4">
        <Tabs.List aria-label="Request status" className="flex gap-6 overflow-x-auto">
          {(
            [
              ["open", "Not invited"],
              ["invited", "Invited"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <Tabs.Tab
              key={value}
              value={value}
              className={cn(
                "-mx-1 -mb-0.5 h-control shrink-0 border-b-[3px] border-transparent px-1 whitespace-nowrap type-body-sm font-medium text-gl-text-secondary",
                "hover:text-gl-text focus-ring focus-visible:outline-offset-[-2px]",
                "data-active:border-gl-text data-active:font-bold data-active:text-gl-text",
              )}
            >
              {label} · {counts[value]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <div className="flex items-center gap-2 pb-3">
          <label htmlFor="discipline" className="type-label text-gl-text-secondary">
            Skates
          </label>
          <select
            id="discipline"
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value as Discipline | "")}
            className="h-control min-w-40 border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm text-gl-text focus-ring"
          >
            <option value="">Any discipline</option>
            {FILTER_DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {disciplineLabel[d]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-1 flex-wrap">
        {/* One panel per tab, all showing the same filtered list. */}
        {(["open", "invited", "all"] as const).map((value) => (
          <Tabs.Panel
            key={value}
            value={value}
            className="flex min-w-0 flex-[999_1_520px] flex-col focus-ring focus-visible:outline-offset-[-2px]"
          >
            <div className="flex min-h-[64px] flex-wrap items-center gap-3 border-b border-gl-border-subtle bg-gl-surface-raised px-6 py-3">
              {picked.length ? (
                <>
                  <span className="type-body-sm font-semibold">{picked.length} selected</span>
                  {pickedOpen.length > 0 && (
                    <Button disabled={pending} onClick={() => mark(pickedOpen.map((r) => r.id), true)}>
                      <Icon name="check" />
                      Mark invited
                    </Button>
                  )}
                  {pickedInvited.length > 0 && (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => mark(pickedInvited.map((r) => r.id), false)}
                    >
                      Mark not invited
                    </Button>
                  )}
                  <Button variant="outline" onClick={copyEmails}>
                    <Icon name="content_copy" />
                    Copy emails
                  </Button>
                </>
              ) : (
                <span className="type-body-sm text-gl-text-secondary">
                  Select requests to mark them invited or copy their emails.
                </span>
              )}
            </div>

            {error && (
              <p role="alert" className="border-b border-gl-border-subtle px-6 py-3 type-body-sm text-gl-danger">
                {error}
              </p>
            )}

            {visible.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse type-body-sm">
                  <thead>
                    <tr className="border-b-2 border-gl-border text-left">
                      <th scope="col" className="h-control w-11 pl-6">
                        <input
                          type="checkbox"
                          checked={allPicked}
                          onChange={toggleAll}
                          aria-label="Select all requests shown"
                          className="size-[18px] accent-gl-accent focus-ring"
                        />
                      </th>
                      <Th>Email</Th>
                      <Th>Home city</Th>
                      <Th>Skates</Th>
                      <Th className="text-right">Asked</Th>
                      <th scope="col" className="pr-6">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const isPicked = selected.has(r.id);
                      const isNew = !r.invitedAt && (since === null || r.createdAt > since);
                      return (
                        <tr
                          key={r.id}
                          className={cn(
                            "h-row border-b border-gl-border-subtle align-top",
                            isPicked ? "bg-gl-accent-subtle text-gl-on-accent-subtle" : "hover:bg-gl-surface-raised",
                          )}
                        >
                          <td className="py-3 pl-6">
                            <input
                              type="checkbox"
                              checked={isPicked}
                              onChange={() => toggle(r.id)}
                              aria-label={`Select request from ${r.email}`}
                              className="size-[18px] accent-gl-accent focus-ring"
                            />
                          </td>
                          <td className="p-3 font-semibold break-all">
                            {r.email}
                            {isNew && (
                              <span className="ml-2 inline-block bg-gl-accent px-1.5 py-px text-[11px] leading-[14px] font-bold tracking-[0.06em] text-gl-on-accent">
                                NEW
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            {r.homeCity ? (
                              <>
                                {r.homeCity}
                                <div className="text-gl-text-secondary">
                                  {r.cityHasParks ? "Has parks" : "No parks yet"}
                                </div>
                              </>
                            ) : (
                              <span className="text-gl-text-secondary">No city given</span>
                            )}
                          </td>
                          <td className="p-3">
                            {r.disciplines.length ? (
                              r.disciplines.map((d) => disciplineLabel[d]).join(", ")
                            ) : (
                              <span className="text-gl-text-secondary">Not given</span>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            <time dateTime={r.createdAt}>{r.ago}</time>
                          </td>
                          <td className="py-1.5 pr-6 pl-3 text-right">
                            {r.invitedAt ? (
                              <div className="flex items-center justify-end gap-3">
                                <span className="whitespace-nowrap text-gl-text-secondary">
                                  Invited {r.invitedAgo} ago
                                </span>
                                <Button
                                  variant="outline"
                                  disabled={pending}
                                  onClick={() => mark([r.id], false)}
                                  aria-label={`Mark ${r.email} not invited`}
                                >
                                  Undo
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                disabled={pending}
                                onClick={() => mark([r.id], true)}
                                aria-label={`Mark ${r.email} invited`}
                              >
                                Mark invited
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="max-w-[60ch] px-6 py-6 type-body">
                {discipline || city !== null ? "No requests match these filters." : empty[value]}
              </p>
            )}

            <p className="px-6 py-4 type-caption text-gl-text-secondary">
              NEW means it came in since you last opened this page. Marking someone invited doesn&apos;t send
              anything; send their invite link from the app first.
            </p>
          </Tabs.Panel>
        ))}

        <aside
          aria-labelledby="by-city"
          className="flex w-full flex-col gap-4 border-t-2 border-gl-border p-6 lg:w-auto lg:max-w-[360px] lg:flex-[1_1_320px] lg:border-t-0 lg:border-l-2"
        >
          <div className="flex flex-col gap-1">
            <h2 id="by-city" className="type-headline">
              By city
            </h2>
            <p className="type-body-sm text-gl-text-secondary">Not-invited requests. Pick one to filter the list.</p>
          </div>
          {cities.length ? (
            <ul className="flex flex-col">
              {cities.map((c) => (
                <li key={c.key} className="border-t border-gl-border-subtle last:border-b">
                  <button
                    type="button"
                    aria-pressed={city === c.key}
                    onClick={() => setCity(city === c.key ? null : c.key)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2.5 px-2 py-2 text-left type-body-sm focus-ring",
                      city === c.key ? "bg-gl-accent-subtle text-gl-on-accent-subtle" : "hover:bg-gl-surface-raised",
                    )}
                  >
                    <span className={cn("font-semibold", c.key === NO_CITY && "text-gl-text-secondary")}>
                      {c.key === NO_CITY ? "No city given" : c.label}
                    </span>
                    {c.key !== NO_CITY && !c.hasParks && (
                      <span className="border-2 border-gl-border px-1 text-[11px] leading-[14px] font-semibold tracking-[0.06em] uppercase">
                        No parks yet
                      </span>
                    )}
                    {city === c.key && <Icon name="filter_alt" size={18} />}
                    <span className="ml-auto font-bold tabular-nums">{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body">Nobody waiting.</p>
          )}
          {city !== null && (
            <Button variant="link" className="self-start" onClick={() => setCity(null)}>
              Show every city
            </Button>
          )}
          <p className="type-caption text-gl-text-secondary">
            Cities are grouped as typed, ignoring case and anything after a comma. &ldquo;No parks yet&rdquo; means no
            metro area with parks matches, a hint for where to open next.
          </p>
        </aside>
      </div>

      <div aria-live="polite" className="pointer-events-none fixed right-6 bottom-6 z-50">
        {toast && (
          <div className="pointer-events-auto flex items-center gap-4 border-2 border-gl-border bg-gl-surface-raised px-4 py-3 type-body-sm">
            <span>{toast.message}</span>
            {toast.undo && (
              <Button
                variant="link"
                disabled={pending}
                onClick={() => {
                  const { ids, invited } = toast.undo!;
                  setToast(null);
                  mark(ids, invited, { isUndo: true });
                }}
              >
                Undo
              </Button>
            )}
            <Button variant="outline" size="icon" aria-label="Close" title="Close" onClick={() => setToast(null)}>
              <Icon name="close" />
            </Button>
          </div>
        )}
      </div>
    </Tabs.Root>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-3 type-label text-gl-text-secondary", className)}>
      {children}
    </th>
  );
}
