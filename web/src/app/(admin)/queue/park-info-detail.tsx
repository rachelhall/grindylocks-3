"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Json } from "@/lib/database.types";
import type { ParkInfoDetail } from "@/lib/queue";
import { disciplineLabel, fieldLabel, parkStatusLabel, valueLines } from "@/lib/queue-labels";

import { reviewParkInfo } from "./actions";
import { Checkbox, ErrorLine, inputClass, PaneHeader, PaneSection, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

type Obj = Record<string, Json | undefined>;

function asObj(v: Json | null): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

const DAY_PRESETS = {
  daily: { label: "Daily", days: [1, 2, 3, 4, 5, 6, 7] },
  weekdays: { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  weekends: { label: "Weekends", days: [6, 7] },
} as const;
type Preset = keyof typeof DAY_PRESETS;

function presetFor(days: unknown): Preset {
  const key = Array.isArray(days) ? [...days].sort().join(",") : "";
  if (key === "1,2,3,4,5") return "weekdays";
  if (key === "6,7") return "weekends";
  return "daily";
}

/** Which fields the pane can apply for you; the rest are fixed by hand, then marked done. */
const APPLIES = new Set(["hours", "status", "lighting", "location", "fees", "disciplines", "helmet_rule", "description"]);

/**
 * A park info report (mockup: Admin · park info report): what the park lists
 * now beside the suggestion, an editor filled in from the suggestion, and
 * Approve (which applies it, logs it in the park's edit history and tells the
 * reporter) or Decline.
 */
export function ParkInfoDetailPane({ detail: d }: { detail: ParkInfoDetail }) {
  const { done } = useQueue();
  const s = asObj(d.suggested);
  const applies = APPLIES.has(d.field);

  // One piece of state per editor; only the report's own field is used.
  const [preset, setPreset] = useState<Preset>(presetFor(s.days));
  const [start, setStart] = useState(typeof s.start === "string" && s.start !== "sunrise" ? s.start : "09:00");
  const [fromSunrise, setFromSunrise] = useState(s.start === "sunrise");
  const [end, setEnd] = useState(typeof s.end === "string" && s.end !== "sunset" ? s.end : "21:00");
  const [untilSunset, setUntilSunset] = useState(s.end === "sunset");
  const [status, setStatus] = useState(typeof s.status === "string" ? s.status : "open");
  const [lit, setLit] = useState(s.night_lighting === true ? "yes" : s.night_lighting === false ? "no" : "yes");
  const [paid, setPaid] = useState(s.is_paid === true ? "yes" : "no");
  const [fee, setFee] = useState(typeof s.entry_fee === "string" ? s.entry_fee : "");
  const [helmet, setHelmet] = useState(s.helmet_required === true ? "yes" : s.helmet_required === false ? "no" : "unknown");
  const [address, setAddress] = useState(typeof s.address === "string" ? s.address : "");
  const [lat, setLat] = useState(typeof s.latitude === "number" ? String(s.latitude) : "");
  const [lng, setLng] = useState(typeof s.longitude === "number" ? String(s.longitude) : "");
  const [disciplines, setDisciplines] = useState<string[]>(
    Array.isArray(s.disciplines) ? s.disciplines.map(String) : ["inline", "quad", "skateboard"],
  );
  const [body, setBody] = useState(typeof s.body === "string" ? s.body : "");
  const [verify, setVerify] = useState(false);

  const [confirm, setConfirm] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useShortcuts({ a: () => setConfirm("approve"), x: () => setConfirm("decline") });

  function value(): Json | null {
    switch (d.field) {
      case "hours":
        return {
          days: [...DAY_PRESETS[preset].days],
          start: fromSunrise ? "sunrise" : start,
          end: untilSunset ? "sunset" : end,
        };
      case "status":
        return { status };
      case "lighting":
        return { night_lighting: lit === "yes" };
      case "fees":
        return { is_paid: paid === "yes", entry_fee: paid === "yes" ? fee.trim() : "" };
      case "helmet_rule":
        return { helmet_required: helmet === "unknown" ? null : helmet === "yes" };
      case "location": {
        const v: Obj = {};
        if (address.trim()) v.address = address.trim();
        if (lat.trim() && lng.trim() && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
          v.latitude = Number(lat);
          v.longitude = Number(lng);
        }
        return v as Json;
      }
      case "disciplines":
        return { disciplines };
      case "description":
        return { body: body.trim(), locale: "en" };
      default:
        return null;
    }
  }

  function submit() {
    const approve = confirm === "approve";
    startTransition(async () => {
      const result = await reviewParkInfo({
        id: d.id,
        approve,
        value: approve && applies ? value() : undefined,
        markVerified: approve && verify,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      done(approve ? `Fix approved. @${d.reporter ?? "the reporter"} is told it's live.` : "Report declined.");
    });
  }

  const what = d.field === "obstacle" && d.obstacle ? d.obstacle.name : fieldLabel[d.field];
  const title = `${what.charAt(0).toUpperCase()}${what.slice(1)} at ${d.park.name}`;
  const current = valueLines(d.field, d.current);
  const suggested = valueLines(d.field, d.suggested);
  const approveLabel = applies ? `Approve and update ${fieldLabel[d.field]}` : "Mark as fixed";

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader
        chip={<StateChip state="open" />}
        title={title}
        sub={
          <>
            Reported by {d.reporter ? `@${d.reporter}` : "a deleted user"}, {d.ago} ago ·{" "}
            <a href={`grindylocks://park/${d.park.slug}`} className="font-semibold text-gl-accent-text underline focus-ring">
              Park page
            </a>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 bg-gl-surface-sunk p-3">
          <span className="type-label text-gl-text-secondary">Listed now</span>
          {current.length ? (
            current.map((line, i) => (
              <span key={i} className="type-body-sm font-semibold whitespace-pre-wrap">
                {line}
              </span>
            ))
          ) : (
            <span className="type-body-sm text-gl-text-secondary">Nothing listed</span>
          )}
        </div>
        <div className="flex flex-col gap-1 border-2 border-gl-border p-3">
          <span className="type-label text-gl-text-secondary">Suggested</span>
          {suggested.length ? (
            suggested.map((line, i) => (
              <span key={i} className="type-body-sm font-semibold whitespace-pre-wrap">
                {line}
              </span>
            ))
          ) : (
            <span className="type-body-sm text-gl-text-secondary">No new value, see the note</span>
          )}
        </div>
      </div>

      {d.note && (
        <PaneSection title="Note">
          <p className="type-body whitespace-pre-wrap">{d.note}</p>
        </PaneSection>
      )}

      {d.photoUrl && (
        <PaneSection title="Photo">
          {/* A signed, short-lived URL from private storage. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.photoUrl} alt="Photo the reporter added" className="max-h-80 w-full bg-gl-surface-sunk object-contain" />
        </PaneSection>
      )}

      {applies && (
        <PaneSection title="Apply as">
          {d.field === "hours" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Days" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={inputClass}>
                  {Object.entries(DAY_PRESETS).map(([k, p]) => (
                    <option key={k} value={k}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  aria-label="Opens"
                  value={start}
                  disabled={fromSunrise}
                  onChange={(e) => setStart(e.target.value)}
                  className={inputClass}
                />
                <span aria-hidden="true">–</span>
                <input
                  type="time"
                  aria-label="Closes"
                  value={end}
                  disabled={untilSunset}
                  onChange={(e) => setEnd(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <Checkbox id="sunrise" label="From sunrise" checked={fromSunrise} onChange={setFromSunrise} />
                <Checkbox id="sunset" label="Until sunset" checked={untilSunset} onChange={setUntilSunset} />
              </div>
            </div>
          )}
          {d.field === "status" && (
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              {Object.entries(parkStatusLabel).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
          {d.field === "lighting" && (
            <select aria-label="Lights" value={lit} onChange={(e) => setLit(e.target.value)} className={inputClass}>
              <option value="yes">Lit at night</option>
              <option value="no">No lights</option>
            </select>
          )}
          {d.field === "fees" && (
            <div className="flex flex-wrap gap-2">
              <select aria-label="Paid or free" value={paid} onChange={(e) => setPaid(e.target.value)} className={inputClass}>
                <option value="no">Free</option>
                <option value="yes">Paid</option>
              </select>
              {paid === "yes" && (
                <input
                  aria-label="Entry fee"
                  placeholder="$5 a visit"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  className={`${inputClass} min-w-0 flex-1`}
                />
              )}
            </div>
          )}
          {d.field === "helmet_rule" && (
            <select aria-label="Helmet rule" value={helmet} onChange={(e) => setHelmet(e.target.value)} className={inputClass}>
              <option value="yes">Helmet required</option>
              <option value="no">Helmet not required</option>
              <option value="unknown">Not listed</option>
            </select>
          )}
          {d.field === "location" && (
            <div className="flex flex-col gap-2">
              <input aria-label="Address" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
              <div className="flex gap-2">
                <input aria-label="Latitude" placeholder="Latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} className={`${inputClass} min-w-0 flex-1`} />
                <input aria-label="Longitude" placeholder="Longitude" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} className={`${inputClass} min-w-0 flex-1`} />
              </div>
            </div>
          )}
          {d.field === "disciplines" && (
            <div className="flex flex-wrap gap-4">
              {Object.entries(disciplineLabel).map(([k, label]) => (
                <Checkbox
                  key={k}
                  id={`disc-${k}`}
                  label={label}
                  checked={disciplines.includes(k)}
                  onChange={(on) => setDisciplines(on ? [...disciplines, k] : disciplines.filter((x) => x !== k))}
                />
              ))}
            </div>
          )}
          {d.field === "description" && (
            <textarea
              aria-label="Description"
              rows={5}
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="resize-y border-2 border-gl-border bg-gl-surface-sunk px-3 py-2 type-body text-gl-text focus-ring"
            />
          )}
          <p className="type-caption text-gl-text-secondary">
            Filled in from the suggestion. Change it before approving if needed.
            {d.field === "hours" && " Hours for specific disciplines and seasons stay as they are."}
            {d.field === "description" && " Saved as the English description; translations follow."}
          </p>
        </PaneSection>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirm("approve")}>{approveLabel}</Button>
          <Button variant="outline" onClick={() => setConfirm("decline")}>
            Decline
          </Button>
        </div>
        {d.park.can_verify && (
          <Checkbox id="verify" label={`Also mark ${d.park.name} as verified today`} checked={verify} onChange={setVerify} />
        )}
        <p className="type-caption text-gl-text-secondary">
          {applies
            ? `Approving updates the park page right away and tells ${d.reporter ? `@${d.reporter}` : "the reporter"} their fix is live. The change goes in the park's edit history.`
            : `Make the change by hand first, then mark it fixed: ${d.reporter ? `@${d.reporter}` : "the reporter"} is told their fix is live.`}{" "}
          Declining tells nobody.
        </p>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={confirm === "approve" ? (applies ? `Update ${fieldLabel[d.field]} at ${d.park.name}?` : "Mark this as fixed?") : "Decline this report?"}
        description={
          confirm === "approve"
            ? applies
              ? `The park page shows ${valueLines(d.field, value()).join(", ") || "the new value"} right away.`
              : "Only do this once the park page is right."
            : "Nothing changes on the park page, and nobody is told."
        }
      >
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant={confirm === "approve" ? "primary" : "danger-solid"} disabled={pending} onClick={submit}>
            {confirm === "approve" ? approveLabel : "Decline"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
