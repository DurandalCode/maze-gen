import type { Point } from '../../domain';
import { fail } from '../../domain/validate';
import { cross } from '../predicates';
import type { Polygon } from '../kernel/contour';
type Point3 = Point & { y: number };
/** Project the exact oriented 3D box; braces need the width's horizontal component too. */
export function beamEnvelope(
  a: Point3,
  b: Point3,
  width: number,
  thickness: number,
  normal: Point3,
): { footprint: Polygon; bottomM: number; topM: number; normal: Point3 } {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (length < 1e-9) fail('DEGENERATE', 'beam', 'Zero-length beam');
  const axis = { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length },
    dot = axis.x * normal.x + axis.y * normal.y + axis.z * normal.z;
  const n = { x: normal.x - axis.x * dot, y: normal.y - axis.y * dot, z: normal.z - axis.z * dot },
    nl = Math.hypot(n.x, n.y, n.z);
  if (nl < 1e-9) fail('DEGENERATE', 'beam', 'Beam normal is parallel to its axis');
  n.x /= nl;
  n.y /= nl;
  n.z /= nl;
  const w = {
    x: axis.y * n.z - axis.z * n.y,
    y: axis.z * n.x - axis.x * n.z,
    z: axis.x * n.y - axis.y * n.x,
  };
  const corners: Point3[] = [];
  for (const p of [a, b])
    for (const sw of [-1, 1])
      for (const sn of [-1, 1])
        corners.push({
          x: p.x + (sw * w.x * width) / 2 + (sn * n.x * thickness) / 2,
          y: p.y + (sw * w.y * width) / 2 + (sn * n.y * thickness) / 2,
          z: p.z + (sw * w.z * width) / 2 + (sn * n.z * thickness) / 2,
        });
  const points = corners.map((p) => ({ x: p.x, z: p.z })).sort((a, b) => a.x - b.x || a.z - b.z),
    unique = points.filter(
      (p, i) => !i || Math.hypot(p.x - points[i - 1]!.x, p.z - points[i - 1]!.z) > 1e-12,
    );
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12
    )
      lower.pop();
    lower.push(p);
  }
  for (const p of [...unique].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12
    )
      upper.pop();
    upper.push(p);
  }
  return {
    footprint: [[...lower.slice(0, -1), ...upper.slice(0, -1)]],
    bottomM: Math.min(...corners.map((p) => p.y)),
    topM: Math.max(...corners.map((p) => p.y)),
    normal: n,
  };
}
