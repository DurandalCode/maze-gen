import {bridgeGeometry} from './bridges';
import {bridgeRouteErrors} from './bridge-route';
import {freeGroundLengths} from './path-limits';
import { freeAreaWeights, outlineDistances } from './analysis-geometry';
import { sideDistricts } from '../analysis/side-districts';
import { shortestPath } from '../core/pathfinding';
import type { Maze, Point } from '../core/maze';
import { freeRuntime, freeRay,freeIslands } from './layout';
import { distance,intersection } from './geometry';
import { random } from '../core/random';
import { routeTraps } from '../analysis/route-traps';
import { loopTraps } from '../analysis/loop-traps';
import { routePoints, pathLength } from '../core/pathfinding';
import { effectiveLimits } from '../core/design-limits';
import type {AnalysisOptions,ColdspotAnalysis} from '../analysis/coldspots';
import {LearnedGraph} from '../analysis/learned-graph';
/** Present completed free-space searches in the common heat-map interface. */
export function freeHeatDisplay(maze:Maze,options:AnalysisOptions):ColdspotAnalysis {
  const result=analyzeFree(maze,options.samples,options.profile),weights=freeAreaWeights(maze),regions=freeColdRegions(maze,result.probability,result.bridgeUsage.map(b=>b.overProbability),options.threshold);
  if(result.finishedRatio<1)throw Error('Не все симуляции дошли до выхода. Тепловой прогноз не показан.');
  const coldArea=regions.reduce((sum,r)=>sum+r.area,0),area=weights.reduce((a,b)=>a+b,0);
  return {bridgeUsage:result.bridgeUsage,completionRatio:result.finishedRatio,options:{...options},probability:result.probability,visits:result.visits,regions,coldArea,coldAreaRatio:area?coldArea/area:0,largestColdArea:Math.max(0,...regions.map(r=>r.area)),expectedLength:result.expectedLength,optimalLength:result.optimalLength,searchRatio:result.optimalLength?result.expectedLength/result.optimalLength:0,method:'sampled',samples:result.samples};
}
export interface FreeBridgeUsage {id:string;overProbability:number;underProbability:number;overVisits:number;underVisits:number}
/** Use a separate area node for the upper surface. Visiting its end rooms via
 * the ground detour must never count as having explored the bridge itself. */
