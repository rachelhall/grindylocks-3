"use client";

import { useState, useTransition } from "react";

import { InfoNote, PageStamp } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { ProductSuggestionDetail } from "@/lib/brands";

import { exportCatalog, reviewProductSuggestion } from "./actions";
import { ErrorLine, inputClass, PaneHeader, PaneSection, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

const kindLabel: Record<ProductSuggestionDetail["kind"], string> = {
  missing_model: "Missing model",
  wrong_name: "Wrong name",
  wrong_year: "Wrong year",
  no_longer_made: "No longer made",
  stock_parts: "Stock parts",
  something_else: "Something else",
};

const statusLabel: Record<string, string> = { current: "Still made", discontinued: "No longer made", unknown: "Unknown" };

function partLabel(key: string | null | undefined): string {
  return key ? key.replaceAll("_", " ") : "";
}

/** Kinds the pane applies itself; the rest are changed by hand, then marked done. */
const APPLIES = new Set(["missing_model", "wrong_name", "wrong_year", "no_longer_made"]);

/**
 * A product suggestion (mockups: Admin · product suggestion, edit value and
 * mark done): what's listed beside what they suggest, an editable value, and
 * Approve and update (or Mark done) or Decline. Approve and Mark done tell
 * the suggester it's live; Decline tells nobody. The brand's CSV can be
 * downloaded here, so a fix can go back into the repo before the next import
 * undoes it.
 */
export function ProductSuggestionDetailPane({ detail: d }: { detail: ProductSuggestionDetail }) {
  const { done } = useQueue();
  const applies = APPLIES.has(d.kind);
  const p = d.product;
  const [value, setValue] = useState(d.kind === "no_longer_made" ? "" : (d.value ?? ""));
  const [partType, setPartType] = useState(d.partType ?? "");
  const [confirm, setConfirm] = useState<"approve" | "done" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [pending, startTransition] = useTransition();
  const who = d.suggester ? `@${d.suggester}` : "the suggester";

  useShortcuts({ a: () => setConfirm(applies ? "approve" : "done"), x: () => setConfirm("decline") });

  const listed: string | null =
    d.kind === "missing_model"
      ? null
      : d.kind === "wrong_name"
        ? (p?.name ?? null)
        : d.kind === "wrong_year"
          ? p?.firstYear
            ? `First year ${p.firstYear}`
            : "No year listed"
          : d.kind === "no_longer_made"
            ? statusLabel[p?.status ?? "unknown"]
            : null;
  const suggested: string | null =
    d.kind === "missing_model"
      ? `${d.value ?? ""}${d.partType ? ` · ${partLabel(d.partType)}` : ""}`
      : d.kind === "wrong_year"
        ? `First year ${d.value ?? ""}`
        : d.kind === "no_longer_made"
          ? "No longer made"
          : d.value;

  function submit() {
    const action = confirm!;
    startTransition(async () => {
      const result = await reviewProductSuggestion({
        id: d.id,
        action,
        value: action === "approve" && d.kind !== "no_longer_made" ? value : undefined,
        partType: action === "approve" && d.kind === "missing_model" ? partType : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      done(action === "decline" ? "Suggestion declined. Nobody is told." : `Done. ${who} is told their suggestion is live.`);
    });
  }

  function download() {
    startTransition(async () => {
      const result = await exportCatalog(d.page.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.page.handle}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
    });
  }

  const subject = p ? `${p.brand ?? d.page.name} ${p.name}` : d.page.name;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader chip={<StateChip state="open" />} title={`${kindLabel[d.kind]}: ${p ? p.name : (d.value ?? "")}`} sub={`By ${who}, ${d.ago} ago`} />

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-body-sm text-gl-text-secondary">
        {d.page.name}
        {p && ` · ${partLabel(p.partType).toUpperCase()}`}
        {p?.family && ` · family ${p.family}`}
        {p && p.entryType !== "model" && ` · ${p.entryType}${p.edition ? ` ${p.edition}` : ""}${p.proRider ? ` (${p.proRider})` : ""}`}
        <PageStamp state={d.page.state} hasLogo={false} />
      </p>

      {(listed !== null || suggested) && d.kind !== "stock_parts" && d.kind !== "something_else" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 border-2 border-gl-border bg-gl-surface-raised p-3">
            <span className="type-label text-gl-text-secondary">Listed now</span>
            <span className="type-body">{listed ?? <span className="text-gl-text-secondary">Not in the catalog</span>}</span>
          </div>
          <div className="flex flex-col gap-1 border-2 border-gl-border bg-gl-accent-subtle p-3 text-gl-on-accent-subtle">
            <span className="type-label text-gl-on-accent-subtle">Suggested</span>
            <span className="type-body font-semibold">{suggested}</span>
          </div>
        </div>
      )}

      {(d.kind === "stock_parts" || d.kind === "something_else") && d.value && (
        <PaneSection title="They wrote">
          <p className="type-body whitespace-pre-wrap">&ldquo;{d.value}&rdquo;</p>
        </PaneSection>
      )}

      {d.kind === "stock_parts" && p && (
        <PaneSection title="Listed stock parts">
          {p.stockParts.length ? (
            <ul className="border-2 border-gl-border bg-gl-surface-raised type-body-sm">
              {p.stockParts.map((s) => (
                <li key={s.partType} className="flex justify-between gap-4 border-t border-gl-border-subtle px-3 py-2 first:border-t-0">
                  <span className="capitalize">{partLabel(s.partType)}</span>
                  <span className="font-semibold">
                    {s.brand} {s.name}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body-sm text-gl-text-secondary">None listed{p.includesFrame ? " (the boot includes its frame)" : ""}.</p>
          )}
        </PaneSection>
      )}

      {d.note && (
        <PaneSection title="Note">
          <p className="type-body whitespace-pre-wrap">&ldquo;{d.note}&rdquo;</p>
        </PaneSection>
      )}

      {applies && d.kind !== "no_longer_made" && (
        <PaneSection title="Apply as">
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={d.kind === "wrong_year" ? "First year" : "Name"}
              value={value}
              maxLength={80}
              onChange={(e) => setValue(e.target.value)}
              className={d.kind === "wrong_year" ? `${inputClass} w-32 tabular-nums` : `${inputClass} min-w-0 flex-1`}
            />
            {d.kind === "missing_model" && (
              <select aria-label="Part" value={partType} onChange={(e) => setPartType(e.target.value)} className={inputClass}>
                <option value="">Pick a part…</option>
                {d.partTypes.map((t) => (
                  <option key={t} value={t}>
                    {partLabel(t)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="type-caption text-gl-text-secondary">
            {d.kind === "wrong_year"
              ? "2019, or c. 2019 when it's not certain. Filled in from the suggestion."
              : d.kind === "missing_model"
                ? "Added as a model, status unknown, with the brand's disciplines for that part. Filled in from the suggestion."
                : "Filled in from the suggestion. Change it before approving if needed."}
          </p>
        </PaneSection>
      )}

      {!applies && (
        <InfoNote icon="edit_note">
          {kindLabel[d.kind]} can&apos;t be applied from here. Change the catalog in Supabase or the brand&apos;s CSV, then mark it done.
        </InfoNote>
      )}

      <div className="flex flex-col gap-3 border-t-2 border-gl-border pt-4">
        <ErrorLine error={confirm ? null : error} />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || (applies && d.kind !== "no_longer_made" && !value.trim()) || (d.kind === "missing_model" && !partType)}
            onClick={() => setConfirm(applies ? "approve" : "done")}
          >
            {applies ? "Approve and update" : "Mark done"}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => setConfirm("decline")}>
            Decline
          </Button>
        </div>
        <p className="type-caption text-gl-text-secondary">
          {applies
            ? `Updates the catalog right away and tells ${who} their suggestion is live.`
            : `Mark done tells ${who} their suggestion is live.`}{" "}
          Decline tells nobody.
        </p>
      </div>

      <PaneSection title="Keep the CSV in step" className="border-t border-gl-border-subtle pt-4">
        <p className="type-body-sm">
          The repo&apos;s CSV for {d.page.name} is the catalog&apos;s source, so a fix made here is undone by the next import unless it goes back in. After
          approving, download the CSV and replace <code className="font-mono">supabase/seed/products/{d.page.handle}.csv</code> with it.
        </p>
        <Button variant="outline" className="self-start" disabled={pending} onClick={download}>
          <Icon name="download" />
          {exported ? "Download again" : `Download ${d.page.handle}.csv`}
        </Button>
      </PaneSection>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={confirm === "decline" ? "Decline this suggestion?" : confirm === "done" ? "Mark this done?" : `Update ${subject}?`}
        description={
          confirm === "decline"
            ? "The catalog stays as it is, and nobody is told."
            : confirm === "done"
              ? "Only once the catalog is right. They're told their suggestion is live."
              : "The Products tab shows it right away, and they're told their suggestion is live."
        }
      >
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant={confirm === "decline" ? "danger-solid" : "primary"} disabled={pending} onClick={submit}>
            {confirm === "decline" ? "Decline" : confirm === "done" ? "Mark done" : "Approve and update"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
