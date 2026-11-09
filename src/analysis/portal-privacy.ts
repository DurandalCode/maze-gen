import { domainOf } from '../core/domain';
import { walls, WALL_THICKNESS, type Maze, type Point, type Portal, type Wall } from '../core/maze';
import { samePortal, mazePortals } from '../core/portals';
import { timberStructure, FRAME_POST_SIZE, supportColliders } from '../core/structure';
import { CollisionWorld } from '../simulation/collisions';
export interface PortalPrivacy {
  portal: Portal;
  certified: boolean;
  pocket: number[];
  gates: Wall[];
  blockers: Wall[];
  reason: string;
  witness?: {
    cell: number;
    from: Point;
    to: Point;
    distance: number;
  };
}
const key = (p: Point) => `${p.x.toFixed(7)}:${p.z.toFixed(7)}`;
function shortened(segment: Wall, posts: Set<string>): [
  Point,
  Point
] {
  const a = { x: segment.x1, z: segment.z1 }, b = { x: segment.x2, z: segment.z2 }, length = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
  const trimA = posts.has(key(a)) ? FRAME_POST_SIZE / 2 : 0, trimB = posts.has(key(b)) ? FRAME_POST_SIZE / 2 : 0;
  return [{ x: a.x + dx * trimA, z: a.z + dz * trimA }, { x: b.x - dx * trimB, z: b.z - dz * trimB }];
}
/** A single wall separating two aperture segments can certify ALL pairs of endpoints continuously. */
function separates(source: readonly Point[], gate: readonly Point[], wall: Wall): boolean {
  const vertical = Math.abs(wall.x1 - wall.x2) < 1e-9, axis = vertical ? 'x' : 'z', cross = vertical ? 'z' : 'x';
  const plane = vertical ? wall.x1 : wall.z1, h = (wall.thickness ?? WALL_THICKNESS) / 2;
  const opposite = (source.every(p => p[axis] < plane - 1e-8) && gate.every(p => p[axis] > plane + 1e-8)) || (source.every(p => p[axis] > plane + 1e-8) && gate.every(p => p[axis] < plane - 1e-8));
  if (!opposite)
    return false;
  const low = vertical ? Math.min(wall.z1, wall.z2) - h : Math.min(wall.x1, wall.x2) - h, high = vertical ? Math.max(wall.z1, wall.z2) + h : Math.max(wall.x1, wall.x2) + h;
  // Intersection coordinate on a separating plane is bounded by the four endpoint rays.
  return source.every(a => gate.every(b => { const t = (plane - a[axis]) / (b[axis] - a[axis]), at = a[cross] + t * (b[cross] - a[cross]); return at >= low + 1e-9 && at <= high - 1e-9; }));
}
function clearRay(a: Point, b: Point, obstacles: readonly Wall[]): boolean {
  for (const w of obstacles) {
    const h = (w.thickness ?? WALL_THICKNESS) / 2;
    let lo = 0, hi = 1;
    for (const axis of ['x', 'z'] as const) {
      const delta = b[axis] - a[axis], min = axis === 'x' ? Math.min(w.x1, w.x2) - h : Math.min(w.z1, w.z2) - h, max = axis === 'x' ? Math.max(w.x1, w.x2) + h : Math.max(w.z1, w.z2) + h;
      if (Math.abs(delta) < 1e-12) {
        if (a[axis] < min || a[axis] > max) {
          lo = 2;
          break;
        }
      }
      else {
        const u = (min - a[axis]) / delta, v = (max - a[axis]) / delta;
        lo = Math.max(lo, Math.min(u, v));
        hi = Math.min(hi, Math.max(u, v));
      }
    }
    if (lo <= hi && hi > 1e-8 && lo < 1 - 1e-8)
      return false;
  }
  return true;
}
/** Sound sufficient certificate, not a complete visibility solver. Uncertified candidates fail the design gate. */
export function portalPrivacy(maze: Maze, portal: Portal, maxPocketCells = 3, findWitness = true): PortalPrivacy {
  if (!Number.isInteger(maxPocketCells) || maxPocketCells < 1 || maxPocketCells > 12)
    throw new Error('Недопустимый размер кармана проёма.');
  const domain = domainOf(maze), boundary = domain.boundary.find(e => samePortal(e.portal, portal));
  if (!boundary)
    throw new Error('Проём должен находиться на границе.');
  const envelope = walls(maze), posts = new Set(timberStructure(maze).posts.map(key)), source = shortened(boundary.wall, posts), pocket = [portal.cell];
  while (pocket.length < maxPocketCells) {
    const next = maze.passages[pocket.at(-1)!]!.filter(n => !pocket.includes(n));
    if (next.length !== 1)
      break;
    pocket.push(next[0]!);
  }
  const inside = new Set(pocket), gates: Wall[] = [];
  for (const a of pocket)
    for (const b of maze.passages[a]!)
      if (!inside.has(b)) {
        const r = domain.rectangles[a]!, s = domain.rectangles[b]!;
        if (Math.abs(r.x2 - s.x1) < 1e-8 || Math.abs(s.x2 - r.x1) < 1e-8) {
          const x = Math.max(r.x1, s.x1);
          gates.push({ x1: x, z1: Math.max(r.z1, s.z1), x2: x, z2: Math.min(r.z2, s.z2) });
        }
        else {
          const z = Math.max(r.z1, s.z1);
          gates.push({ x1: Math.max(r.x1, s.x1), z1: z, x2: Math.min(r.x2, s.x2), z2: z });
        }
      }
  const plane = source[0]!, inward = domain.cells.every(c => { const r = domain.rectangles[c]!; switch (portal.side) {
    case 'south': return r.z2 <= plane.z + 1e-8;
    case 'north': return r.z1 >= plane.z - 1e-8;
    case 'west': return r.x1 >= plane.x - 1e-8;
    case 'east': return r.x2 <= plane.x + 1e-8;
  } });
  const otherOpening = mazePortals(maze).some(p => inside.has(p.cell) && !samePortal(p, portal));
  const blockers = gates.map(g => envelope.find(w => separates(source, shortened(g, posts), w))).filter((w): w is Wall => !!w);
  const unbranched=maze.passages[portal.cell]!.length===1&&pocket.every(c=>maze.passages[c]!.length<=2);
  const certified = unbranched && inward && !otherOpening && gates.length > 0 && blockers.length === gates.length;
  const result: PortalPrivacy = { portal: { ...portal }, certified, pocket, gates, blockers, reason: certified ? 'Полная ширина проёма экранирована от всех выходов из локального кармана.' : 'Скрытность не доказана; вариант не проходит обязательный фильтр.' };
  if (certified || !findWitness)
    return result;
  const obstacles = [...envelope, ...supportColliders(maze)], world = new CollisionWorld(obstacles);
  if (domain.cells.length * 45 * obstacles.length > 20000000)
    return result;
  const targets = [0, .25, .5, .75, 1].map(t => ({ x: source[0]!.x + t * (source[1]!.x - source[0]!.x), z: source[0]!.z + t * (source[1]!.z - source[0]!.z) }));
  for (const c of domain.cells) {
    if (inside.has(c))
      continue;
    const r = domain.rectangles[c]!;
    for (const x of [r.x1 + .251, (r.x1 + r.x2) / 2, r.x2 - .251])
      for (const z of [r.z1 + .251, (r.z1 + r.z2) / 2, r.z2 - .251]) {
        const point = { x, z };
        if (world.blocked(point))
          continue;
        const target = targets.find(t => clearRay(point, t, obstacles));
        if (target) {
          result.witness = { cell: c, from: point, to: target, distance: Math.hypot(point.x - target.x, point.z - target.z) };
          result.reason = 'Есть прямая видимость проёма из основной области, включая диагонали.';
          return result;
        }
      }
  }
  return result;
}
export function mazePortalPrivacy(maze: Maze, findWitness = true) {
  const entrance = portalPrivacy(maze, maze.entrance, 3, findWitness), exit = portalPrivacy(maze, maze.exit, 3, findWitness);
  return { certified: entrance.certified && exit.certified, entrance, exit };
}
