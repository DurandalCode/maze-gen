import type {Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {minimumFloorChanges} from '../core/two-storey';
import {shortestPath} from '../core/pathfinding';
import {componentCount,independentCycles} from '../core/graph';
import {generateTwoStorey} from '../generators/two-storey';
import {random,shuffle} from '../core/random';
import {analyzePotential} from './potential-difficulty';
import {analyzeColdspots,type AnalysisOptions} from './coldspots';
import type {OptimizationMethod,OptimizationObjective,OptimizationResult} from './optimize';
export function optimizeTwoStorey(base:Maze,options:AnalysisOptions,method:OptimizationMethod,attempts:number,progress:((n:number,total:number)=>void)|undefined,objective:OptimizationObjective):OptimizationResult {
  const quality=(maze:Maze,samples:number)=>analyzePotential(maze,{...options,samples},undefined,false);
  const score=(maze:Maze,samples=Math.min(options.samples,64))=>{if(objective==='exploration')return -(quality(maze,samples).score??-Infinity);return Math.max(...(['explorer','compass','outline'] as const).map(profile=>{const a=analyzeColdspots(maze,{...options,profile,samples});return a.coldAreaRatio+.5*a.largestColdArea/domainOf(maze).area;}));};
  const rng=random(base.parameters.seed+'|two-storey-optimize-v1'),initial=score(base),deadline=Date.now()+20_000;let best=base,bestScore=initial,accepted=0,attempted=0;
  for(let i=0;i<attempts&&Date.now()<deadline;i++){
    let candidate:Maze|undefined;attempted++;
    try{
      if(method==='seeds')candidate=generateTwoStorey({...base.parameters,seed:base.parameters.seed.slice(0,200)+'|storey-opt-'+i},base);
      else{
        const pairs:[number,number][]=[];for(const a of domainOf(best).cells)for(const b of best.storeys!.adjacent[a]!)if(b>a&&!best.passages[a]!.includes(b)&&best.storeys!.nodes[a]!.stair===undefined&&best.storeys!.nodes[b]!.stair===undefined)pairs.push([a,b]);
        const pair=shuffle(pairs,rng)[0];if(pair){const [a,b]=pair,path=shortestPath(best,a,b),cuts=path.slice(1).map((d,j)=>[path[j]!,d] as const).filter(([c,d])=>best.storeys!.nodes[c]!.stair===undefined&&best.storeys!.nodes[d]!.stair===undefined),cut=shuffle(cuts,rng)[0];if(cut){const [c,d]=cut,passages=best.passages.map(v=>[...v]);passages[a]!.push(b);passages[b]!.push(a);passages[c]=passages[c]!.filter(n=>n!==d);passages[d]=passages[d]!.filter(n=>n!==c);candidate={...best,passages};}}
      }
      if(candidate&&componentCount(candidate)===1&&independentCycles(candidate)===base.parameters.extraConnections&&minimumFloorChanges(candidate)>=(base.parameters.minFloorChanges??4)){
        const constrained=objective==='exploration'||!!base.parameters.design||(base.parameters.routeTrapCount??0)>0||(base.parameters.loopTrapCount??0)>0;
        if(!constrained||quality(candidate,64).eligible){const value=score(candidate);if(value<bestScore-1e-9){best=candidate;bestScore=value;accepted++;}}
      }
    }catch{/* An infeasible candidate cannot replace a valid map. */}
    progress?.(i+1,attempts);
  }
  const constrained=objective==='exploration'||!!base.parameters.design||(base.parameters.routeTrapCount??0)>0||(base.parameters.loopTrapCount??0)>0;
  if(best!==base&&constrained&&!quality(best,2048).eligible){best=base;bestScore=initial;accepted=0;}
  const before=score(base,options.samples),after=best===base?before:score(best,options.samples);
  if(after>=before-1e-9){best=base;accepted=0;}
  return {maze:best,changed:best!==base,attempted,accepted,before,after:best===base?before:after,objective,...(objective==='exploration'?{beforePotential:quality(base,options.samples),afterPotential:quality(best,options.samples)}:{})};
}
