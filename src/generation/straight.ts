import { fail } from '../domain';
import type { Point } from '../domain';
import { distance } from '../geometry/predicates';
import type { NavigationSnapshot } from '../navigation/navmesh';
import { roomPath } from '../navigation/room-path';
interface Line {
  from: string;
  to: string;
  first: Point;
  last: Point;
  prefix: number;
  suffix: number;
  whole: boolean;
  length: number;
}
const sameDirection = (a: Point, b: Point) =>
  a.x * b.x + a.z * b.z >= Math.cos(Math.PI / 180) - 1e-10;
/** All physical portal transitions participate, including straight continuations at a branch. */
export function straightMetric(mesh: NavigationSnapshot): number {
  const lines: Line[] = [],
    ports = new Map<string, { id: string; point: Point }[]>();
  let maximum = 0;
  const port = (node: string, point: Point) => {
    const id = `${node}/${Math.round(point.x * 1e6)},${Math.round(point.z * 1e6)}`;
    const list = ports.get(node) ?? [];
    if (!list.some((p) => p.id === id)) ports.set(node, [...list, { id, point }]);
    return id;
  };
  const add = (from: string, to: string, path: Point[]) => {
    const segments = path.slice(1).flatMap((p, i) => {
      const a = path[i]!,
        length = distance(a, p);
      return length > 1e-8
        ? [{ length, direction: { x: (p.x - a.x) / length, z: (p.z - a.z) / length } }]
        : [];
    });
    if (!segments.length) return;
    let run = 0,
      prefix = 0,
      whole = true,
      total = 0;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      total += segment.length;
      if (i && !sameDirection(segments[i - 1]!.direction, segment.direction)) {
        whole = false;
        run = 0;
      }
      run += segment.length;
      if (whole) prefix = run;
      maximum = Math.max(maximum, run);
    }
    lines.push({
      from,
      to,
      first: segments[0]!.direction,
      last: segments.at(-1)!.direction,
      prefix,
      suffix: run,
      whole,
      length: total,
    });
  };
  for (const edge of mesh.semantic.edges) {
    const from = port(edge.from, edge.path[0]!),
      to = port(edge.to, edge.path.at(-1)!);
    add(from, to, edge.path);
    add(to, from, [...edge.path].reverse());
  }
  port(mesh.semantic.entranceNode, mesh.entrance);
  port(mesh.semantic.exitNode, mesh.exit);
  for (const node of mesh.semantic.nodes) {
    const list = ports.get(node.id) ?? [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!,
          b = list[j]!,
          path = roomPath(mesh, node.region, a.point, b.point);
        add(a.id, b.id, path);
        add(b.id, a.id, [...path].reverse());
      }
  }
  const incoming = new Map<string, number[]>();
  lines.forEach((line, i) => incoming.set(line.to, [...(incoming.get(line.to) ?? []), i]));
  const visiting = new Set<number>(),
    cache = new Map<number, number>();
  const arrival = (id: number): number => {
    const saved = cache.get(id);
    if (saved !== undefined) return saved;
    if (visiting.has(id))
      fail('STRAIGHT_LOOP', 'generation', 'Замкнутый физический ход не имеет поворота больше 1°');
    visiting.add(id);
    const line = lines[id]!;
    let best = 0;
    for (const previous of incoming.get(line.from) ?? [])
      if (sameDirection(lines[previous]!.last, line.first))
        best = Math.max(best, arrival(previous));
    maximum = Math.max(maximum, best + line.prefix);
    const result = line.whole ? best + line.length : line.suffix;
    visiting.delete(id);
    cache.set(id, result);
    return result;
  };
  for (let i = 0; i < lines.length; i++) arrival(i);
  return maximum;
}
