import {neighbors,type Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {shortestPath} from '../core/pathfinding';
import {random} from '../core/random';
import {criticalWalls} from './critical-walls';
import {loopTraps} from './loop-traps';
import {routeTraps} from './route-traps';
import {analyzePotential} from './potential-difficulty';
import type {AnalysisOptions} from './coldspots';
import type {OptimizationResult} from './optimize';
export function optimizeCyclic(base:Maze,options:AnalysisOptions,attempts:number,progress?:(done:number,total:number)=>void):OptimizationResult {
 const full=base.parameters.design?{...options,samples:2048}:options,before=analyzePotential(base,full,undefined,false),domain=domainOf(base);
 const key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
 const protectedEdges=new Set(criticalWalls(base).map(w=>key(w.a,w.b))),protectedCells=new Set([...before.privacy.entrance.pocket,...before.privacy.exit.pocket]);
 const originalForks=new Set(before.traps.candidates.filter(t=>t.qualifies).map(t=>t.fork));
 const originalLoops=new Set(before.loops.candidates.filter(t=>t.qualifies).map(t=>t.fork));
 const pairs:[number,number][]=[];
 for(const a of domain.cells)for(const b of neighbors(base,a))if(b>a&&!protectedCells.has(a)&&!protectedCells.has(b)&&!protectedEdges.has(key(a,b)))pairs.push([a,b]);
 const rng=random(base.parameters.seed+'|cyclic-wall-optimization');let best=base,bestValue=before,accepted=0;
 const budget=Math.min(attempts,Math.max(2,Math.floor(2000000/(domain.cells.length*64*3))));
 for(let i=0;i<budget;i++){
   const closed=pairs.filter(([a,b])=>!best.passages[a]!.includes(b));
   if(closed.length){
     const [a,b]=closed[Math.floor(rng()*closed.length)]!,path=shortestPath(best,a,b),cuts=path.slice(1).map((d,j)=>[path[j]!,d] as [number,number]).filter(([c,d])=>!protectedCells.has(c)&&!protectedCells.has(d));
     if(cuts.length){
       const [c,d]=cuts[Math.floor(rng()*cuts.length)]!,passages=[...best.passages];for(const n of new Set([a,b,c,d]))passages[n]=[...passages[n]!];
       passages[a]!.push(b);passages[b]!.push(a);passages[c]=passages[c]!.filter(n=>n!==d);passages[d]=passages[d]!.filter(n=>n!==c);for(const n of new Set([a,b,c,d]))passages[n]!.sort((a,b)=>a-b);
       const maze={...best,passages},traps=routeTraps(maze),forks=new Set(traps.candidates.filter(t=>t.qualifies).map(t=>t.fork));
       if([...originalForks].every(fork=>forks.has(fork))&&[...originalLoops].every(fork=>loopTraps(maze).candidates.some(t=>t.qualifies&&t.fork===fork))){
         const quick=analyzePotential(maze,{...options,samples:Math.min(64,options.samples)},undefined,false);
         if(quick.eligible){const value=analyzePotential(maze,full,undefined,false);if(value.eligible&&(!bestValue.eligible||value.score!>bestValue.score!+1e-9)){best=maze;bestValue=value;accepted++;}}
       }
     }
   }
   progress?.(i+1,budget);
 }
 return {maze:best,changed:best!==base,attempted:budget,accepted,before:before.score??0,after:bestValue.score??0,objective:'exploration',beforePotential:before,afterPotential:bestValue};
}
