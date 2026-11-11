import {physicalRaycaster} from './physical-ray';
import {siteGeometry} from '../free/layout';
import {segmentDistance} from '../free/geometry';
import {spatialVisibleCells} from '../core/spatial-visibility';
import {openingMidpoint} from '../core/corridor-navigation';
import {pointLocator} from './navigation';
import { type Maze, type Point } from '../core/maze';
import { domainOf } from '../core/domain';
import type { NavigationContext } from './navigation';
import { CORRIDOR_SIGHT_METRES } from './corridor-view';
export interface SightRay {
  length: number;
  endCell: number;
  point: Point;
  blocked: boolean;
  firstCell: number | null;
  angle: number;
}
export interface OpeningView extends SightRay {
  depth: number;
  aperture: number;
}
/** Eye-level visibility inside the footprint. Fabric identifies a boundary but does not reveal its passages. */
export function spatialPerception(maze: Maze, context: NavigationContext) {
  const cast=maze.storeys?null:physicalRaycaster(maze),locate=pointLocator(maze);
  const trace = (from: number, angle: number, limit = CORRIDOR_SIGHT_METRES): SightRay => {
    const start = context.centers[from];
    if (!start || !Number.isFinite(angle) || !Number.isFinite(limit) || limit <= 0)
      throw new Error('Некорректный луч видимости.');
    if(maze.storeys){const ray=spatialVisibleCells(maze,from,angle,limit);return {...ray,blocked:ray.length<limit-1e-7,angle};}
    const length=cast!(start,angle,limit),point={x:start.x+Math.cos(angle)*length,z:start.z+Math.sin(angle)*length};
    let firstCell:number|null=null;for(let d=.05;d<length;d+=.1){const c=locate({x:start.x+Math.cos(angle)*d,z:start.z+Math.sin(angle)*d});if(c!==null&&c!==from){firstCell=c;break;}}
    const endCell=locate({x:start.x+Math.cos(angle)*Math.max(0,length-.01),z:start.z+Math.sin(angle)*Math.max(0,length-.01)})??from;
    return {length,endCell,point,blocked:length<limit-1e-7,firstCell,angle};
  };
  const cache = new Map<string, OpeningView>();
  const view = (from: number, to: number): OpeningView => {
    if (!maze.passages[from]?.includes(to))
      throw new Error('Обзор требует открытого соседнего прохода.');
    const key = from + ':' + to, previous = cache.get(key);
    if (previous)
      return previous;
    const a = context.centers[from]!, b = maze.navigation||(maze.version===5||maze.version===7)?openingMidpoint(maze,from,to):context.centers[to]!, heading = Math.atan2(b.z - a.z, b.x - a.x);
    let best = trace(from, heading);
    const depths: number[] = [best.length];
    // Angular sampling, not diagonal graph edges: only rays that first enter this opening count.
    for (let degrees = -60; degrees <= 60; degrees += 5) {
      if (degrees === 0)
        continue;
      const ray = trace(from, heading + degrees * Math.PI / 180);
      if (ray.firstCell === to)
        depths.push(ray.length);
      if (ray.firstCell === to && ray.length > best.length + .01)
        best = ray;
    }
    depths.sort((a, b) => a - b);
    const result = { ...best, depth: depths.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, depths.length), aperture: depths.length / 25 };
    cache.set(key, result);
    return result;
  };
  return { trace, view };
}
/** Known footprint only; no hidden maze walls or solution path are used. */
export function perimeterPerception(maze: Maze, context: NavigationContext) {
  const domain = domainOf(maze), distances = new Float64Array(maze.passages.length);
  const boundary=maze.free?siteGeometry(maze.parameters).boundaries.map(wall=>({wall})):maze.storeys?domainOf(maze.storeys.floors[0]).boundary:domain.boundary;
  let scale = 0;
  for (const cell of context.cells) {
    const p = context.centers[cell]!;
    let distance = Infinity;
    for (const { wall: w } of boundary) {
      distance = Math.min(distance,segmentDistance(p,w));
    }
    distances[cell] = distance;
    const r = domain.rectangles[cell]!;
    scale += Math.min(r.x2 - r.x1, r.z2 - r.z1);
  }
  scale /= context.cells.length;
  const attraction = (from: number, to: number) => {
    const a = context.centers[from]!, b = context.centers[to]!, step = Math.hypot(b.x - a.x, b.z - a.z);
    const near = Math.exp(-distances[to]! / (scale * 1.5));
    const change = (distances[from]! - distances[to]!) / step;
    const tangent = 1 - Math.min(1, Math.abs(change));
    // Prefer a promising arc along either edge of a U, rather than mandatory wall contact.
    return 3 * near + 1.5 * change + 1.5 * near * tangent;
  };
  return { distances, attraction };
}
