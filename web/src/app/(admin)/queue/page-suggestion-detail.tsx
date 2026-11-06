"use client";

import { useEffect, useState, useTransition } from "react";

import { InfoNote, PageTile, pageType, WarningNote } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { PageSuggestionDetail } from "@/lib/brands";
import { cn } from "@/lib/utils";

import { approvePageSuggestion, handleFree, reviewPageSuggestion } from "./actions";
import { ErrorLine, inputClass, PaneHeader, PaneSection, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

type Visit = "storefront" | "by_appointment" | "online_only";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label text-gl-text-secondary">
        {label}
      </label>
      {children}
      {hint && <p className="type-caption text-gl-text-secondary">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-0">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "-ml-0.5 h-control border-2 border-gl-border px-3 type-body-sm font-semibold first:ml-0 focus-ring",
            value === v ? "bg-gl-text text-gl-surface" : "bg-gl-surface hover:bg-gl-surface-raised",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * A suggested brand or shop (mockup: Admin · suggested brand): what they
 * wrote, any existing page it might be, and the new page's fields to edit
 * before approving. Approving makes an UNOFFICIAL page with the handle
 * reserved and tells the suggester; merging or declining tells nobody.
 */
export function PageSuggestionDetailPane({ detail: d }: { detail: PageSuggestionDetail }) {
  const { done } = useQueue();
  const [role, setRole] = useState<"brand" | "shop" | "organizer">(d.role);
  const [name, setName] = useState(d.name);
  const [handle, setHandle] = useState(d.suggestedHandle ?? "");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [line, setLine] = useState("");
  const [website, setWebsite] = useState(d.link && !/instagram\.com/i.test(d.link) ? d.link : "");
  const [visit, setVisit] = useState<Visit>("storefront");
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState("");
  const [metro, setMetro] = useState("");
  const [mergeInto, setMergeInto] = useState(d.matches[0]?.id ?? "");
  const [confirm, setConfirm] = useState<"approve" | "merge" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const who = d.suggester ? `@${d.suggester}` : "the suggester";

  useShortcuts({ a: () => setConfirm("approve"), x: () => setConfirm("decline") });

  // The live handle check: the answer counts only for the handle it was for.
  const [checked, setChecked] = useState<{ handle: string; free: boolean | null } | null>(null);
  const cleanHandle = handle.replace(/^@/, "");
  const free = checked?.handle === cleanHandle ? checked.free : null;
  useEffect(() => {
    if (!/^[a-zA-Z0-9_.]{2,30}$/.test(cleanHandle)) return;
    let live = true;
    const timer = setTimeout(async () => {
      const result = await handleFree(cleanHandle);
      if (live) setChecked({ handle: cleanHandle, free: result });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cleanHandle]);

  function parsePin(): { latitude?: number; longitude?: number } | null {
    if (!pin.trim()) return {};
    const m = pin.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    return { latitude: Number(m[1]), longitude: Number(m[2]) };
  }

  function submit() {
    const action = confirm;
    setError(null);
    startTransition(async () => {
      let result;
      if (action === "approve") {
        const coords = parsePin();
        if (coords === null) {
          setError("Write the pin as latitude, longitude (55.605, 13.003).");
          return;
        }
        result = await approvePageSuggestion({
          id: d.id,
          role,
          name: name.trim(),
          handle: handle.replace(/^@/, "").trim(),
          line: line.trim(),
          city,
          country,
          website,
          locationType: visit,
          address,
          ...coords,
          metro: metro || undefined,
        });
      } else if (action === "merge") {
        result = await reviewPageSuggestion({ id: d.id, action: "merge", page: mergeInto });
      } else {
        result = await reviewPageSuggestion({ id: d.id, action: "decline" });
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      done(
        action === "approve"
          ? `${name.trim()} is an UNOFFICIAL page now. ${who} is told it's live.`
          : action === "merge"
            ? "Pointed at the existing page. Nobody is told."
            : "Suggestion declined. Nobody is told.",
      );
    });
  }

  const merging = d.matches.find((m) => m.id === mergeInto);
  const ready = name.trim() && handle.trim() && line.trim() && free !== false;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader
        chip={<StateChip state="open" />}
        title={`Suggested ${d.role}: ${d.name}`}
        sub={
          <>
            By {who}, {d.ago} ago
            {d.link && (
              <>
                {" · "}
                <a
                  href={/^https?:\/\//.test(d.link) ? d.link : `https://${d.link}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-gl-accent-text underline focus-ring"
                >
                  {d.link.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </>
        }
      />

      {d.matches.length ? (
        <WarningNote>
          <p>Possible match among existing pages. If it&apos;s the same one, merge instead of making a second page.</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {d.matches.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <PageTile name={m.name} className="size-7 text-sm" />
                <span className="font-semibold">{m.name}</span>
                <span className="text-gl-text-secondary">
                  {[pageType(m.roles), m.place, `@${m.handle}`].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </WarningNote>
      ) : (
        <InfoNote icon="search">No match among existing pages. Checked names, &ldquo;Formerly&rdquo; names and handles.</InfoNote>
      )}

      {d.what && (
        <PaneSection title="They wrote">
          <p className="type-body whitespace-pre-wrap">&ldquo;{d.what}&rdquo;</p>
        </PaneSection>
      )}

      <PaneSection title="New page · edit before approving">
        <div className="flex flex-col gap-4">
          <Field id="ps-type" label="Type">
            <Segmented
              label="Type"
              value={role}
              onChange={setRole}
              options={[["brand", "Brand"], ["shop", "Shop"], ["organizer", "Organizer"]]}
            />
          </Field>
          <Field id="ps-name" label="Name">
            <input id="ps-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field
            id="ps-handle"
            label="Handle"
            hint={
              free === true ? (
                <span className="inline-flex items-center gap-1 text-gl-text">
                  <Icon name="check" size={16} /> Free and not reserved
                </span>
              ) : free === false ? (
                <span className="inline-flex items-center gap-1 text-gl-danger">
                  <Icon name="close" size={16} /> Taken by a member or another page
                </span>
              ) : (
                "Match their Instagram handle where you can. 2 to 30 letters, numbers, dots or underscores."
              )
            }
          >
            <input id="ps-handle" value={handle} maxLength={31} onChange={(e) => setHandle(e.target.value)} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ps-city" label="City">
              <input id="ps-city" value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} className={inputClass} />
            </Field>
            <Field id="ps-country" label="Country" hint="Two letters: SE, DK, US">
              <input
                id="ps-country"
                value={country}
                maxLength={2}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                className={cn(inputClass, "w-24 uppercase")}
              />
            </Field>
          </div>
          <Field id="ps-line" label="Factual line · English" hint="Our own words, facts only. Shown on the unofficial page.">
            <textarea
              id="ps-line"
              rows={2}
              maxLength={300}
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className="resize-y border-2 border-gl-border bg-gl-surface-sunk px-3 py-2 type-body text-gl-text focus-ring"
            />
          </Field>
          <Field id="ps-website" label="Website">
            <input id="ps-website" value={website} maxLength={200} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
          </Field>
          {role === "organizer" && (
            <Field id="ps-metro" label="Metro area" hint="Sets its clock and lets it meet at an address. Its team adds a base themselves, if it has one.">
              <select id="ps-metro" value={metro} onChange={(e) => setMetro(e.target.value)} className={inputClass}>
                <option value="">None (outside the beta cities)</option>
                {d.metros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {role === "shop" && (
            <>
              <Field id="ps-visit" label="How people visit">
                <Segmented
                  label="How people visit"
                  value={visit}
                  onChange={setVisit}
                  options={[["storefront", "Storefront"], ["by_appointment", "By appointment"], ["online_only", "Online only"]]}
                />
              </Field>
              <Field id="ps-metro" label="Metro area" hint="Decides which city admin looks after it, and Near you once it's claimed.">
                <select id="ps-metro" value={metro} onChange={(e) => setMetro(e.target.value)} className={inputClass}>
                  <option value="">None (outside the beta cities)</option>
                  {d.metros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              {visit !== "online_only" && (
                <>
                  <Field id="ps-address" label="Address">
                    <input id="ps-address" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
                  </Field>
                  <Field
                    id="ps-pin"
                    label="Pin · latitude, longitude"
                    hint={
                      visit === "by_appointment"
                        ? "By-appointment shops show no pin until their team chooses to (it may be someone's home)."
                        : "Sets the map pin. Check it on a map before approving."
                    }
                  >
                    <input id="ps-pin" value={pin} placeholder="55.605, 13.003" onChange={(e) => setPin(e.target.value)} className={inputClass} />
                  </Field>
                </>
              )}
            </>
          )}
          <p className="flex items-center gap-2 type-body-sm">
            <span className="border-2 border-gl-border px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-[0.06em] uppercase">Needs translations</span>
            Spanish, Danish and German, added after approval
          </p>
        </div>
      </PaneSection>

      <div className="flex flex-col gap-3 border-t-2 border-gl-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button disabled={!ready || pending} onClick={() => setConfirm("approve")}>
            Approve as unofficial page
          </Button>
          <Button variant="outline" disabled={!d.matches.length || pending} onClick={() => setConfirm("merge")}>
            Merge into a page…
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => setConfirm("decline")}>
            Decline
          </Button>
        </div>
        <p className="type-caption text-gl-text-secondary">
          Approving creates an UNOFFICIAL page with this handle reserved, and tells {who} it&apos;s live. Merge points the suggestion at an existing page instead; nothing new is made, and nobody is told.
        </p>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={
          confirm === "approve"
            ? `Make ${name.trim() || "this"} an unofficial page?`
            : confirm === "merge"
              ? "Merge into an existing page?"
              : "Decline this suggestion?"
        }
        description={
          confirm === "approve"
            ? `@${handle.replace(/^@/, "")} is reserved, the page shows in Search, and ${who} is told it's live.`
            : confirm === "merge"
              ? "Nothing new is made, and nobody is told."
              : "Nothing is made, and nobody is told."
        }
      >
        {confirm === "merge" && (
          <select aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className={inputClass}>
            {d.matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} (@{m.handle})
              </option>
            ))}
          </select>
        )}
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant={confirm === "decline" ? "danger-solid" : "primary"} disabled={pending} onClick={submit}>
            {confirm === "approve" ? "Approve" : confirm === "merge" ? `Merge into ${merging?.name ?? "page"}` : "Decline"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
