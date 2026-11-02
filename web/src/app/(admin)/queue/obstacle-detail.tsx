"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ObstacleDetail, ObstacleType } from "@/lib/queue";
import { obstacleTypeLabel, obstacleTypes } from "@/lib/queue-labels";
import { cn } from "@/lib/utils";

import { reviewObstacle } from "./actions";
import { ErrorLine, inputClass, PaneHeader, PaneSection, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/**
 * A suggested obstacle (mockup: Admin · suggested obstacle): check the name
 * and type, or merge it into an obstacle the park already has, or decline.
 * Park contributors can approve; merging and declining are for park and city
 * admins.
 */
export function ObstacleDetailPane({ detail: d }: { detail: ObstacleDetail }) {
  const { done } = useQueue();
  const [name, setName] = useState(d.name);
  const [type, setType] = useState<ObstacleType>(d.generalType);
  const [mergeInto, setMergeInto] = useState<string>("");
  const [confirm, setConfirm] = useState<"approve" | "merge" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const merging = mergeInto !== "";
  const target = d.mergeOptions.find((o) => o.id === mergeInto);
  const who = d.suggestedBy ? `@${d.suggestedBy}` : "a deleted user";

  useShortcuts({
    a: () => setConfirm(merging ? "merge" : "approve"),
    x: d.canMerge ? () => setConfirm("decline") : null,
  });

  function submit() {
    const decision = confirm!;
    startTransition(async () => {
      const result = await reviewObstacle({
        id: d.id,
        decision,
        name: decision === "approve" ? name : undefined,
        generalType: decision === "approve" ? type : undefined,
        mergeInto: decision === "merge" ? mergeInto : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      done(
        decision === "approve"
          ? `${name.trim() || d.name} added to ${d.park.name}.`
          : decision === "merge"
            ? `Merged into ${target?.name ?? "the obstacle"}.`
            : "Suggestion declined.",
      );
    });
  }

  const tagged =
    d.slideCount === 0
      ? `No slides tagged yet. Only ${who} sees it until it's approved.`
      : `${plural(d.slideCount, "slide")} in ${plural(d.postCount, "post")}. Only ${who} sees the tag until it's approved.`;

  const dialogs = {
    approve: {
      title: `Add “${name.trim() || d.name}” to ${d.park.name}?`,
      description: "It joins the park's obstacle list with its own feed, and everyone sees the tag.",
      confirm: "Approve obstacle",
    },
    merge: {
      title: `Merge into ${target?.name ?? "this obstacle"}?`,
      description: "The tags move to the obstacle the park already has, and the suggestion goes away.",
      confirm: "Merge",
    },
    decline: {
      title: "Decline this suggestion?",
      description: `The posts stay, and their tag becomes the type (${obstacleTypeLabel(d.generalType).toLowerCase()}).`,
      confirm: "Decline",
    },
  } as const;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader
        chip={<StateChip state="open" />}
        title={`New obstacle at ${d.park.name}`}
        sub={`Suggested by ${who} while posting, ${d.ago} ago`}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ob-name" className="type-label text-gl-text-secondary">
            Name
          </label>
          <input
            id="ob-name"
            maxLength={60}
            value={name}
            disabled={merging}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ob-type" className="type-label text-gl-text-secondary">
            Type
          </label>
          <select
            id="ob-type"
            value={type}
            disabled={merging}
            onChange={(e) => setType(e.target.value as ObstacleType)}
            className={inputClass}
          >
            {obstacleTypes.map((t) => (
              <option key={t} value={t}>
                {obstacleTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {d.notes && (
        <PaneSection title="Notes">
          <p className="type-body whitespace-pre-wrap">{d.notes}</p>
        </PaneSection>
      )}

      <PaneSection title="Tagged so far">
        <p className="type-body-sm">{tagged}</p>
      </PaneSection>

      {d.canMerge && d.mergeOptions.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 type-label text-gl-text-secondary">Or merge into an obstacle {d.park.name} already has</legend>
          {[{ id: "", name: "Don't merge: it's a new obstacle", generalType: null }, ...d.mergeOptions].map((o) => (
            <label
              key={o.id || "none"}
              className={cn(
                "flex min-h-11 items-center gap-2.5 border-2 px-3 py-2 type-body-sm",
                mergeInto === o.id ? "border-gl-border bg-gl-accent-subtle text-gl-on-accent-subtle" : "border-gl-border-subtle",
              )}
            >
              <input
                type="radio"
                name="merge"
                checked={mergeInto === o.id}
                onChange={() => setMergeInto(o.id)}
                className="accent-gl-accent focus-ring"
              />
              <span className="font-semibold">{o.name}</span>
              {o.generalType && <span className="text-gl-text-secondary">· {obstacleTypeLabel(o.generalType).toLowerCase()}</span>}
            </label>
          ))}
          {d.hasStreetPlaza && (
            <p className="type-caption text-gl-text-secondary">The street section is a placeholder area, so it can&apos;t take a merge.</p>
          )}
        </fieldset>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {merging ? (
            <Button onClick={() => setConfirm("merge")}>Merge into {target?.name}</Button>
          ) : (
            <Button disabled={!name.trim()} onClick={() => setConfirm("approve")}>
              Approve obstacle
            </Button>
          )}
          {d.canMerge && (
            <Button variant="outline" onClick={() => setConfirm("decline")}>
              Decline
            </Button>
          )}
        </div>
        <p className="type-caption text-gl-text-secondary">
          Approving adds it to {d.park.name}&apos;s obstacle list with its own feed, and everyone sees the tag.
          {d.canMerge
            ? ` Declining keeps the posts but changes the tag to its type (${obstacleTypeLabel(d.generalType).toLowerCase()}).`
            : " Merging and declining are for park and city admins."}
        </p>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={confirm ? dialogs[confirm].title : ""}
        description={confirm ? dialogs[confirm].description : undefined}
      >
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant={confirm === "decline" ? "danger-solid" : "primary"} disabled={pending} onClick={submit}>
            {confirm ? dialogs[confirm].confirm : ""}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
