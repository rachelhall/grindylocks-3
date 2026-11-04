"use client";

import { useState, useTransition } from "react";

import { InfoNote, PageStamp } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Json } from "@/lib/database.types";
import type { PageFixDetail, PageFixField } from "@/lib/brands";

import { reviewPageFix } from "./actions";
import { ErrorLine, inputClass, PaneHeader, PaneSection, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

const fieldTitle: Record<PageFixField, string> = {
  hours: "Hours",
  location_type: "Storefront or not",
  location: "Address or pin",
  brands_carried: "Brands carried",
  website: "Website",
  closed: "Closed for good",
  other: "Something else",
};

const visitLabel: Record<string, string> = {
  storefront: "Storefront, with a map pin",
  by_appointment: "By appointment",
  online_only: "Online only",
};

const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** What the shop lists now, as lines of text. */
function currentLines(field: PageFixField, v: Json | null): string[] {
  if (v === null || v === undefined) return [];
  if (field === "location_type" && typeof v === "string") return [visitLabel[v] ?? v];
  if (field === "website" && typeof v === "string") return [v];
  if (field === "closed" && typeof v === "string") return [v === "closed" ? "Closed" : "Open (listed as a shop)"];
  if (field === "brands_carried" && Array.isArray(v)) return v.length ? [v.join(", ")] : [];
  if (field === "location" && typeof v === "object" && !Array.isArray(v)) {
    const lines: string[] = [];
    if (typeof v.address === "string") lines.push(v.address);
    if (typeof v.latitude === "number" && typeof v.longitude === "number") lines.push(`Pin ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}`);
    return lines;
  }
  if (field === "hours" && Array.isArray(v)) {
    return v.map((h) => {
      const o = h as { days?: number[]; start?: string | null; end?: string | null; start_anchor?: string; end_anchor?: string; note?: string | null };
      const days = (o.days ?? []).map((d) => dayNames[d]).join(", ");
      const from = o.start_anchor === "sunrise" ? "sunrise" : (o.start ?? "").slice(0, 5);
      const to = o.end_anchor === "sunset" ? "sunset" : (o.end ?? "").slice(0, 5);
      return `${days} ${from}–${to}${o.note ? ` (${o.note})` : ""}`;
    });
  }
  return [];
}

/** Fields the pane applies itself; the rest are changed by hand, then marked done. */
const APPLIES = new Set<PageFixField>(["location_type", "website", "closed"]);

/**
 * A fix suggested on an unofficial shop (the Shop-Fix sheet): the shop's
 * city admin reviews it, with Rachel as backup. Built on the park info
 * report's pattern. Storefront or not, Website and Closed for good apply
 * from here; hours, address, brands carried and anything else are changed
 * by hand (by Rachel, until the page tools), so city admins send those on.
 */
export function ShopFixDetailPane({ detail: d }: { detail: PageFixDetail }) {
  const { done } = useQueue();
  const applies = APPLIES.has(d.field);
  const [value, setValue] = useState(d.value ?? "");
  const [confirm, setConfirm] = useState<"approve" | "done" | "decline" | "escalate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const who = d.reporter ? `@${d.reporter}` : "the reporter";

  useShortcuts({
    a: () => setConfirm(applies ? "approve" : d.canEscalate ? "escalate" : "done"),
    x: () => setConfirm("decline"),
    e: d.canEscalate ? () => setConfirm("escalate") : null,
  });

  const current = currentLines(d.field, d.current);
  const suggested = d.field === "closed" ? "Closed for good" : d.field === "location_type" ? (visitLabel[d.value ?? ""] ?? d.value) : d.value;

  function submit() {
    const action = confirm!;
    startTransition(async () => {
      const result = await reviewPageFix({ id: d.id, action, value: action === "approve" ? value : undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      done(
        action === "decline"
          ? "Fix declined. Nobody is told."
          : action === "escalate"
            ? "Sent to Rachel."
            : `Done. ${who} is told their fix is live.`,
      );
    });
  }

  const primary: "approve" | "done" | "escalate" = applies ? "approve" : d.canEscalate ? "escalate" : "done";
  const primaryLabel = { approve: `Approve and update`, done: "Mark as fixed", escalate: "Send to Rachel" }[primary];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader
        chip={<StateChip state={d.escalated && !d.canEscalate ? "sent_to_you" : "open"} />}
        title={`${fieldTitle[d.field]} at ${d.page.name}`}
        sub={`Suggested by ${who}, ${d.ago} ago${d.metro ? ` · ${d.metro}` : ""}`}
      />

      <p className="flex items-center gap-2 type-body-sm text-gl-text-secondary">
        Shop{d.page.city ? ` · ${d.page.city}` : ""} · @{d.page.handle}
        <PageStamp state={d.page.state} hasLogo={d.page.hasLogo} />
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 border-2 border-gl-border bg-gl-surface-raised p-3">
          <span className="type-label text-gl-text-secondary">Listed now</span>
          {current.length ? (
            current.map((line, i) => (
              <span key={i} className="type-body-sm font-semibold">
                {line}
              </span>
            ))
          ) : (
            <span className="type-body-sm text-gl-text-secondary">Nothing listed</span>
          )}
        </div>
        <div className="flex flex-col gap-1 border-2 border-gl-border bg-gl-accent-subtle p-3 text-gl-on-accent-subtle">
          <span className="type-label">Suggested</span>
          <span className="type-body-sm font-semibold whitespace-pre-wrap">{suggested}</span>
        </div>
      </div>

      {d.note && (
        <PaneSection title="Note">
          <p className="type-body whitespace-pre-wrap">&ldquo;{d.note}&rdquo;</p>
        </PaneSection>
      )}

      {applies && d.field !== "closed" && (
        <PaneSection title="Apply as">
          {d.field === "location_type" ? (
            <select aria-label="How people visit" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass}>
              <option value="storefront">Storefront (pin, hours and open now)</option>
              <option value="by_appointment">By appointment (no pin)</option>
              <option value="online_only">Online only (no pin)</option>
            </select>
          ) : (
            <input aria-label="Website" value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} className={inputClass} />
          )}
          <p className="type-caption text-gl-text-secondary">
            {d.field === "location_type"
              ? "An unofficial by-appointment shop shows no pin, since it may be someone's home."
              : "Filled in from the suggestion. Change it before approving if needed."}
          </p>
        </PaneSection>
      )}

      {d.field === "closed" && (
        <InfoNote icon="storefront">
          Approving makes {d.page.name} a Closed archive: no map pin, hours or Follow, and it leaves brands-carried lists. Search still finds it, labelled Closed.
        </InfoNote>
      )}

      {!applies && (
        <InfoNote icon="edit_note">
          {d.canEscalate
            ? `${fieldTitle[d.field]} can't be changed from here yet. Send it to Rachel, who changes it by hand.`
            : `${fieldTitle[d.field]} can't be changed from here yet. Change it in Supabase, then mark it fixed.`}
        </InfoNote>
      )}

      <div className="flex flex-col gap-3 border-t-2 border-gl-border pt-4">
        <ErrorLine error={confirm ? null : error} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || (applies && d.field !== "closed" && !value.trim())} onClick={() => setConfirm(primary)}>
            {primaryLabel}
          </Button>
          {applies && d.canEscalate && (
            <Button variant="outline" disabled={pending} onClick={() => setConfirm("escalate")}>
              Send to Rachel
            </Button>
          )}
          <Button variant="outline" disabled={pending} onClick={() => setConfirm("decline")}>
            Decline
          </Button>
        </div>
        <p className="type-caption text-gl-text-secondary">
          {primary === "escalate"
            ? `It leaves your queue and goes to Rachel's. ${who} is told when it's live.`
            : `${primary === "approve" ? "Updates the shop page right away" : "Only once the shop page is right"}, and tells ${who} their fix is live.`}{" "}
          Declining tells nobody.
        </p>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={
          confirm === "approve"
            ? d.field === "closed"
              ? `Mark ${d.page.name} closed for good?`
              : `Update ${fieldTitle[d.field].toLowerCase()} at ${d.page.name}?`
            : confirm === "done"
              ? "Mark this as fixed?"
              : confirm === "escalate"
                ? "Send this to Rachel?"
                : "Decline this fix?"
        }
        description={
          confirm === "decline"
            ? "Nothing changes on the shop page, and nobody is told."
            : confirm === "escalate"
              ? "It leaves your queue."
              : `${who} is told their fix is live.`
        }
      >
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant={confirm === "decline" || (confirm === "approve" && d.field === "closed") ? "danger-solid" : "primary"}
            disabled={pending}
            onClick={submit}
          >
            {confirm === "approve" ? (d.field === "closed" ? "Mark closed" : "Approve and update") : confirm === "done" ? "Mark as fixed" : confirm === "escalate" ? "Send to Rachel" : "Decline"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
