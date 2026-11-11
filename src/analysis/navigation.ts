import {bridgeSurface,bridgeGeometry} from '../free/bridges';
import {outlineDistances} from '../free/analysis-geometry';
import {spatialCellAt,spatialDistance,spatialEdgeLength,storeyView} from '../core/two-storey';
import {freeRuntime,connectionGeometry} from '../free/layout';
import {pointIn} from '../free/geometry';
import { domainOf } from '../core/domain';
import { axisBounds, cellCenter, neighbors, portalPoint, routingSize, type Maze, type Point } from '../core/maze';
export type NavigationProfile = 'explorer' | 'compass' | 'outline';
export const PROFILE_NAMES: Record<NavigationProfile, string> = {
  explorer: 'Без предпочтения направления', compass: 'Знает направление на выход', outline: 'Знает направление и контур',
};
export interface NavigationContext {
  edgeLengths?:Map<string,number>;
  cells: number[];
  adjacent: number[][];
  centers: Point[];
  goal: Point;
  outlineTargets?: Point[];
  outlineDistances?: Float64Array;
}
export function prepareNavigation(maze: Maze): NavigationContext {
  const cells = domainOf(maze).cells;
  const adjacent: number[][] = [], centers: Point[] = [];
  for (const cell of cells) {
    adjacent[cell] = neighbors(maze, cell);
    centers[cell] = cellCenter(maze, cell);
  }
  const edgeLengths=maze.storeys||maze.free?new Map<string,number>():undefined;if(edgeLengths)for(const a of cells)for(const b of adjacent[a]!)edgeLengths.set(a+':'+b,maze.free?freeRuntime(maze).edgePaths.get(`${a}:${b}`)!.slice(1).reduce((sum,p,i)=>{const q=freeRuntime(maze).edgePaths.get(`${a}:${b}`)![i]!;return sum+Math.hypot(p.x-q.x,p.z-q.z,(p.y??0)-(q.y??0));},0):spatialEdgeLength(maze,a,b));
  return { cells, adjacent, centers,edgeLengths, goal: portalPoint(maze, maze.exit) };
}
/** Footprint-only distances and visible waypoints: no internal maze passages are consulted. */
export function prepareOutline(maze: Maze, context: NavigationContext): void {
  if(maze.storeys){if(context.outlineTargets)return;const lower=storeyView(maze,0),known=prepareNavigation(lower);prepareOutline(lower,known);context.outlineTargets=[];context.outlineDistances=new Float64Array(maze.passages.length);for(const c of context.cells){const n=maze.storeys.nodes[c]!,p=n.center;context.outlineTargets[c]=n.local===undefined?context.goal:known.outlineTargets![n.local]??context.goal;context.outlineDistances[c]=n.local===undefined?Math.hypot(p.x-context.goal.x,p.z-context.goal.z):known.outlineDistances![n.local]!;}return;}
  if((maze.version===5||maze.version===7)){context.outlineTargets=context.centers.map(()=>context.goal);context.outlineDistances=Float64Array.from(outlineDistances(maze,context.centers));return;}
  if(maze.navigation){if(context.outlineTargets)return;const original=prepareNavigation(maze.navigation.source);prepareOutline(maze.navigation.source,original);context.outlineDistances=Float64Array.from(maze.navigation.representatives,c=>original.outlineDistances![c]!);context.outlineTargets=maze.navigation.representatives.map(c=>original.outlineTargets![c]!);return;}
  if(maze.layout?.spaces){
    if(context.outlineTargets)return;
    // The player knows the site outline, not the generated network or islands.
    const plot:Maze={...maze,layout:{modules:maze.layout.modules}},known=prepareNavigation(plot);prepareOutline(plot,known);
    context.outlineTargets=[];context.outlineDistances=new Float64Array(maze.passages.length).fill(Infinity);
    for(const c of context.cells){const cell=cellAtPoint(plot,context.centers[c]!);if(cell!==null){context.outlineTargets[c]=known.outlineTargets![cell]!;context.outlineDistances[c]=known.outlineDistances![cell]!;}}
    return;
  }
  if (context.outlineTargets)
    return;
  const size = maze.passages.length, distances = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1), targets: Point[] = [];
  const heap: {
    cell: number;
    distance: number;
  }[] = [];
  const push = (cell: number, distance: number) => {
    let i = heap.length;
    heap.push({ cell, distance });
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.distance <= distance)
        break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = { cell, distance };
  };
  const pop = () => {
    const first = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && heap[child + 1]!.distance < heap[child]!.distance)
          child++;
        if (heap[child]!.distance >= last.distance)
          break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  const xs = axisBounds(maze, 'x'), zs = axisBounds(maze, 'z'), domain = domainOf(maze);
  const visible = (a: Point, b: Point) => {
    const cuts = [0, 1], dx = b.x - a.x, dz = b.z - a.z;
    if (dx)
      for (const x of xs) {
        const t = (x - a.x) / dx;
        if (t > 0 && t < 1)
          cuts.push(t);
      }
    if (dz)
      for (const z of zs) {
        const t = (z - a.z) / dz;
        if (t > 0 && t < 1)
          cuts.push(t);
      }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const t = (cuts[i - 1]! + cuts[i]!) / 2;
      if (!domain.contains({ x: a.x + dx * t, z: a.z + dz * t }))
        return false;
    }
    return true;
  };
  distances[maze.exit.cell] = 0;
  targets[maze.exit.cell] = context.goal;
  push(maze.exit.cell, 0);
  while (heap.length) {
    const current = pop();
    if (current.distance !== distances[current.cell])
      continue;
    const a = current.cell, point = context.centers[a]!;
    if (parent[a] !== -1) {
      const next = parent[a]!, target = targets[next]!;
      targets[a] = visible(point, context.goal) ? context.goal : visible(point, target) ? target : context.centers[next]!;
    }
    for (const b of context.adjacent[a]!) {
      const q = context.centers[b]!, distance = current.distance + Math.hypot(q.x - point.x, q.z - point.z);
      if (distance < distances[b]!) {
        distances[b] = distance;
        parent[b] = a;
        push(b, distance);
      }
    }
  }
  // Disconnected footprint components cannot reach this exit even without internal walls.
  for (const a of context.cells)
    targets[a] ??= context.goal;
  context.outlineTargets = targets;
  context.outlineDistances = distances;
}
export function directionScore(context: NavigationContext, from: number, to: number, profile: NavigationProfile): number {
  if (profile === 'explorer')
    return 0;
  const a = context.centers[from]!, b = context.centers[to]!;
  const goal = profile === 'outline' ? context.outlineTargets![from]! : context.goal;
  const dx = b.x - a.x, dz = b.z - a.z, gx = goal.x - a.x, gz = goal.z - a.z;
  const norm = Math.hypot(dx, dz) * Math.hypot(gx, gz);
  return norm ? (dx * gx + dz * gz) / norm : 0;
}
export function edgeLength(context: NavigationContext, a: number, b: number): number {
  const physical=context.edgeLengths?.get(`${a}:${b}`);if(physical!==undefined)return physical;
  const p = context.centers[a]!, q = context.centers[b]!;
  return spatialDistance(p,q);
}
export function cellAtPoint(maze: Maze, point: Point): number | null {
  if(maze.storeys)return spatialCellAt(maze,point);
  if((maze.version===5||maze.version===7)){const r=freeRuntime(maze);if(point.bridge!==undefined){const surface=bridgeSurface(maze.free!,point);if(!surface)return null;const bridge=maze.free!.bridges!.find(b=>b.id===point.bridge)!,g=bridgeGeometry(maze.free!,bridge);return r.rooms.findIndex(r=>r.id===(g.progress(point)<.5?bridge.a.room:bridge.b.room));}const extra=r.rooms.findIndex((s,i)=>i>=r.analysisStart&&pointIn(point,s.polygon));if(extra>=0)return extra;const i=r.rooms.findIndex(s=>pointIn(point,s.polygon)&&!s.holes.some(h=>pointIn(point,h,false)));if(i>=0)return i;const c=maze.free!.connections.find(c=>{try{return pointIn(point,connectionGeometry(maze.free!,c).polygon);}catch{return false;}});return c?r.rooms.findIndex(s=>s.id===c.a.room):null;}
  if(maze.navigation){const c=cellAtPoint(maze.navigation.source,point);return c===null?null:maze.navigation.originalToRegion[c]!;}
  const xs = axisBounds(maze, 'x'), zs = axisBounds(maze, 'z');
  const x = xs.findIndex((v, i) => i > 0 && point.x < v) - 1;
  const z = zs.findIndex((v, i) => i > 0 && point.z < v) - 1;
  if (x < 0 || z < 0 || point.x < 0 || point.z < 0)
    return null;
  const cell = z * routingSize(maze).columns + x;
  return domainOf(maze).active[cell] ? cell : null;
}
