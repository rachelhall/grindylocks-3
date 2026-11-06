"use client";

import { useEffect, useRef, useState } from "react";

import { project, TILE, TILE_URL } from "@/components/public/static-map";
import { Icon } from "@/components/ui/icon";

export type LatLng = { latitude: number; longitude: number };

const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

/** World pixels back to a position (Web Mercator). */
function unproject(x: number, y: number, zoom: number): LatLng {
  const scale = TILE * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude: ((((longitude + 180) % 360) + 360) % 360) - 180 };
}

/**
 * A map to place a pin by moving the map under it (Location, Nov 6): the pin
 * stays in the middle, and dragging (mouse or touch) or the arrow keys move
 * the map. + and − zoom. The same OpenStreetMap tiles as the public pages'
 * StaticMap, with no map library. `value` is where the pin points; the map
 * re-centres when it changes from outside (Find, Use my location).
 */
export function PinMap({
  value,
  onChange,
  label,
  credit,
  marker = "storefront",
  height = 360,
}: {
  value: LatLng;
  onChange: (next: LatLng) => void;
  label: string;
  credit: React.ReactNode;
  marker?: string;
  height?: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [zoom, setZoom] = useState(17);
  const drag = useRef<{ x: number; y: number; centre: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const centre = project(value.latitude, value.longitude, zoom);
  const left = centre.x - width / 2;
  const top = centre.y - height / 2;

  function moveBy(dx: number, dy: number) {
    const scale = TILE * 2 ** zoom;
    const y = Math.min(scale, Math.max(0, centre.y + dy));
    onChange(unproject(centre.x + dx, y, zoom));
  }

  const tiles: { key: string; src: string; x: number; y: number }[] = [];
  const count = 2 ** zoom;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= count) continue;
      const wrapped = ((tx % count) + count) % count;
      tiles.push({ key: `${zoom}/${tx}/${ty}`, src: TILE_URL(zoom, wrapped, ty), x: tx * TILE - left, y: ty * TILE - top });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        role="application"
        aria-roledescription="map"
        aria-label={`${label}. Drag the map, or use the arrow keys, to move it under the pin. Plus and minus zoom.`}
        tabIndex={0}
        className="relative w-full cursor-grab touch-none overflow-hidden border-2 border-gl-border bg-gl-surface-sunk select-none focus-ring active:cursor-grabbing"
        style={{ height }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button,a")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, centre };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const scale = TILE * 2 ** zoom;
          const y = Math.min(scale, Math.max(0, d.centre.y - (e.clientY - d.y)));
          onChange(unproject(d.centre.x - (e.clientX - d.x), y, zoom));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16;
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (moves[e.key]) {
            e.preventDefault();
            moveBy(...moves[e.key]);
          } else if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            setZoom((z) => Math.min(MAX_ZOOM, z + 1));
          } else if (e.key === "-") {
            e.preventDefault();
            setZoom((z) => Math.max(MIN_ZOOM, z - 1));
          }
        }}
      >
        {tiles.map((t) => (
          // Plain <img>: map tiles are already sized and cached by the tile server.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t.key}
            src={t.src}
            alt=""
            draggable={false}
            decoding="async"
            className="pointer-events-none absolute max-w-none grayscale-[35%]"
            style={{ left: t.x, top: t.y, width: TILE, height: TILE }}
          />
        ))}
        {/* The pin: a pink square with the icon, its point on the centre. */}
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
          <span className="flex size-9 items-center justify-center border-2 border-gl-ink bg-gl-pink text-gl-ink">
            <Icon name={marker} size={20} />
          </span>
          <span className="h-2.5 w-0.5 bg-gl-ink" />
        </span>
        <span className="absolute top-2 right-2 flex flex-col border-2 border-gl-border bg-gl-surface">
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))}
            className="flex size-control items-center justify-center border-b-2 border-gl-border focus-ring hover:bg-gl-text hover:text-gl-surface"
          >
            <Icon name="add" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
            className="flex size-control items-center justify-center focus-ring hover:bg-gl-text hover:text-gl-surface"
          >
            <Icon name="remove" />
          </button>
        </span>
        <span className="absolute right-0 bottom-0 bg-gl-surface-raised px-1.5 py-0.5 type-caption text-gl-text-secondary">{credit}</span>
      </div>
    </div>
  );
}
