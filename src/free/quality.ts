import { freeAreaWeights, outlineDistances } from './analysis-geometry';
import { sideDistricts } from '../analysis/side-districts';
import { shortestPath } from '../core/pathfinding';
import type { Maze, Point } from '../core/maze';
import { freeRuntime, freeRay } from './layout';
import { distance } from './geometry';
import { random } from '../core/random';
import { routeTraps } from '../analysis/route-traps';
import { loopTraps } from '../analysis/loop-traps';
import { routePoints, pathLength } from '../core/pathfinding';
import { effectiveLimits } from '../core/design-limits';
import type {AnalysisOptions,ColdspotAnalysis} from '../analysis/coldspots';
import {LearnedGraph} from '../analysis/learned-graph';
/** Present completed free-space searches in the common heat-map interface. */
export function freeHeatDisplay(maze:Maze,options:AnalysisOptions):ColdspotAnalysis {
  const result=analyzeFree(maze,options.samples,options.profile),weights=freeAreaWeights(maze),seen=new Set<number>(),regions:{cells:number[];area:number}[]=[];
  for(let cell=0;cell<maze.passages.length;cell++){
    if(seen.has(cell)||result.probability[cell]!>=options.threshold)continue;
    const cells=[cell];seen.add(cell);
    for(const c of cells)for(const n of maze.passages[c]!)if(!seen.has(n)&&result.probability[n]!<options.threshold){seen.add(n);cells.push(n);}
    regions.push({cells,area:cells.reduce((sum,c)=>sum+weights[c]!,0)});
  }
  if(result.finishedRatio<1)throw Error('Не все симуляции дошли до выхода. Тепловой прогноз не показан.');
  const coldArea=regions.reduce((sum,r)=>sum+r.area,0),area=weights.reduce((a,b)=>a+b,0);
  return {completionRatio:result.finishedRatio,options:{...options},probability:result.probability,visits:result.visits,regions,coldArea,coldAreaRatio:area?coldArea/area:0,largestColdArea:Math.max(0,...regions.map(r=>r.area)),expectedLength:result.expectedLength,optimalLength:result.optimalLength,searchRatio:result.optimalLength?result.expectedLength/result.optimalLength:0,method:'sampled',samples:result.samples};
}
/** Policy sees only current neighbours, geometric heading and its visit history. */
export function analyzeFree(maze: Maze, samples = 256, profile: 'explorer' | 'compass' | 'outline' = 'explorer') {
  const r = freeRuntime(maze), outline = outlineDistances(maze, r.centers), rng = random(maze.parameters.seed + profile), visits = new Float64Array(r.rooms.length), probability = new Float64Array(r.rooms.length), goal = r.centers[maze.exit.cell]!, length = (p: Point[]) => p.slice(1).reduce((n, v, i) => n + distance(v, p[i]!), 0);
  const cells=r.rooms.map((_,i)=>i),edgeLengths=new Map<string,number>();
  for(const [key,points]of r.edgePaths)edgeLengths.set(key,length(points));
  const edge=(a:number,b:number)=>edgeLengths.get(`${a}:${b}`)!;
  const endpoints=length(r.portalPaths.get(maze.free!.entrance)!)+length(r.portalPaths.get(maze.free!.exit)!);
  let expectedLength = 0, finished = 0;
  for (let sample = 0; sample < samples; sample++) {
    const seen = new Set<number>(),learned=new LearnedGraph(r.rooms.length,cells,edge);
    let at=maze.entrance.cell,total=endpoints;
    const enter=(cell:number)=>{at=cell;visits[cell]!++;seen.add(cell);learned.observe(cell,r.passages[cell]!);};
    enter(at);
    // Each exploration enters a new room; each remembered return is a simple
    // path through observed rooms. This is a guard, not a random-walk budget.
    for(let step=0;step<r.rooms.length*(r.rooms.length+2);step++){
      if(at===maze.exit.cell){finished++;break;}
      const choices=learned.neighbors(at).filter(n=>!seen.has(n));
      if(choices.length){
        const a=r.centers[at]!,weights=choices.map(b=>{
          const p=r.centers[b]!,g=profile==='outline'?outline[at]!-outline[b]!:distance(a,goal)-distance(p,goal);
          return Math.exp(profile==='explorer'?0:Math.max(-2,Math.min(2,g)));
        });
        let pick=rng()*weights.reduce((a,b)=>a+b,0),index=0;
        for(;index<weights.length-1;index++){pick-=weights[index]!;if(pick<=0)break;}
        const next=choices[index]!;total+=edge(at,next);enter(next);continue;
      }
      // Find another remembered junction with a still-unexplored door. No hidden
      // adjacency is queried, and learned loops are available as return shortcuts.
      const known=learned.routesFrom(at);let target=-1,best=Infinity;
      for(const cell of seen)if(learned.neighbors(cell).some(n=>!seen.has(n))){const d=known.distanceTo(cell);if(d<best){best=d;target=cell;}}
      if(target<0)break;
      const back=known.routeTo(target);if(!back||back.cells.length<2)break;
      for(const next of back.cells.slice(1)){total+=edge(at,next);enter(next);}
    }
    for (const c of seen) probability[c]!++;
    expectedLength += total;
  }
  for (let i = 0; i < visits.length; i++) {
    visits[i]! /= samples;
    probability[i]! /= samples;
  }
  const areas = freeAreaWeights(maze), totalArea = areas.reduce((a, b) => a + b, 0), cold = areas.reduce((n, a, i) => n + (probability[i]! < .2 ? a : 0), 0), coldSeen = new Set<number>(), coldRegions: number[] = [];
  for (let i = 0; i < areas.length; i++) {
    if (coldSeen.has(i) || probability[i]! >= .2) continue;
    const q = [i];
    coldSeen.add(i);
    let a = 0;
    for (let j = 0; j < q.length; j++) {
      const c = q[j]!;
      a += areas[c]!;
      for (const n of r.passages[c]!) if (probability[n]! < .2 && !coldSeen.has(n)) {
        coldSeen.add(n);
        q.push(n);
      }
    }
    coldRegions.push(a);
  }
  return { probability, visits, expectedLength: expectedLength / samples, finishedRatio: finished / samples, coldAreaRatio: totalArea ? cold / totalArea : 0, largestColdArea: Math.max(0, ...coldRegions), optimalLength: pathLength(routePoints(maze)), samples, profile };
}
export function checkFreeQuality(maze: Maze): string[] {
  const errors: string[] = [], p = maze.parameters;
  if ((p.routeTrapCount ?? 0) > 0 && (p.routeTrapCount ?? 0) > routeTraps(maze).qualifiedCount) errors.push('Не выполнено требование маршрутных ловушек.');
  if ((p.loopTrapCount ?? 0) > 0 && (p.loopTrapCount ?? 0) > loopTraps(maze).qualifiedCount) errors.push('Не выполнено требование кольцевых ловушек.');
  if (!p.design) return errors;
  const r = freeRuntime(maze), limits = effectiveLimits(p);
  let sight = 0, straight = 0, run = 0;
  for (const c of r.centers) for (let deg = 0; deg < 360; deg++) {
    const angle = deg * Math.PI / 180;
    sight = Math.max(sight, freeRay(maze, c, angle, 101) + freeRay(maze, c, angle + Math.PI, 101));
  }
  for (let a = 0; a < r.rooms.length; a++)for (const b of r.passages[a]!) {
    let prev = a, at = b, length = pathLength(r.edgePaths.get(`${a}:${b}`)!), straightLength = length, straightRun = true;
    const visited = new Set([a]);
    while (r.passages[at]!.length === 2 && !visited.has(at)) {
      visited.add(at);
      const next = r.passages[at]!.find(v => v !== prev)!;
      const u = r.centers[prev]!, v = r.centers[at]!, w = r.centers[next]!, cos = ((v.x - u.x) * (w.x - v.x) + (v.z - u.z) * (w.z - v.z)) / (distance(u, v) * distance(v, w));
      const edge = pathLength(r.edgePaths.get(`${at}:${next}`)!);
      length += edge;
      if (cos < .999) straightRun = false;
      if (straightRun) straightLength += edge;
      prev = at;
      at = next;
    }
    run = Math.max(run, length);
    straight = Math.max(straight, straightLength);
  }
  if (sight > limits.maxVisibleStraight) errors.push('Превышен предел видимого прямого участка.');
  if (straight > limits.maxForcedStraight) errors.push('Превышен предел прямого прохода.');
  if (run > limits.maxForcedRun) errors.push('Превышен предел прохода без выбора.');
  const analyses = (['explorer', 'compass', 'outline'] as const).map(profile => analyzeFree(maze, 2048, profile));
  if (analyses.some(a => a.finishedRatio < 1)) errors.push('Не все симуляции поиска дошли до выхода.');
  if (analyses.some(a => a.coldAreaRatio > limits.maxColdRatio || a.largestColdArea > limits.maxColdRegion)) errors.push('Превышены ограничения холодных областей.');
  if (analyses.some(a => sideDistricts(maze, a.probability).largestProblemArea / metricsArea(maze) > limits.maxColdSideRatio)) errors.push('Превышен предел холодного бокового района.');
  const route = shortestPath(maze);
  let unavoidable = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!, seen = new Set([a]), queue = [a];
    for (let j = 0; j < queue.length; j++)for (const next of r.passages[queue[j]!]!) if (!(queue[j] === a && next === b || queue[j] === b && next === a) && !seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
    if (!seen.has(b)) unavoidable += pathLength(r.edgePaths.get(`${a}:${b}`)!);
  }
  const total = route.slice(1).reduce((n, b, i) => n + pathLength(r.edgePaths.get(`${route[i]}:${b}`)!), 0);
  if (total && unavoidable / total > limits.maxUnavoidableRouteRatio) errors.push('Превышена доля обязательного маршрута без обходов.');
  return errors;
}
const metricsArea = (maze: Maze) => freeAreaWeights(maze).reduce((a, b) => a + b, 0);
