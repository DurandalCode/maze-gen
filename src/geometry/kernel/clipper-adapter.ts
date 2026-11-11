import {
  Clipper64,
  ClipperOffset,
  PolyTree64,
  PolyPath64,
  ClipType,
  FillRule,
  JoinType,
  EndType,
} from 'clipper2-ts';
import type { Paths64 } from 'clipper2-ts';
export type ClipRing = [number, number][];
export type ClipPolygon = ClipRing[];
export type ClipMulti = ClipPolygon[];
export type ClipOperation = 'union' | 'intersection' | 'difference';
export const INTEGER_SCALE = 10_000_000;
// ClipperOffset's cleanup otherwise discards the internal boolean success flag.
const guarded = Symbol.for('maze.clipper2.throw-on-failure');
if (!Reflect.get(Clipper64.prototype, guarded)) {
  const execute = Clipper64.prototype.execute;
  Clipper64.prototype.execute = function (this: Clipper64, ...args: unknown[]) {
    const ok = Reflect.apply(execute, this, args) as boolean;
    if (!ok) throw new Error('Clipper2 operation failed');
    return ok;
  } as typeof execute;
  Reflect.set(Clipper64.prototype, guarded, true);
}
function coordinates(inputs: ClipMulti[]) {
  let minX = Infinity,
    minZ = Infinity;
  for (const polygons of inputs)
    for (const polygon of polygons)
      for (const ring of polygon)
        for (const [x, z] of ring) {
          minX = Math.min(minX, x);
          minZ = Math.min(minZ, z);
        }
  const originX = Math.floor(minX),
    originZ = Math.floor(minZ);
  const paths = (polygons: ClipMulti): Paths64 =>
    polygons.flatMap((p) =>
      p.map((r) =>
        r.slice(0, -1).map(([x, z]) => ({
          x: Math.round((x - originX) * INTEGER_SCALE),
          y: Math.round((z - originZ) * INTEGER_SCALE),
        })),
      ),
    );
  const decode = (output: PolyTree64): ClipMulti => {
    const polygons: ClipMulti = [];
    const ring = (node: PolyPath64): ClipRing => {
      const points = (node.polygon ?? []).map(
        (p) => [p.x / INTEGER_SCALE + originX, p.y / INTEGER_SCALE + originZ] as [number, number],
      );
      return points.length ? [...points, points[0]!] : [];
    };
    const visit = (node: PolyPath64) => {
      if (!node.isHole && (node.polygon ?? []).length)
        polygons.push([
          ring(node),
          ...Array.from({ length: node.count }, (_, i) => node.child(i))
            .filter((n) => n.isHole)
            .map(ring),
        ]);
      Array.from({ length: node.count }, (_, i) => node.child(i)).forEach(visit);
    };
    Array.from({ length: output.count }, (_, i) => output.child(i)).forEach(visit);
    return polygons;
  };
  return { paths, decode };
}
export function integerClip(
  operation: ClipOperation,
  subject: ClipMulti,
  rest: ClipMulti[],
): ClipMulti {
  if (operation === 'intersection' && rest.length > 1) {
    let result = subject;
    for (const operand of rest) {
      result = integerClip('intersection', result, [operand]);
      if (!result.length) break;
    }
    return result;
  }
  if (operation === 'union' && rest.length >= 16) {
    let level = [subject, ...rest].filter((p) => p.length);
    const center = (p: ClipMulti) => {
      let x = 0,
        z = 0,
        n = 0;
      for (const polygon of p)
        for (const ring of polygon)
          for (const point of ring) {
            x += point[0];
            z += point[1];
            n++;
          }
      return { x: x / n, z: z / n };
    };
    level = level
      .map((p, i) => ({ p, c: center(p), i }))
      .sort(
        (a, b) =>
          Math.floor(a.c.x / 2) - Math.floor(b.c.x / 2) ||
          Math.floor(a.c.z / 2) - Math.floor(b.c.z / 2) ||
          a.c.x - b.c.x ||
          a.c.z - b.c.z ||
          a.i - b.i,
      )
      .map((v) => v.p);
    while (level.length > 1) {
      const next: ClipMulti[] = [];
      for (let i = 0; i < level.length; i += 8) {
        const group = level.slice(i, i + 8);
        next.push(integerClip('union', group[0]!, group.slice(1)));
      }
      level = next;
    }
    return level[0] ?? [];
  }
  const conversion = coordinates([subject, ...rest]),
    clipper = new Clipper64();
  if (operation === 'union') {
    for (const operand of [subject, ...rest])
      if (operand.length) clipper.addSubject(conversion.paths(operand));
  } else {
    clipper.addSubject(conversion.paths(subject));
    for (const operand of rest) if (operand.length) clipper.addClip(conversion.paths(operand));
  }
  const output = new PolyTree64(),
    kind =
      operation === 'union'
        ? ClipType.Union
        : operation === 'intersection'
          ? ClipType.Intersection
          : ClipType.Difference;
  if (!clipper.execute(kind, FillRule.NonZero, output))
    throw new Error('Integer clipping did not complete');
  return conversion.decode(output);
}
export function integerOffset(
  subject: ClipMulti,
  deltaM: number,
  arcToleranceM: number,
): ClipMulti {
  if (!subject.length) return [];
  const conversion = coordinates([subject]),
    offset = new ClipperOffset(2, arcToleranceM * INTEGER_SCALE),
    output = new PolyTree64();
  offset.addPaths(conversion.paths(subject), JoinType.Round, EndType.Polygon);
  offset.execute(deltaM * INTEGER_SCALE, output);
  return conversion.decode(output);
}
