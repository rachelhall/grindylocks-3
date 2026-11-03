"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { typingOrDialog, useQueue } from "./queue-view";

/** "Nov 2". In UTC, so the server and the browser render the same text. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The pane's top: a state chip or label, the heading, a line under it, and Close. */
export function PaneHeader({ chip, title, sub }: { chip?: React.ReactNode; title: string; sub?: React.ReactNode }) {
  const { close } = useQueue();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {chip}
        <h2 className="type-headline">{title}</h2>
        {sub && <p className="type-body-sm text-gl-text-secondary">{sub}</p>}
      </div>
      <Button variant="outline" size="icon" aria-label="Close details" title="Close (Esc)" onClick={close}>
        <Icon name="close" />
      </Button>
    </div>
  );
}

export function PaneSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h3 className="type-label text-gl-text-secondary">{title}</h3>
      {children}
    </section>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="type-body-sm text-gl-danger">
      {error}
    </p>
  );
}

/**
 * Single-key shortcuts for a pane ("d", "h", …). Ignored while typing or with
 * a dialog open. Each one should open a confirmation, never act directly.
 */
export function useShortcuts(map: Record<string, (() => void) | null | undefined>) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (typingOrDialog(event)) return;
      const run = ref.current[event.key];
      if (run) {
        event.preventDefault();
        run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function TextArea({
  id,
  label,
  hint,
  value,
  onChange,
  required,
  rows = 3,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label text-gl-text-secondary">
        {label}
        {!required && <span className="normal-case tracking-normal"> (optional)</span>}
      </label>
      <textarea
        id={id}
        rows={rows}
        maxLength={500}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="resize-y border-2 border-gl-border bg-gl-surface-sunk px-3 py-2 type-body text-gl-text placeholder:text-gl-text-secondary focus-ring"
      />
      {hint && <p className="type-caption text-gl-text-secondary">{hint}</p>}
    </div>
  );
}

export function Checkbox({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2.5 type-body-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[18px] accent-gl-accent focus-ring"
      />
      {label}
    </label>
  );
}

export const inputClass =
  "h-control border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm text-gl-text placeholder:text-gl-text-secondary focus-ring";
