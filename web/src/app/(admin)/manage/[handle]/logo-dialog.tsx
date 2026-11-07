"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { DEFAULT_CROP, type LogoCrop, LOGO_TYPES, logoRect, toLogoPng } from "@/lib/logo-png";

import { saveLogo } from "./actions";

type Picked = { file: File; url: string; width: number; height: number };

const ZOOM_MIN = 50;
const ZOOM_MAX = 300;

/**
 * Change logo (mockup: Web · change logo): pick a file, zoom and drag it
 * inside the square, and see it where it shows (page header, Search, the ink
 * post card). Saving crops it in the browser to a 512 px PNG, as the app
 * does, keeping transparency.
 */
export function LogoDialog({ handle, pageName, open, onOpenChange }: { handle: string; pageName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [crop, setCrop] = useState<LogoCrop>(DEFAULT_CROP);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; start: LogoCrop["offset"]; size: number } | null>(null);

  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  function reset() {
    setPicked(null);
    setCrop(DEFAULT_CROP);
    setError(null);
  }

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!LOGO_TYPES.test(file.type)) return setError("Use a PNG (best, keeps transparency), JPEG or WebP.");
    if (file.size > 15_000_000) return setError("That file is over 15 MB. Try a smaller one.");
    try {
      const bitmap = await createImageBitmap(file);
      setPicked({ file, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height });
      bitmap.close();
      setCrop(DEFAULT_CROP);
    } catch {
      setError("Couldn't read that image. Try another file.");
    }
  }

  function nudge(dx: number, dy: number) {
    setCrop((c) => ({ ...c, offset: { x: clamp(c.offset.x + dx, -1, 1), y: clamp(c.offset.y + dy, -1, 1) } }));
  }

  function save() {
    if (!picked) return setError("Choose a file first.");
    startTransition(async () => {
      try {
        const png = await toLogoPng(picked.file, crop);
        const form = new FormData();
        form.set("logo", new File([png], "logo.png", { type: "image/png" }));
        const result = await saveLogo(handle, form);
        if (!result.ok) return setError(result.error);
        onOpenChange(false);
        reset();
        router.refresh();
      } catch {
        setError("Couldn't make the logo from that image. Try another file.");
      }
    });
  }

  const image = picked && (
    // A local file being cropped; next/image can't help here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={picked.url} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={placed(picked, crop)} />
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        onOpenChange(o);
        if (!o) reset();
      }}
      title="Change logo"
      description={`Your logo is public. It shows on ${pageName}'s page, in Search, on your posts and on meetups you host.`}
      className="w-[min(760px,calc(100vw-32px))]"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {!picked ? (
        <div className="flex flex-col items-start gap-3 border-2 border-dashed border-gl-border p-6">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            Choose a file
          </Button>
          <p className="type-body-sm text-gl-text-secondary">
            PNG, JPEG or WebP. It becomes a 512 px square PNG, and a transparent background stays transparent.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-6">
          <div className="flex min-w-[260px] flex-1 flex-col gap-3">
            <div
              role="group"
              aria-label="Logo position. Drag, or use the arrow keys."
              tabIndex={0}
              className="relative aspect-square w-full max-w-[320px] cursor-grab touch-none overflow-hidden border-2 border-gl-border bg-gl-surface focus-ring active:cursor-grabbing"
              style={{ backgroundImage: "repeating-conic-gradient(var(--gl-surface-sunk) 0% 25%, transparent 0% 50%)", backgroundSize: "16px 16px" }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, start: crop.offset, size: e.currentTarget.clientWidth };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                setCrop((c) => ({
                  ...c,
                  offset: { x: clamp(d.start.x + (e.clientX - d.x) / d.size, -1, 1), y: clamp(d.start.y + (e.clientY - d.y) / d.size, -1, 1) },
                }));
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.05 : 0.01;
                const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                const m = moves[e.key];
                if (!m) return;
                e.preventDefault();
                nudge(...m);
              }}
            >
              {image}
              {/* The pink line: what shows in round-ish small spots. */}
              <span aria-hidden="true" className="pointer-events-none absolute inset-[10%] rounded-full border-2 border-dashed border-gl-pink" />
            </div>
            <div className="flex max-w-[320px] items-center gap-3">
              <label htmlFor="logo-zoom" className="type-body-sm font-semibold">
                Zoom
              </label>
              <input
                id="logo-zoom"
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                value={Math.round(crop.zoom * 100)}
                onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) / 100 }))}
                className="flex-1 accent-gl-accent"
              />
              <span className="w-12 text-right type-body-sm tabular-nums">{Math.round(crop.zoom * 100)}%</span>
            </div>
            <p className="type-body-sm text-gl-text-secondary">
              {picked.file.name} · {picked.width} × {picked.height}. Drag to move it inside the square. The pink line is
              what shows in round-ish small spots, so keep the mark inside it.
            </p>
            <Button variant="outline" className="self-start" onClick={() => fileRef.current?.click()}>
              Choose another file
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            <span className="type-label text-gl-text-secondary">How it shows</span>
            <Preview label="Page header" size={64} ground="paper" picked={picked} crop={crop} />
            <Preview label="Search" size={40} ground="raised" picked={picked} crop={crop} />
            <Preview label="Post card, on ink" size={32} ground="ink" picked={picked} crop={crop} />
            <p className="max-w-[260px] type-caption text-gl-text-secondary">
              Transparent parts show the page behind them. A logo that&apos;s dark on transparent can disappear on the
              ink post card, so add a background if it does.
            </p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="type-body-sm text-gl-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => {
            onOpenChange(false);
            reset();
          }}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !picked}>
          {pending ? "Saving…" : "Save logo"}
        </Button>
      </div>
    </Dialog>
  );
}

function Preview({ label, size, ground, picked, crop }: { label: string; size: number; ground: "paper" | "raised" | "ink"; picked: Picked; crop: LogoCrop }) {
  const bg = ground === "ink" ? "bg-gl-ink text-gl-paper" : ground === "raised" ? "bg-gl-surface-raised" : "bg-gl-surface";
  return (
    <div className={`flex items-center gap-3 border-2 border-gl-border p-2.5 ${bg}`}>
      <span className="relative shrink-0 overflow-hidden border-2 border-gl-border" style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={picked.url} alt="" draggable={false} className="absolute max-w-none" style={placed(picked, crop)} />
      </span>
      <span className="type-body-sm font-semibold">{label}</span>
    </div>
  );
}

/** The image's place inside a square frame, in percentages, matching the saved PNG. */
function placed(picked: Picked, crop: LogoCrop): React.CSSProperties {
  const r = logoRect(picked.width, picked.height, 100, crop);
  return { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
