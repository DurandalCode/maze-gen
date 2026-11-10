import { cellCenter, portalPoint, walls, type Maze } from '../core/maze';
import { domainOf } from '../core/domain';
import { moduleFootprints, timberStructure } from '../core/structure';
import { mazePortals } from '../core/portals';
import { emptyLayout, type FreeDraft, type Anchor } from './model';
import { modulePolygon, rooms } from './layout';
import { distance, edges, pointIn, segmentDistance } from './geometry';
import { corridorNavigation } from '../core/corridor-navigation';
import { mazeDraft } from './json';
/** Preserve physical panels and openings; conversion never regenerates a legacy map. */
export function convertToFree(maze: Maze): FreeDraft {
  if (maze.version === 5) return mazeDraft(maze);
  if (maze.version === 6) throw Error('Свободная копия доступна для одноэтажных модульных карт.');
  if (maze.parameters.moduleSize === undefined) throw Error('Свободная копия доступна для модульных карт.');
  const l = emptyLayout(), d = domainOf(maze), footprints = moduleFootprints(maze);
  l.modules = footprints.map((m, i) => {
    const w = m.width ?? m.size, h = m.depth ?? m.size;
    return { id: `m-${i}`, type: w === 2 && h === 2 ? '2x2' : w === 6 && h === 2 || w === 2 && h === 6 ? '2x6' : 'custom', x: m.x + w / 2, z: m.z + h / 2, angle: w === 2 && h === 6 ? 90 : 0, width: w, depth: h };
  });
  const owner = new Map<number, string>(), semantic = maze.version === 4 ? corridorNavigation(maze).navigation : null;
  for (const c of d.cells) {
    const p = cellCenter(maze, c), m = l.modules.find(m => pointIn(p, modulePolygon(m), false));
    if (m) owner.set(c, m.id); else {
      const region = semantic?.originalToRegion[c] ?? c, r = semantic?.domain.rectangles[region] ?? d.rectangles[c]!, id = `s-${region}`;
      if (!l.spaces.some(s => s.id === id)) l.spaces.push({ id, kind: 'corridor', polygon: [{ x: r.x1, z: r.z1 }, { x: r.x2, z: r.z1 }, { x: r.x2, z: r.z2 }, { x: r.x1, z: r.z2 }] });
      owner.set(c, id);
    }
  }
  const rs = rooms(l), anchor = (id: string, p: { x: number; z: number }): Anchor => {
    const r = rs.find(r => r.id === id)!, sides = edges(r.polygon);
    let edge = 0;
    for (let i = 1; i < sides.length; i++)if (segmentDistance(p, sides[i]!) < segmentDistance(p, sides[edge]!)) edge = i;
    const a = r.polygon[edge]!, b = r.polygon[(edge + 1) % r.polygon.length]!, length = distance(a, b), offset = ((p.x - (a.x + b.x) / 2) * (b.x - a.x) + (p.z - (a.z + b.z) / 2) * (b.z - a.z)) / length;
    return { room: id, edge, offset };
  };
  const links = new Map<string, { a: string; b: string; vertical: boolean; fixed: number; lo: number; hi: number }[]>();
  for (const a of d.cells) for (const b of maze.passages[a]!) if (b > a && owner.get(a) !== owner.get(b)) {
    const r = d.rectangles[a]!, s = d.rectangles[b]!, vertical = Math.abs(r.x2 - s.x1) < 1e-6 || Math.abs(s.x2 - r.x1) < 1e-6, fixed = vertical ? Math.max(r.x1, s.x1) : Math.max(r.z1, s.z1), lo = vertical ? Math.max(r.z1, s.z1) : Math.max(r.x1, s.x1), hi = vertical ? Math.min(r.z2, s.z2) : Math.min(r.x2, s.x2), ai = owner.get(a)!, bi = owner.get(b)!, key = [ai, bi].sort().join(':') + ':' + vertical + ':' + fixed;
    if (!links.has(key)) links.set(key, []);
    links.get(key)!.push({ a: ai, b: bi, vertical, fixed, lo, hi });
  }
  let index = 0;
  for (const values of links.values()) {
    values.sort((a, b) => a.lo - b.lo);
    const merged: typeof values = [];
    for (const v of values) {
      const last = merged.at(-1);
      if (last && v.lo <= last.hi + 1e-6) last.hi = Math.max(last.hi, v.hi); else merged.push({ ...v });
    }
    for (const v of merged) {
      const p = v.vertical ? { x: v.fixed, z: (v.lo + v.hi) / 2 } : { x: (v.lo + v.hi) / 2, z: v.fixed };
      l.connections.push({ id: `c-${index++}`, a: anchor(v.a, p), b: anchor(v.b, p), width: Math.min(3, v.hi - v.lo) });
    }
  }
  const portals = mazePortals(maze);
  l.openings = portals.map((o, i) => {
    const r = d.rectangles[o.cell]!, width = o.width ?? (o.side === 'north' || o.side === 'south' ? r.x2 - r.x1 : r.z2 - r.z1);
    return { id: `o-${i}`, ...anchor(owner.get(o.cell)!, portalPoint(maze, o)), width };
  });
  l.entrance = `o-${portals.indexOf(maze.entrance) >= 0 ? portals.indexOf(maze.entrance) : portals.findIndex(p => p.cell === maze.entrance.cell && p.side === maze.entrance.side)}`;
  l.exit = `o-${portals.findIndex(p => p.cell === maze.exit.cell && p.side === maze.exit.side)}`;
  l.preservedPanels = walls(maze).map(w => ({ ...w }));
  l.supports = timberStructure(maze).posts;
  const p = maze.parameters;
  let shape = p.shape;
  if (shape && maze.version !== 4) {
    const rectangles = d.cells.map(c => {
      const r = d.rectangles[c]!;
      return { x: r.x1, z: r.z1, width: r.x2 - r.x1, height: r.z2 - r.z1, operation: 'add' as const };
    });
    shape = { kind: 'grid-rectangles', rectangles };
  }
  return { kind: 'maze-lab-free-draft', version: 1, ...(maze.environment ? { environment: structuredClone(maze.environment) } : {}), parameters: { ...p, placementMode: 'free', corridorWidth: Math.min(3, Math.max(1, p.corridorWidth)), columns: maze.width, rows: maze.depth, ...(shape ? { shape } : {}) }, construction: { wallHeight: maze.wallHeight, wallColor: maze.wallColor, translucentFabric: maze.translucentFabric, roof: maze.roof }, layout: l };
}
