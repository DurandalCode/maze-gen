import type { Point, Wall } from '../core/maze';
export const EPS = 1e-7;
export const quantize = (n: number) => Math.round(n * 1000) / 1000;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const ends = (w: Wall): [Point, Point] => [{ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 }];
export const segment = (a: Point, b: Point): Wall => ({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
export function closest(p: Point, a: Point, b: Point): Point {
  const d = distance(a, b) ** 2;
  return lerp(a, b, d ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / d)) : 0);
}
export const segmentDistance = (p: Point, w: Wall) => distance(p, closest(p, ...ends(w)));
export function intersection(a: Point, b: Point, c: Point, d: Point): number | null {
  const vx = b.x - a.x, vz = b.z - a.z, wx = d.x - c.x, wz = d.z - c.z, det = vx * wz - vz * wx;
  if (Math.abs(det) < 1e-12) return null;
  const t = ((c.x - a.x) * wz - (c.z - a.z) * wx) / det, u = ((c.x - a.x) * vz - (c.z - a.z) * vx) / det;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? Math.max(0, Math.min(1, t)) : null;
}
export function pointIn(p: Point, poly: readonly Point[], boundary = true): boolean {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!, b = poly[i]!;
    if (segmentDistance(p, segment(a, b)) < EPS) return boundary;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) on = !on;
  }
  return on;
}
export const edges = (poly: readonly Point[]) => poly.map((p, i) => segment(p, poly[(i + 1) % poly.length]!));
export const area = (poly: readonly Point[]) => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length]!;
  return s + p.x * q.z - q.x * p.z;
}, 0)) / 2;
export function overlap(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.some(p => pointIn(p, b, false)) || b.some(p => pointIn(p, a, false))) return true;
  for (const w of edges(a)) for (const v of edges(b)) {
    const t = intersection(...ends(w), ...ends(v));
    if (t !== null && t > EPS && t < 1 - EPS) {
      const p = lerp(...ends(w), t);
      if (pointIn(lerp(p, ends(w)[0], 1e-5), b, false) || pointIn(lerp(p, ends(w)[1], 1e-5), b, false)) return true;
    }
  }
  return pointIn(centroid(a), b, false) && pointIn(centroid(b), a, false);
}
export const centroid = (p: readonly Point[]): Point => ({ x: p.reduce((s, v) => s + v.x, 0) / p.length, z: p.reduce((s, v) => s + v.z, 0) / p.length });
export const bounds = (poly: readonly Point[]) => ({ x1: Math.min(...poly.map(p => p.x)), z1: Math.min(...poly.map(p => p.z)), x2: Math.max(...poly.map(p => p.x)), z2: Math.max(...poly.map(p => p.z)) });
/** Split at every boundary crossing; midpoint classification handles holes and concavities. */
export function segmentInside(a: Point, b: Point, contains: (p: Point) => boolean, boundaries: readonly Wall[]): boolean {
  const cuts = [0, 1];
  for (const w of boundaries) {
    const t = intersection(a, b, ...ends(w));
    if (t !== null) cuts.push(t);
  }
  cuts.sort((x, y) => x - y);
  return contains(a) && contains(b) && cuts.slice(1).every((t, i) => t - cuts[i]! < EPS || contains(lerp(a, b, (t + cuts[i]!) / 2)));
}
export function simple(poly: readonly Point[]): boolean {
  if (poly.length < 3 || area(poly) < EPS) return false;
  const e = edges(poly);
  for (let i = 0; i < e.length; i++)for (let j = i + 1; j < e.length; j++) {
    if (j === i + 1 || i === 0 && j === e.length - 1) continue;
    if (intersection(...ends(e[i]!), ...ends(e[j]!)) !== null) return false;
  }
  return true;
}
/** Exact distance from a circle centre to the wall's oriented rectangular solid. */
export function wallDistance(p: Point, w: Wall): number {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1, l = Math.hypot(dx, dz), h = (w.thickness ?? .06) / 2;
  if (!l) return Math.hypot(Math.max(0, Math.abs(p.x - w.x1) - h), Math.max(0, Math.abs(p.z - w.z1) - h));
  const u = ((p.x - w.x1) * dx + (p.z - w.z1) * dz) / l, v = (-(p.x - w.x1) * dz + (p.z - w.z1) * dx) / l;
  return Math.hypot(Math.max(0, -h - u, u - l - h), Math.max(0, Math.abs(v) - h));
}
export function rayWall(start: Point, angle: number, w: Wall, limit: number): number {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1, l = Math.hypot(dx, dz), ux = l ? dx / l : 1, uz = l ? dz / l : 0, h = (w.thickness ?? .06) / 2;
  let lo = 0, hi = limit;
  const px = start.x - w.x1, pz = start.z - w.z1, rx = Math.cos(angle), rz = Math.sin(angle);
  for (const [p, d, min, max] of [[px * ux + pz * uz, rx * ux + rz * uz, -h, l + h], [-px * uz + pz * ux, -rx * uz + rz * ux, -h, h]]) {
    if (Math.abs(d!) < 1e-12) {
      if (p! < min! || p! > max!) return limit;
    } else {
      const a = (min! - p!) / d!, b = (max! - p!) / d!;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      if (lo > hi) return limit;
    }
  }
  return hi > EPS ? Math.max(0, lo) : limit;
}
/** Minimum distance between a movement segment and an oriented wall solid. */
export function movementClearance(a: Point, b: Point, w: Wall): number {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1, l = Math.hypot(dx, dz), ux = l ? dx / l : 1, uz = l ? dz / l : 0, h = (w.thickness ?? .06) / 2, transform = (p: Point) => ({ x: (p.x - w.x1) * ux + (p.z - w.z1) * uz, z: -(p.x - w.x1) * uz + (p.z - w.z1) * ux }), p = transform(a), q = transform(b), poly = [{ x: -h, z: -h }, { x: l + h, z: -h }, { x: l + h, z: h }, { x: -h, z: h }];
  if (pointIn(p, poly) || pointIn(q, poly)) return 0;
  let best = Infinity;
  for (const side of edges(poly)) {
    if (intersection(p, q, ...ends(side)) !== null) return 0;
    best = Math.min(best, segmentDistance(p, side), segmentDistance(q, side), ...ends(side).map(v => segmentDistance(v, segment(p, q))));
  }
  return best;
}
