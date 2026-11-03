/**
 * Edge markers (v2, Nov 2; "Map · edge markers" in the Map (v2) row): where
 * an off-screen park's tag sits on the edge of the map, and which way its
 * arrow points. Pure geometry, no React.
 *
 * Screen positions come from the map's own visible area (not the region we
 * asked it to show, which it may adjust), the way the map draws it:
 * longitude is linear across the screen, latitude follows Web Mercator.
 */

/** The map's visible area, as the map itself reports it. */
export type View = { north: number; south: number; east: number; west: number };
export type Point = { x: number; y: number };
/** The part of the screen markers may sit in (clear of the search bar, buttons and cards). */
export type Frame = { left: number; top: number; right: number; bottom: number };
export type Edge = 'top' | 'right' | 'bottom' | 'left';

const RAD = Math.PI / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2));

/** Degrees of longitude across the view (it may cross the antimeridian). */
export function lngSpan(v: View) {
  return v.east >= v.west ? v.east - v.west : v.east + 360 - v.west;
}

/** Where a coordinate falls on a w×h map showing `view` (may be off-screen). */
export function project(v: View, w: number, h: number, coord: { latitude: number; longitude: number }): Point {
  let dLng = coord.longitude - v.west;
  // Measure from the west edge the short way round, so the far side of the
  // antimeridian lands to the right and not 360° away.
  if (dLng < -180) dLng += 360;
  if (dLng > 180 + lngSpan(v) / 2) dLng -= 360;
  const x = (dLng / lngSpan(v)) * w;
  const top = mercY(v.north);
  const y = ((top - mercY(coord.latitude)) / (top - mercY(v.south))) * h;
  return { x, y };
}

export function isOnScreen(p: Point, w: number, h: number) {
  return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
}

/**
 * Where the line from the map's centre towards `p` leaves `frame`, which
 * edge that is, and the arrow's angle (degrees clockwise from up).
 */
export function edgePoint(center: Point, p: Point, frame: Frame): { point: Point; edge: Edge; angle: number } {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  // How far along the line each edge is; the nearest one is where it leaves.
  const hits: { t: number; edge: Edge }[] = [];
  if (dx > 0) hits.push({ t: (frame.right - center.x) / dx, edge: 'right' });
  if (dx < 0) hits.push({ t: (frame.left - center.x) / dx, edge: 'left' });
  if (dy > 0) hits.push({ t: (frame.bottom - center.y) / dy, edge: 'bottom' });
  if (dy < 0) hits.push({ t: (frame.top - center.y) / dy, edge: 'top' });
  const hit = hits.filter((h) => h.t >= 0).sort((a, b) => a.t - b.t)[0] ?? { t: 0, edge: 'top' as Edge };
  const point = {
    x: Math.min(frame.right, Math.max(frame.left, center.x + dx * hit.t)),
    y: Math.min(frame.bottom, Math.max(frame.top, center.y + dy * hit.t)),
  };
  return { point, edge: hit.edge, angle };
}

/**
 * The tag's top-left corner for a marker `size` big, sitting just inside
 * `frame` where its line leaves it.
 */
export function tagPosition(
  hit: { point: Point; edge: Edge },
  size: { width: number; height: number },
  frame: Frame,
): Point {
  const clampX = (x: number) => Math.min(frame.right - size.width, Math.max(frame.left, x));
  const clampY = (y: number) => Math.min(frame.bottom - size.height, Math.max(frame.top, y));
  switch (hit.edge) {
    case 'left':
      return { x: frame.left, y: clampY(hit.point.y - size.height / 2) };
    case 'right':
      return { x: frame.right - size.width, y: clampY(hit.point.y - size.height / 2) };
    case 'top':
      return { x: clampX(hit.point.x - size.width / 2), y: frame.top };
    case 'bottom':
      return { x: clampX(hit.point.x - size.width / 2), y: frame.bottom - size.height };
  }
}

/** Two tags overlap (with a little breathing room). */
export function overlaps(a: Point & { width: number; height: number }, b: Point & { width: number; height: number }) {
  const gap = 8;
  return (
    a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
  );
}
