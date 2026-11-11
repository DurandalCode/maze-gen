import {detectFreeIslands,type FreeIsland} from './islands';
import {freeSpatialRay} from './spatial-visibility';
import {bridgeGeometry,bridgeColumns,bridgeIssues,bridgeSurface,bridgeSamples} from './bridges';
import { validateParameters, validateConstruction } from '../core/maze';
import type { Maze, Parameters, Point, Wall } from '../core/maze';
import type { Domain } from '../core/domain';
import type { Anchor, FreeDraft, FreeIssue, FreeLayout, FreeModule } from './model';
import { area, bounds, centroid, closest, cross, distance, edges, ends, EPS, intersection, lerp, overlap, pointIn, quantize, rayWall, segment, segmentDistance, segmentInside, simple, wallDistance, movementClearance } from './geometry';
export const size = (m: FreeModule): [number, number] => m.type === 'custom' ? [m.width!, m.depth!] : m.type === '2x6' ? [6, 2] : [2, 2];
export function modulePolygon(m: FreeModule): Point[] {
  const [w, d] = size(m), a = m.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => ({ x: m.x + x! * c - z! * s, z: m.z + x! * s + z! * c }));
}
export function rooms(layout: FreeLayout): { id: string; polygon: Point[]; holes: Point[][] }[] {
  return [...layout.modules.map(m => ({ id: m.id, polygon: modulePolygon(m), holes: [] })), ...layout.spaces.map(s => ({ ...s, holes: s.holes ?? [] }))];
}
export function anchorGeometry(l: FreeLayout, a: Anchor, width: number) {
  const r = rooms(l).find(r => r.id === a.room);
  if (!r || !Number.isInteger(a.edge) || a.edge < 0 || a.edge >= r.polygon.length) throw Error('Проём ссылается на отсутствующую сторону.');
  const p = r.polygon[a.edge]!, q = r.polygon[(a.edge + 1) % r.polygon.length]!, length = distance(p, q);
  if (!Number.isFinite(a.offset) || width < 1 - EPS || width > 3 + EPS || Math.abs(a.offset) + width / 2 > length / 2 + EPS) throw Error('Проём должен иметь ширину 1–3 м и помещаться на стороне.');
  const mid = lerp(p, q, .5 + a.offset / length), from = lerp(p, q, .5 + (a.offset - width / 2) / length), to = lerp(p, q, .5 + (a.offset + width / 2) / length), normal = { x: (q.z - p.z) / length, z: -(q.x - p.x) / length };
  return { mid, from, to, normal, wall: segment(from, to), room: r };
}
export function connectionGeometry(l: FreeLayout, c: FreeLayout['connections'][number]) {
  const a = anchorGeometry(l, c.a, c.width), b = anchorGeometry(l, c.b, c.width), polygon = [a.from, a.to, b.from, b.to];
  return { a, b, polygon, sides: [segment(a.to, b.from), segment(b.to, a.from)] };
}
export function siteGeometry(p: Parameters) {
  const rectangles = p.shape?.rectangles ?? [{ x: 0, z: 0, width: p.columns, height: p.rows, operation: 'add' as const }], polys = rectangles.map(r => [{ x: r.x, z: r.z }, { x: r.x + r.width, z: r.z }, { x: r.x + r.width, z: r.z + r.height }, { x: r.x, z: r.z + r.height }]);
  return { holes: polys.filter((_, i) => rectangles[i]!.operation === 'subtract'), boundaries: polys.flatMap(edges), contains: (v: Point) => v.x >= -EPS && v.z >= -EPS && v.x <= p.columns + EPS && v.z <= p.rows + EPS && rectangles.some((r, i) => r.operation === 'add' && pointIn(v, polys[i]!)) && !rectangles.some((r, i) => r.operation === 'subtract' && pointIn(v, polys[i]!, false)) };
}
function cutWall(w: Wall, cuts: Wall[]): Wall[] {
  const [a, b] = ends(w), length = distance(a, b);
  if (length < EPS) return [];
  const intervals: [number, number][] = [];
  for (const cut of cuts) {
    const [p, q] = ends(cut);
    if (Math.abs(cross(a, b, p)) > EPS * length || Math.abs(cross(a, b, q)) > EPS * length) continue;
    const t = (v: Point) => ((v.x - a.x) * (b.x - a.x) + (v.z - a.z) * (b.z - a.z)) / (length * length);
    const lo = Math.max(0, Math.min(t(p), t(q))), hi = Math.min(1, Math.max(t(p), t(q)));
    if (hi > lo) intervals.push([lo, hi]);
  }
  intervals.sort((x, y) => x[0] - y[0]);
  let at = 0;
  const out: Wall[] = [];
  for (const [lo, hi] of intervals) {
    if (hi <= at) continue;
    if (lo > at + EPS) out.push(segment(lerp(a, b, at), lerp(a, b, lo)));
    at = Math.max(at, hi);
  }
  if (at < 1 - EPS) out.push(segment(lerp(a, b, at), b));
  return out;
}
export function physical(l: FreeLayout) {
  const rs = rooms(l), polygons = rs.map(r => r.polygon), holes = rs.flatMap(r => r.holes), cuts: Wall[] = [], connections: { id: string; polygon: Point[]; sides: Wall[] }[] = [],bridges:ReturnType<typeof bridgeGeometry>[]=[];
  for (const c of l.connections) {
    try {
      const g = connectionGeometry(l, c);
      cuts.push(g.a.wall, g.b.wall);
      connections.push({ id: c.id, polygon: g.polygon, sides: g.sides });
      polygons.push(g.polygon);
    } catch {
      /* Invalid draft anchors are reported by validateFree. */
    }
  }
  for(const bridge of l.bridges??[])try{const g=bridgeGeometry(l,bridge);bridges.push(g);cuts.push(g.a.wall,g.b.wall);}catch{/* Invalid bridge remains editable. */}
  for (const o of l.openings) try {
    cuts.push(anchorGeometry(l, o, o.width).wall);
  } catch {
    /* Invalid drafts can still be drawn. */
  }
  const panels = l.preservedPanels ? [...l.preservedPanels] : [...rs.flatMap(r => [...edges(r.polygon).flatMap(w => cutWall(w, cuts)), ...r.holes.flatMap(edges)]), ...connections.flatMap(c => c.sides)];
  panels.push(...l.walls);
  const postMap = new Map<string, Point>(), add = (p: Point) => postMap.set(`${quantize(p.x)}:${quantize(p.z)}`, p);
  l.supports?.forEach(add);
  bridgeColumns(l).forEach(add);
  l.modules.forEach(m => modulePolygon(m).forEach(add));
  panels.forEach(w => ends(w).forEach(add));
  if (!l.preservedPanels) cuts.forEach(w => ends(w).forEach(add));
  for (let i = 0; i < panels.length; i++)for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i]!, b = panels[j]!, t = intersection(...ends(a), ...ends(b));
    if (t !== null) add(lerp(...ends(a), t));
  }
  const posts = [...postMap.values()], contains = (p: Point) => polygons.some(poly => pointIn(p, poly)) && !holes.some(h => pointIn(p, h, false)), boundaries = [...polygons.flatMap(edges), ...holes.flatMap(edges)], obstacles = [...panels, ...posts.map(p => ({ ...segment(p, p), thickness: .12 }))];
  return { rooms: rs, polygons, holes, panels, posts, obstacles, boundaries, contains, connections,bridges };
}
export function validateFree(d: FreeDraft, ready = true): FreeIssue[] {
  const l = d.layout, out: FreeIssue[] = [], issue = (code: string, message: string, ...ids: string[]) => out.push({ code, message, ids }), site = siteGeometry(d.parameters), rs = rooms(l);
  try {
    validateParameters(d.parameters);
    validateConstruction(d.construction);
  } catch (e) {
    return [{ code: 'parameters', message: (e as Error).message, ids: [] }];
  }
  const zoneIds=new Set((l.zones??[]).map(z=>z.id));
  if(zoneIds.size!==(l.zones??[]).length||(l.zones??[]).some(z=>!z.id||!['branching','braided','winding'].includes(z.style)))issue('zone','Некорректные зоны.');
  for(const room of [...l.modules,...l.spaces])if(room.zone!==undefined&&!zoneIds.has(room.zone))issue('zone','Неизвестная зона пространства.',room.id);
  if (!l.modules.length) issue('empty', 'Добавьте хотя бы один модуль.');
  const ids = new Set<string>();
  for (const v of [...l.modules, ...l.spaces, ...l.connections, ...l.openings, ...l.walls, ...l.bridges??[]]) {
    if (!v.id || ids.has(v.id)) issue('id', 'Идентификаторы должны быть уникальными.', v.id);
    ids.add(v.id);
  }
  for (const m of l.modules) {
    if (![m.x, m.z, m.angle, ...size(m)].every(Number.isFinite) || size(m).some(v => v < .8 || v > 10)) issue('module', 'Некорректные размеры или положение модуля.', m.id);
  }
  for (const r of rs) {
    if (!simple(r.polygon) || r.holes.some(h => !simple(h) || h.some(p => !pointIn(p, r.polygon)))) issue('polygon', 'Некорректный полигон пространства.', r.id);
    if (!r.polygon.every(p => site.contains(p)) || !edges(r.polygon).every(w => segmentInside(...ends(w), site.contains, site.boundaries)) || site.holes.some(h => pointIn(centroid(h), r.polygon, false) && !r.holes.some(v => pointIn(centroid(h), v)))) issue('outside', 'Пространство выходит за площадку или перекрывает отверстие.', r.id);
  }
  for (let i = 0; i < rs.length; i++)for (let j = i + 1; j < rs.length; j++)if (overlap(rs[i]!.polygon, rs[j]!.polygon)) issue('overlap', 'Пространства пересекаются.', rs[i]!.id, rs[j]!.id);
  if(l.bridges?.length)for(const error of bridgeIssues(l,d.construction.wallHeight,site,[...rs.map(r=>r.polygon),...physical(l).connections.map(c=>c.polygon)]))issue('bridge',error.message,error.id);
  const used: { anchor: Anchor; width: number; id: string }[] = [];
  for (const c of l.connections) try {
    if (c.a.room === c.b.room) throw Error('Связь должна соединять разные пространства.');
    const g = connectionGeometry(l, c);
    used.push({ anchor: c.a, width: c.width, id: c.id }, { anchor: c.b, width: c.width, id: c.id });
    const spans = g.sides.map(w => distance(...ends(w)));
    if (Math.max(...spans) > 3 + EPS) issue('span', 'Свободный пролёт превышает 3 м.', c.id);
    if ((!simple(g.polygon) || area(g.polygon) < .01) && distance(g.a.mid, g.b.mid) > EPS) issue('connection', 'Соединение вырождено или перекручено.', c.id);
    const v = { x: g.b.mid.x - g.a.mid.x, z: g.b.mid.z - g.a.mid.z };
    if (distance(g.a.mid, g.b.mid) > EPS && (v.x * g.a.normal.x + v.z * g.a.normal.z <= EPS || -v.x * g.b.normal.x - v.z * g.b.normal.z <= EPS)) issue('direction', 'Проёмы должны быть обращены в сторону соединения.', c.id);
    if (!edges(g.polygon).every(w => segmentInside(...ends(w), site.contains, site.boundaries))) issue('outside', 'Связь выходит за площадку.', c.id);
    for (const r of rs) if (overlap(g.polygon, r.polygon)) issue('overlap', 'Связь пересекает пространство.', c.id, r.id);
    for (const other of l.connections) {
      if (other.id >= c.id) continue;
      try {
        if (overlap(g.polygon, connectionGeometry(l, other).polygon)) issue('overlap', 'Соединения пересекаются.', c.id, other.id);
      } catch {
        /* already reported */
      }
    }
    const widths = [segmentDistance(g.a.from, g.sides[0]!), segmentDistance(g.a.to, g.sides[1]!), segmentDistance(g.b.from, g.sides[1]!), segmentDistance(g.b.to, g.sides[0]!)];
    if (distance(g.a.mid, g.b.mid) > EPS && Math.min(...widths) < 1 - EPS) issue('width', 'Соединение сужается меньше 1 м.', c.id);
  } catch (e) {
    issue('anchor', String((e as Error).message), c.id);
  }
  for(const bridge of l.bridges??[])try{bridgeGeometry(l,bridge);used.push({anchor:bridge.a,width:bridge.width,id:bridge.id},{anchor:bridge.b,width:bridge.width,id:bridge.id});}catch(e){issue('bridge',(e as Error).message,bridge.id);}
  for (const o of l.openings) try {
    anchorGeometry(l, o, o.width);
    used.push({ anchor: o, width: o.width, id: o.id });
  } catch (e) {
    issue('opening', (e as Error).message, o.id);
  }
  for (let i = 0; i < used.length; i++)for (let j = i + 1; j < used.length; j++) {
    const a = used[i]!, b = used[j]!;
    if (a.anchor.room === b.anchor.room && a.anchor.edge === b.anchor.edge && Math.abs(a.anchor.offset - b.anchor.offset) < (a.width + b.width) / 2 - EPS) issue('opening-overlap', 'Проёмы пересекаются.', a.id, b.id);
  }
  const phys = physical(l);
  for (const w of phys.panels) {
    const [a, b] = ends(w), len = distance(a, b);
    if (![a.x, a.z, b.x, b.z].every(Number.isFinite) || len < EPS) {
      issue('wall', 'Некорректная стена.');
      continue;
    }
    const cuts = phys.posts.filter(p => segmentDistance(p, w) < EPS).map(p => distance(a, closest(p, a, b))).sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = lerp(a, b, cuts[i - 1]! / len), hi = lerp(a, b, cuts[i]! / len);
      if (distance(lo, hi) <= 3 + EPS) continue;
      const carried = l.modules.some(m => edges(modulePolygon(m)).some(e => segmentDistance(lo, e) < EPS && segmentDistance(hi, e) < EPS));
      if (!carried) issue('span', 'Неподдержанная стена длиннее 3 м.');
    }
    if (!segmentInside(a, b, site.contains, site.boundaries)) issue('outside', 'Стена выходит за площадку.');
    if (l.walls.includes(w as FreeLayout['walls'][number]) && !segmentInside(a, b, phys.contains, phys.boundaries)) issue('outside', 'Стена выходит за доступную область.', (w as FreeLayout['walls'][number]).id);
  }
  if (ready) {
    if (!l.openings.some(o => o.id === l.entrance) || !l.openings.some(o => o.id === l.exit) || l.entrance === l.exit) issue('portals', 'Выберите разные вход и выход.');
    const seen = new Set<string>(), queue = rs.length ? [rs[0]!.id] : [];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      seen.add(id);
      for (const c of [...l.connections,...l.bridges??[]]) {
        const n = c.a.room === id ? c.b.room : c.b.room === id ? c.a.room : null;
        if (n && !queue.includes(n)) queue.push(n);
      }
    }
    if (seen.size !== rs.length) issue('disconnected', 'Все пространства должны быть соединены.');
    if (!out.length) {
      const nav = buildNavigation(l);
      if (nav.paths.some(p => p === null)) issue('clearance', 'Нет прохода с учётом радиуса игрока, стен и стоек.');
      for(const bridge of l.bridges??[]){
        const columns=bridgeColumns(l),solids=[...nav.panels.map(w=>({...w,y:w.y??0,height:w.height??d.construction.wallHeight})),...nav.posts.map(p=>({...segment(p,p),thickness:.12,y:0,height:columns.some(c=>distance(c,p)<EPS)?Math.max(...l.bridges!.map(b=>b.rise))+d.construction.wallHeight:d.construction.wallHeight}))];
        if(bridgeSamples(l,bridge,.05).some(p=>solids.some(w=>p.y!+1.7>w.y&&p.y!+.05<w.y+w.height&&wallDistance(p,w)<.25-EPS)))issue('clearance','Мост перекрыт стеной или стойкой.',bridge.id);
      }
    }
  }
  return out;
}
/** Visibility graph inside each physical room, using wall-end clearance candidates. */
function localRoute(a: Point, b: Point, poly: Point[], holes: Point[][], obstacles: Wall[]): Point[] | null {
  const contains = (p: Point) => pointIn(p, poly) && !holes.some(h => pointIn(p, h, false)), boundary = [...edges(poly), ...holes.flatMap(edges)], clear = (p: Point) => contains(p) && obstacles.every(w => wallDistance(p, w) >= .25 - EPS), visible = (p: Point, q: Point) => {
    if (!segmentInside(p, q, contains, boundary)) return false;
    return obstacles.every(w => movementClearance(p, q, w) >= .25 - EPS);
  };
  if (!clear(a) || !clear(b)) return null;
  if (visible(a, b)) return [a, b];
  const nodes = [a, b];
  for (const w of obstacles) for (const p of ends(w)) if (pointIn(p, poly)) for (let i = 0; i < 16; i++) {
    const v = { x: p.x + Math.cos(i * Math.PI / 8) * .4, z: p.z + Math.sin(i * Math.PI / 8) * .4 };
    if (clear(v)) nodes.push(v);
  }
  const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = new Set<number>();
  dist[0] = 0;
  for (let i = 0; i < nodes.length; i++) {
    let at = -1;
    for (let j = 0; j < nodes.length; j++)if (!done.has(j) && (at < 0 || dist[j]! < dist[at]!)) at = j;
    if (at < 0 || !Number.isFinite(dist[at]!)) return null;
    if (at === 1) {
      const path = [1];
      while (path.at(-1)! !== 0) path.push(prev[path.at(-1)!]!);
      return path.reverse().map(j => nodes[j]!);
    }
    done.add(at);
    for (let j = 0; j < nodes.length; j++)if (!done.has(j) && dist[at]! + distance(nodes[at]!, nodes[j]!) < dist[j]! && visible(nodes[at]!, nodes[j]!)) {
      dist[j] = dist[at]! + distance(nodes[at]!, nodes[j]!);
      prev[j] = at;
    }
  }
  return null;
}
/** Keep legacy centres whenever safe; concave rooms and halls with holes need
 * an interior anchor rather than the average of their boundary vertices. */
