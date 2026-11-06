"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * The bar pinned to the bottom of an editing section (as on the boards):
 * what's unsaved, Discard changes and Save. Hidden when nothing changed.
 * Leaving the tab with unsaved changes asks first.
 */
export function SaveBar({
  changes,
  pending,
  error,
  saved,
  onDiscard,
  onSave,
}: {
  /** What's changed, in a few words ("description (English)"); empty when nothing has. */
  changes: string[];
  pending: boolean;
  error: string | null;
  saved: string | null;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const dirty = changes.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!dirty && !error && !saved) return null;

  return (
    <div className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-end gap-3 border-t-2 border-gl-border bg-gl-surface px-6 py-3">
      <p
        role={error ? "alert" : "status"}
        className={error ? "mr-auto type-body-sm text-gl-danger" : "mr-auto type-body-sm text-gl-text-secondary"}
      >
        {error ?? (dirty ? `Unsaved changes: ${changes.join(", ")}` : saved)}
      </p>
      {dirty && (
        <>
          <Button variant="outline" onClick={onDiscard} disabled={pending}>
            Discard changes
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      )}
    </div>
  );
}
