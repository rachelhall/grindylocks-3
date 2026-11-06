/**
 * A small, non-interactive map: OpenStreetMap tiles with square pink pins,
 * framed to fit the points. No map library and no JavaScript; positions are
 * percentages of a fixed frame, so it scales with its container.
 *
 * Tiles come from tile.openstreetmap.org for now, which asks for attribution
 * (shown) and light use. If traffic grows, swap TILE_URL for a hosted tile
 * or static-map service; nothing else changes.
 */
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE = 256;

type Point = { latitude: number; longitude: number; label?: string };

/** World pixel position at a zoom level (Web Mercator). */
function project(lat: number, lng: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function StaticMap({
  points,
  width,
  height,
  label,
  maxZoom = 15,
  className,
}: {
  points: Point[];
  /** The frame in CSS pixels at its designed size; it scales with its container. */
  width: number;
  height: number;
  label: string;
  maxZoom?: number;
  className?: string;
}) {
  if (points.length === 0) return null;

  // The closest zoom that fits every point with a margin around the edge.
  const pad = 28;
  let zoom = maxZoom;
  for (; zoom > 2; zoom--) {
    const px = points.map((p) => project(p.latitude, p.longitude, zoom));
    const w = Math.max(...px.map((p) => p.x)) - Math.min(...px.map((p) => p.x));
    const h = Math.max(...px.map((p) => p.y)) - Math.min(...px.map((p) => p.y));
    if (w <= width - 2 * pad && h <= height - 2 * pad) break;
  }
  const px = points.map((p) => project(p.latitude, p.longitude, zoom));
  const centre = {
    x: (Math.max(...px.map((p) => p.x)) + Math.min(...px.map((p) => p.x))) / 2,
    y: (Math.max(...px.map((p) => p.y)) + Math.min(...px.map((p) => p.y))) / 2,
  };
  const left = centre.x - width / 2;
  const top = centre.y - height / 2;

  const tiles: { key: string; src: string; x: number; y: number }[] = [];
  const count = 2 ** zoom;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= count) continue;
      const wrapped = ((tx % count) + count) % count;
      tiles.push({ key: `${tx}/${ty}`, src: TILE_URL(zoom, wrapped, ty), x: tx * TILE - left, y: ty * TILE - top });
    }
  }
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div
      role="img"
      aria-label={label}
      className={`relative w-full overflow-hidden border-2 border-gl-border bg-gl-surface-sunk ${className ?? ""}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {tiles.map((t) => (
        // Plain <img>: map tiles are already sized and cached by the tile server.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={t.key}
          src={t.src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute max-w-none select-none grayscale-[35%]"
          style={{ left: pct(t.x, width), top: pct(t.y, height), width: pct(TILE, width), height: pct(TILE, height) }}
        />
      ))}
      {px.map((p, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 border-2 border-gl-ink bg-gl-pink"
          style={{ left: pct(p.x - left, width), top: pct(p.y - top, height) }}
        />
      ))}
      <a
        href="https://www.openstreetmap.org/copyright"
        className="absolute right-0 bottom-0 bg-gl-surface-raised px-1.5 py-0.5 type-caption text-gl-text-secondary no-underline"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