function navigationCenter(room: ReturnType<typeof rooms>[number], obstacles: Wall[]): Point {
  const center = centroid(room.polygon), clear = (p: Point) => pointIn(p, room.polygon)
    && !room.holes.some(h => pointIn(p, h))
    && obstacles.every(w => wallDistance(p, w) >= .25 - EPS);
  if (clear(center)) return center;
  const candidates: Point[] = [];
  for (const w of [...edges(room.polygon), ...room.holes.flatMap(edges)]) {
    const [a, b] = ends(w), length = distance(a, b);
    if (length < EPS) continue;
    const mid = lerp(a, b, .5);
    for (const offset of [.35, -.35, .5, -.5]) candidates.push({
      x: mid.x - (b.z - a.z) / length * offset,
      z: mid.z + (b.x - a.x) / length * offset,
    });
  }
  // Additional interior candidates handle short, crowded edges without an
  // unbounded search on large imported halls.
  const box = bounds(room.polygon);
  for (let x = 1; x < 16; x++) for (let z = 1; z < 16; z++) candidates.push({
    x: box.x1 + (box.x2 - box.x1) * x / 16,
    z: box.z1 + (box.z2 - box.z1) * z / 16,
  });
  candidates.sort((a, b) => distance(a, center) - distance(b, center));
  // No safe anchor means navigation remains invalid and validation reports it.
  return candidates.find(clear) ?? center;
}
export function buildNavigation(l: FreeLayout) {
  const phys = physical(l), rs = phys.rooms, centers = rs.map(r => navigationCenter(r, phys.obstacles)), passages = rs.map(() => [] as number[]), paths: (Point[] | null)[] = [], edgePaths = new Map<string, Point[]>();
  for (const c of l.connections) try {
    const g = connectionGeometry(l, c), a = rs.findIndex(r => r.id === c.a.room), b = rs.findIndex(r => r.id === c.b.room), inward = (p: typeof g.a) => ({ x: p.mid.x - p.normal.x * .35, z: p.mid.z - p.normal.z * .35 }), pa = inward(g.a), pb = inward(g.b), ra = localRoute(centers[a]!, pa, rs[a]!.polygon, rs[a]!.holes, phys.obstacles), rb = localRoute(pb, centers[b]!, rs[b]!.polygon, rs[b]!.holes, phys.obstacles);
    let route = ra && rb ? [...ra, g.a.mid, g.b.mid, ...rb] : null;
    if (route) {
      const length = distance(pa, pb), steps = Math.max(1, Math.ceil(length / .025));
      for (let i = 0; i <= steps; i++)if (phys.obstacles.some(w => wallDistance(lerp(pa, pb, i / steps), w) < .25 - EPS)) {
        route = null;
        break;
      }
    }
    paths.push(route);
    if (route) {
      passages[a]!.push(b);
      passages[b]!.push(a);
      edgePaths.set(`${a}:${b}`, route);
      edgePaths.set(`${b}:${a}`, [...route].reverse());
    }
  } catch {
    paths.push(null);
  }
  for(const bridge of l.bridges??[])try{
    const g=bridgeGeometry(l,bridge),a=rs.findIndex(r=>r.id===bridge.a.room),b=rs.findIndex(r=>r.id===bridge.b.room);
    const pa={x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35},pb={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35};
    const ra=localRoute(centers[a]!,pa,rs[a]!.polygon,rs[a]!.holes,phys.obstacles),rb=localRoute(pb,centers[b]!,rs[b]!.polygon,rs[b]!.holes,phys.obstacles);
    const route=ra&&rb?[...ra,...g.path,...rb]:null;
    paths.push(route);if(route){passages[a]!.push(b);passages[b]!.push(a);edgePaths.set(`${a}:${b}`,route);edgePaths.set(`${b}:${a}`,[...route].reverse());}
  }catch{paths.push(null);}
  const portalPaths = new Map<string, Point[]>();
  for (const o of l.openings) try {
    const g = anchorGeometry(l, o, o.width), i = rs.findIndex(r => r.id === o.room), a = { x: g.mid.x - g.normal.x * .35, z: g.mid.z - g.normal.z * .35 }, approach = localRoute(centers[i]!, a, rs[i]!.polygon, rs[i]!.holes, phys.obstacles), route = approach && phys.obstacles.every(w => movementClearance(a, g.mid, w) >= .25 - EPS) ? approach : null;
    paths.push(route);
    if (route) portalPaths.set(o.id, [...route, g.mid]);
  } catch {
    paths.push(null);
  }
  // A hand-drawn partition must not leave a second inaccessible chamber in a room.
  if (l.walls.length) for (let i = 0; i < rs.length; i++) {
    const room = rs[i]!, samples: Point[] = [];
    for (const w of l.walls) {
      const [a, b] = ends(w), len = distance(a, b);
      if (len < EPS) continue;
      const mid = lerp(a, b, .5), normal = { x: -(b.z - a.z) / len * .36, z: (b.x - a.x) / len * .36 };
      samples.push({ x: mid.x + normal.x, z: mid.z + normal.z }, { x: mid.x - normal.x, z: mid.z - normal.z });
    }
    for (const sample of samples) if (pointIn(sample, room.polygon) && !room.holes.some(h => pointIn(sample, h)) && phys.obstacles.every(w => wallDistance(sample, w) >= .25 - EPS)) paths.push(localRoute(centers[i]!, sample, room.polygon, room.holes, phys.obstacles));
  }
  return { ...phys, centers, passages, paths, edgePaths, portalPaths };
}
const runtimeCache = new WeakMap<FreeLayout, ReturnType<typeof buildNavigation>>();
const domainCache = new WeakMap<FreeLayout,Domain>();
const portalCache = new WeakMap<FreeLayout,Map<string,ReturnType<typeof anchorGeometry>>>();
const referenceRoutes=new WeakMap<Maze,Map<string,{regions:number[];points:Point[]}>>();
export function freeRuntime(maze: Maze) {
  const l = maze.free!;
  let r = runtimeCache.get(l);
  if (!r) {
    r = buildNavigation(l);
    runtimeCache.set(l, r);
  }
  return r;
}
export function freeDomain(maze: Maze): Domain {
  const cached=domainCache.get(maze.free!);if(cached)return cached;
  const r = freeRuntime(maze), cells = r.rooms.map((_, i) => i);
  const result:Domain={
    active: new Uint8Array(cells.length).fill(1), cells, modules: new Uint8Array(maze.free!.modules.length).fill(1), rectangles: r.rooms.map(s => bounds(s.polygon)), boundary: maze.free!.openings.map(o=>({wall:anchorGeometry(maze.free!,o,o.width).wall,portal:{freeId:o.id,cell:r.rooms.findIndex(s=>s.id===o.room),side:'north' as const,width:o.width}})), area: (maze.free!.bridges??[]).reduce((sum,b)=>{const g=bridgeGeometry(maze.free!,b);return sum+b.width*(2*Math.hypot(b.stairRun,b.rise)+g.length-2*b.stairRun);},0)+r.rooms.reduce((n, s) => n + area(s.polygon) - s.holes.reduce((n, h) => n + area(h), 0), 0) + r.connections.reduce((n, c) => n + area(c.polygon), 0), contains: p => p.bridge!==undefined ? (()=>{const surface=bridgeSurface(maze.free!,p);return !!surface&&Math.abs((p.y??0)-surface.y!)<1e-5;})() : (p.y??0)===0&&r.contains(p), constrain(from, to) {
      if (segmentInside(from, to, r.contains, r.boundaries)) return { ...to };
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (segmentInside(from, lerp(from, to, mid), r.contains, r.boundaries)) lo = mid; else hi = mid;
      }
      return lerp(from, to, lo);
    }
  };
  domainCache.set(maze.free!,result);return result;
}
export function freeRay(maze: Maze, start: Point, angle: number, limit = 24) {
  const r = freeRuntime(maze), end = { x: start.x + Math.cos(angle) * limit, z: start.z + Math.sin(angle) * limit };
  let best = maze.free!.bridges?.length?freeSpatialRay(maze,{...start,y:(start.y??0)+1.7},{x:Math.cos(angle),z:Math.sin(angle)},limit).length:r.obstacles.reduce((n, w) => Math.min(n, rayWall(start, angle, w, n)), limit);
  for (const wall of r.boundaries) {
    const t = intersection(start, end, ...ends(wall));
    if (t !== null && t > EPS && t * limit < best) {
      const after = lerp(start, end, Math.min(1, t + .00001));
      if (!r.contains(after)&&!r.bridges.some(g=>g.contains(after))) best = t * limit;
    }
  }
  return best;
}
export function freePortal(maze: Maze, id: string) {
  let cache=portalCache.get(maze.free!);if(!cache){cache=new Map();portalCache.set(maze.free!,cache);}
  const cached=cache.get(id);if(cached)return cached;
  const o = maze.free!.openings.find(o => o.id === id);
  if (!o) throw Error('Проём не найден.');
  const result=anchorGeometry(maze.free!, o, o.width);cache.set(id,result);return result;
}
export function freeRoute(maze: Maze, from = maze.entrance.cell, to = maze.exit.cell) {
  let routes=referenceRoutes.get(maze);if(!routes){routes=new Map();referenceRoutes.set(maze,routes);}const key=`${from}:${to}`,cached=routes.get(key);if(cached)return cached;
  const r = freeRuntime(maze), l = maze.free!;
  // Old saved maps can contain blocked openings. Never draw a route through them.
  if (from === maze.entrance.cell && !r.portalPaths.has(l.entrance) || to === maze.exit.cell && !r.portalPaths.has(l.exit)) return { regions: [] as number[], points: [] as Point[] };
  const nodes: { point: Point; room: number }[] = [], adjacent = new Map<number, { to: number; path: Point[]; cost: number }[]>(), add = (p: Point, room: number) => {
    nodes.push({ point: p, room });
    return nodes.length - 1;
  }, cost = (p: Point[]) => p.slice(1).reduce((n, v, i) => n + Math.hypot(v.x-p[i]!.x,v.z-p[i]!.z,(v.y??0)-(p[i]!.y??0)), 0), link = (a: number, b: number, path: Point[]) => {
    if (!adjacent.has(a)) adjacent.set(a, []);
    if (!adjacent.has(b)) adjacent.set(b, []);
    adjacent.get(a)!.push({ to: b, path, cost: cost(path) });
    adjacent.get(b)!.push({ to: a, path: [...path].reverse(), cost: cost(path) });
  };
  const endpoint = (id: string, fallback: number) => {
    if (id) {
      const p = freePortal(maze, id), point = { x: p.mid.x - p.normal.x * .35, z: p.mid.z - p.normal.z * .35 };
      return { index: add(point, r.rooms.findIndex(v => v.id === p.room.id)), boundary: p.mid };
    }
    return { index: add(r.centers[fallback]!, fallback), boundary: null };
  }, start = endpoint(from === maze.entrance.cell ? l.entrance : '', from), goal = endpoint(to === maze.exit.cell ? l.exit : '', to);
  for (const c of l.connections) {
    try {
      const g = connectionGeometry(l, c), a = r.rooms.findIndex(v => v.id === c.a.room), b = r.rooms.findIndex(v => v.id === c.b.room), pa = { x: g.a.mid.x - g.a.normal.x * .35, z: g.a.mid.z - g.a.normal.z * .35 }, pb = { x: g.b.mid.x - g.b.normal.x * .35, z: g.b.mid.z - g.b.normal.z * .35 };
      if (!r.edgePaths.has(`${a}:${b}`)) continue;
      link(add(pa, a), add(pb, b), [pa, g.a.mid, g.b.mid, pb]);
    } catch {
      /* Invalid drafts have no route. */
    }
  }
  for(const bridge of l.bridges??[])try{
    const g=bridgeGeometry(l,bridge),a=r.rooms.findIndex(v=>v.id===bridge.a.room),b=r.rooms.findIndex(v=>v.id===bridge.b.room);
    if(!r.edgePaths.has(`${a}:${b}`))continue;
    const pa={x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35},pb={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35};
    link(add(pa,a),add(pb,b),[pa,...g.path,pb]);
  }catch{/* Invalid drafts have no bridge route. */}
  for (let i = 0; i < nodes.length; i++)for (let j = i + 1; j < nodes.length; j++)if (nodes[i]!.room === nodes[j]!.room) {
    const room = r.rooms[nodes[i]!.room]!, path = localRoute(nodes[i]!.point, nodes[j]!.point, room.polygon, room.holes, r.obstacles);
    if (path) link(i, j, path);
  }
  const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), paths = new Map<number, Point[]>(), done = new Set<number>();
  dist[start.index] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let a = -1;
    for (let i = 0; i < nodes.length; i++)if (!done.has(i) && (a < 0 || dist[i]! < dist[a]!)) a = i;
    if (a < 0 || !Number.isFinite(dist[a]!)) break;
    if (a === goal.index) break;
    done.add(a);
    for (const e of adjacent.get(a) ?? []) {
      const v = dist[a]! + e.cost;
      if (v < dist[e.to]!) {
        dist[e.to] = v;
        prev[e.to] = a;
        paths.set(e.to, e.path);
      }
    }
  }
  if (!Number.isFinite(dist[goal.index]!)) return { regions: [] as number[], points: [] as Point[] };
  const indices = [goal.index];
  while (indices.at(-1) !== start.index) indices.push(prev[indices.at(-1)!]!);
  indices.reverse();
  const points: Point[] = start.boundary ? [start.boundary, nodes[start.index]!.point] : [nodes[start.index]!.point];
  for (const n of indices.slice(1)) points.push(...paths.get(n)!);
  if (goal.boundary) points.push(goal.boundary);
  const regions = indices.map(i => nodes[i]!.room).filter((v, i, a) => i === 0 || v !== a[i - 1]);
  const result={regions,points};routes.set(key,result);return result;
}
export function freeMaze(d: FreeDraft, check = true): Maze {
  if (check) {
    const issues = validateFree(d);
    if (issues.length) throw Error(issues.map(i => i.message).join(' '));
  }
  const layout = structuredClone(d.layout), rs = rooms(layout), nav = buildNavigation(layout), portal = (id: string) => {
    const o = layout.openings.find(o => o.id === id);
    return { cell: o ? rs.findIndex(r => r.id === o.room) : 0, side: 'north' as const, width: o?.width, freeId: id };
  };
  runtimeCache.set(layout,nav);
  return { version: layout.bridges?.length?7:5, free: layout, parameters: structuredClone(d.parameters), width: d.parameters.columns, depth: d.parameters.rows, passages: nav.passages, entrance: portal(layout.entrance), exit: portal(layout.exit), portals: layout.openings.map(o => portal(o.id)), ...d.construction, ...(d.environment ? { environment: structuredClone(d.environment) } : {}) };
}


export function freeIslands(layout:FreeLayout):FreeIsland[]{const p=physical(layout);return detectFreeIslands(p.panels,p.contains);}

/** Physical paths for a specified graph walk, including bends and bridge height. */
export function freeGraphPath(maze:Maze,regions:readonly number[]):Point[]{
 const r=freeRuntime(maze);if(!regions.length)return [];const points:Point[]=[r.centers[regions[0]!]!];
 for(let i=1;i<regions.length;i++){const path=r.edgePaths.get(`${regions[i-1]}:${regions[i]}`);if(!path)throw Error('Несвязный маршрут свободной планировки.');points.push(...path.slice(1));}return points;
}