export function freeColdRegions(maze:Maze,probability:ArrayLike<number>,bridgeProbability:number[],threshold:number){
 const r=freeRuntime(maze),n=r.rooms.length,weights=freeAreaWeights(maze,false),probs=Array.from(probability),adjacent=r.passages.map(p=>[...p]);
 for(const [i,b]of (maze.free!.bridges??[]).entries()){
  const g=bridgeGeometry(maze.free!,b),a=r.rooms.findIndex(r=>r.id===b.a.room),z=r.rooms.findIndex(r=>r.id===b.b.room),node=n+i;
  adjacent[a]=adjacent[a]!.filter(v=>v!==z);adjacent[z]=adjacent[z]!.filter(v=>v!==a);adjacent[a]!.push(node);adjacent[z]!.push(node);adjacent.push([a,z]);
  weights.push(b.width*(2*Math.hypot(b.stairRun,b.rise)+g.length-2*b.stairRun));probs.push(bridgeProbability[i]??0);
 }
 const seen=new Set<number>(),regions:{cells:number[];bridgeIds:string[];area:number}[]=[];
 for(let i=0;i<weights.length;i++)if(!seen.has(i)&&probs[i]!<threshold){const queue=[i];seen.add(i);for(const c of queue)for(const z of adjacent[c]!)if(!seen.has(z)&&probs[z]!<threshold){seen.add(z);queue.push(z);}regions.push({cells:queue.filter(c=>c<n),bridgeIds:queue.filter(c=>c>=n).map(c=>maze.free!.bridges![c-n]!.id),area:queue.reduce((sum,c)=>sum+weights[c]!,0)});}
 return regions;
}
/** Policy sees only current neighbours, geometric heading and its visit history. */
export function analyzeFree(maze: Maze, samples = 256, profile: 'explorer' | 'compass' | 'outline' = 'explorer') {
  const r = freeRuntime(maze), outline = outlineDistances(maze, r.centers), rng = random(maze.parameters.seed + profile), visits = new Float64Array(r.rooms.length), probability = new Float64Array(r.rooms.length), goal = r.centers[maze.exit.cell]!, length = (p: Point[]) => p.slice(1).reduce((n, v, i) => n + Math.hypot(v.x-p[i]!.x,v.z-p[i]!.z,(v.y??0)-(p[i]!.y??0)), 0);
  const cells=r.rooms.map((_,i)=>i),edgeLengths=new Map<string,number>();
  for(const [key,points]of r.edgePaths)edgeLengths.set(key,length(points));
  const edge=(a:number,b:number)=>edgeLengths.get(`${a}:${b}`)!;
  const bridges=(maze.free!.bridges??[]).map(b=>bridgeGeometry(maze.free!,b)),bridgeUsage:FreeBridgeUsage[]=bridges.map(g=>({id:g.bridge.id,overProbability:0,underProbability:0,overVisits:0,underVisits:0})),edgeUsage=new Map<string,{over:number[];under:number[]}>();
  for(const [key,path]of r.edgePaths){const [a,b]=key.split(':').map(Number),over:number[]=[],under:number[]=[];
    for(const [i,g]of bridges.entries()){
      const from=r.rooms[a!]!.id,to=r.rooms[b!]!.id;if(from===g.bridge.a.room&&to===g.bridge.b.room||to===g.bridge.a.room&&from===g.bridge.b.room)over.push(i);
      if(path.slice(1).some((q,j)=>(q.y??0)<.01&&(path[j]!.y??0)<.01&&intersection(path[j]!,q,g.path[1]!,g.path[2]!)!==null))under.push(i);
    }edgeUsage.set(key,{over,under});
  }
  const endpoints=length(r.portalPaths.get(maze.free!.entrance)!)+length(r.portalPaths.get(maze.free!.exit)!);
  let expectedLength = 0, finished = 0;
  for (let sample = 0; sample < samples; sample++) {
    const seen = new Set<number>(),learned=new LearnedGraph(r.rooms.length,cells,edge);
    const above=new Set<number>(),below=new Set<number>();
    const travel=(a:number,b:number)=>{const usage=edgeUsage.get(`${a}:${b}`)!;for(const i of usage.over){above.add(i);bridgeUsage[i]!.overVisits++;}for(const i of usage.under){below.add(i);bridgeUsage[i]!.underVisits++;}return edge(a,b);};
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
        const next=choices[index]!;total+=travel(at,next);enter(next);continue;
      }
      // Find another remembered junction with a still-unexplored door. No hidden
      // adjacency is queried, and learned loops are available as return shortcuts.
      const known=learned.routesFrom(at);let target=-1,best=Infinity;
      for(const cell of seen)if(learned.neighbors(cell).some(n=>!seen.has(n))){const d=known.distanceTo(cell);if(d<best){best=d;target=cell;}}
      if(target<0)break;
      const back=known.routeTo(target);if(!back||back.cells.length<2)break;
      for(const next of back.cells.slice(1)){total+=travel(at,next);enter(next);}
    }
    for (const c of seen) probability[c]!++;
    for(const i of above)bridgeUsage[i]!.overProbability++;for(const i of below)bridgeUsage[i]!.underProbability++;
    expectedLength += total;
  }
  for (let i = 0; i < visits.length; i++) {
    visits[i]! /= samples;
    probability[i]! /= samples;
  }
  for(const b of bridgeUsage)for(const key of ['overProbability','underProbability','overVisits','underVisits'] as const)b[key]/=samples;
  const areas=freeAreaWeights(maze,false),bridgeAreas=bridges.map(g=>g.bridge.width*(2*Math.hypot(g.bridge.stairRun,g.bridge.rise)+g.length-2*g.bridge.stairRun)),totalArea=areas.reduce((a,b)=>a+b,0)+bridgeAreas.reduce((a,b)=>a+b,0),regions=freeColdRegions(maze,probability,bridgeUsage.map(b=>b.overProbability),.2),cold=regions.reduce((sum,r)=>sum+r.area,0);
  const unseen=areas.reduce((sum,w,i)=>sum+w*(1-probability[i]!),0)+bridgeAreas.reduce((sum,w,i)=>sum+w*(1-bridgeUsage[i]!.overProbability),0);
  return {bridgeUsage,unseenAreaRatio:totalArea?unseen/totalArea:0,probability, visits, expectedLength: expectedLength / samples, finishedRatio: finished / samples, coldAreaRatio: totalArea ? cold / totalArea : 0, largestColdArea: Math.max(0, ...regions.map(r=>r.area)), optimalLength: pathLength(routePoints(maze)), samples, profile };
}
export function checkFreeQuality(maze: Maze,options?:{quick?:boolean}): string[] {
  const errors: string[] = [...bridgeRouteErrors(maze)], p = maze.parameters;
  if ((p.routeTrapCount ?? 0) > 0 && (p.routeTrapCount ?? 0) > routeTraps(maze).qualifiedCount) errors.push('Не выполнено требование маршрутных ловушек.');
  if ((p.loopTrapCount ?? 0) > 0 && (p.loopTrapCount ?? 0) > loopTraps(maze).qualifiedCount) errors.push('Не выполнено требование кольцевых ловушек.');
  const requestedIslands=p.freeIslandCount??p.freeZoneCount??0;
  if(requestedIslands>0&&requestedIslands>freeIslands(maze.free!).length)errors.push('Не выполнено требование замкнутых островов.');
  if (!p.design) return errors;
  const r = freeRuntime(maze), limits = effectiveLimits(p);
  let sight = 0, straight = 0, run = 0;
  if(Number.isFinite(limits.maxVisibleStraight))for (const c of r.centers) for (let deg = 0; deg < 360; deg++) {
    const angle = deg * Math.PI / 180;
    sight = Math.max(sight, freeRay(maze, c, angle, 101) + freeRay(maze, c, angle + Math.PI, 101));
  }
  if(p.design.groundOnlyLengths||options?.quick&&!maze.free?.bridges?.length){const lengths=freeGroundLengths(maze);straight=lengths.straight;run=lengths.run;}
  else for (let a = 0; a < r.rooms.length; a++)for (const b of r.passages[a]!) {
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
  // Generation uses deterministic geometry only; sampled heat belongs to explicit analysis.
  if(options?.quick)return errors;
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
