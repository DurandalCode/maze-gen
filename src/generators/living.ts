import type {Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {metrics} from '../core/metrics';
import {shortestPath} from '../core/pathfinding';
import {random} from '../core/random';
import {effectiveLimits} from '../core/design-limits';
import {contourQuality,contourStructure,contourKey} from './contours';
import {livingBase} from './living-base';
import {portalConstraints,type GuardConstraints} from './guarded';
import {shapeAlternatives} from './shape-alternatives';
import {routeTraps} from '../analysis/route-traps';
import {loopTraps} from '../analysis/loop-traps';
import {corridorQuality} from '../analysis/corridor-quality';
import {criticalWalls} from '../analysis/critical-walls';
import {analyzePotential,type PotentialDifficulty} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS,type AnalysisOptions} from '../analysis/coldspots';
import type {OptimizationMethod,OptimizationObjective,OptimizationResult} from '../analysis/optimize';

const constrained=(m:Maze)=>!!m.parameters.design||(m.parameters.routeTrapCount??0)>0||(m.parameters.loopTrapCount??0)>0;
/** Cheap structural screen. Heat is calculated only after graph constraints fit. */
function penalty(m:Maze):number{
 if(!contourQuality(m).certified)return Infinity;
 const r=routeTraps(m),l=loopTraps(m),limits=effectiveLimits(m.parameters);
 let value=20*Math.max(0,(m.parameters.routeTrapCount??0)-r.qualifiedCount)+20*Math.max(0,(m.parameters.loopTrapCount??0)-l.qualifiedCount);
 if(Number.isFinite(limits.maxForcedStraight)||Number.isFinite(limits.maxForcedRun)||Number.isFinite(limits.maxVisibleStraight)){
  const c=corridorQuality(m,Math.min(40,limits.maxForcedStraight));
  value+=5*(Math.max(0,c.longestForcedStraight/limits.maxForcedStraight-1)+Math.max(0,c.longestForcedRun/limits.maxForcedRun-1)+Math.max(0,c.longestVisibleStraight/limits.maxVisibleStraight-1));
 }
 return value;
}
function promise(m:Maze):number{
 const r=routeTraps(m),l=loopTraps(m);
 return ((m.parameters.routeTrapCount??0)>0?Math.min(2,r.best?.score??0):0)+((m.parameters.loopTrapCount??0)>0?Math.min(4,(l.candidates[0]?.score??0)/20):0);
}
/** Opening one wall and cutting its old connecting path preserves connectivity and cycle rank. */
export function exchangeLivingWall(base:Maze,rng:()=>number,guard?:GuardConstraints,protectedWalls:ReadonlySet<string>=new Set()):Maze|null{
 const pairs=guard?.allowed??contourStructure(base).pairs,closed=pairs.filter(([a,b])=>!base.passages[a]!.includes(b)&&!protectedWalls.has(contourKey(a,b)));
 if(!closed.length)return null;
 const [a,b]=closed[Math.floor(rng()*closed.length)]!,path=shortestPath(base,a,b),cuts=path.slice(1).map((c,i)=>[path[i]!,c] as [number,number]).filter(([x,y])=>!guard?.locked.has(contourKey(x,y)));
 if(!cuts.length)return null;
 const [x,y]=cuts[Math.floor(rng()*cuts.length)]!,passages=[...base.passages];
 for(const n of new Set([a,b,x,y]))passages[n]=[...passages[n]!];
 passages[a]!.push(b);passages[b]!.push(a);passages[x]=passages[x]!.filter(n=>n!==y);passages[y]=passages[y]!.filter(n=>n!==x);
 for(const n of new Set([a,b,x,y]))passages[n]!.sort((a,b)=>a-b);
 const m={...base,passages};return contourQuality(m).certified?m:null;
}
function assess(m:Maze,samples:number,options=DEFAULT_ANALYSIS){return analyzePotential(m,{...options,samples,routeMemory:1},undefined,false);}

/** Type-specific construction and mutations; shared trap definitions and quality assessment. */
export function generateLiving(base:Maze,progress?:(message:string)=>void):Maze{
 if(!constrained(base))return livingBase(base);
 if(domainOf(base).cells.length>1200)throw new Error('Совместный подбор живого лабиринта доступен до 1200 активных клеток. Уменьшите область или отключите требования качества и ловушек.');
 let last='';
 const stages=[base,...shapeAlternatives(base)];
 for(let stage=0;stage<stages.length;stage++){
  const source=stages[stage]!;if(domainOf(source).cells.length>1200)continue;let guard:GuardConstraints;
  try{guard=portalConstraints(source);}catch(e){last=e instanceof Error?e.message:String(e);continue;}
  const attempts=stage===0?24:3;
  for(let attempt=0;attempt<attempts;attempt++){
   progress?.(`Живой лабиринт · форма ${stage+1}/${stages.length} · вариант ${attempt+1}/${attempts}`);
   const seed=source.parameters.seed.slice(0,160)+`|living-search-${attempt}`;
   let current:Maze;
   try{current=livingBase(source,seed,guard);}catch(e){last=e instanceof Error?e.message:String(e);continue;}
   const rng=random(seed+'|exchange');let assessed:Maze|undefined;let currentPenalty=penalty(current),currentPromise=currentPenalty?promise(current):0;
   // Bounded local search moves cuts/gates; it never replaces contours with a classic template.
   const steps=Math.min(160,Math.max(32,Math.floor(80000/domainOf(source).cells.length)));
   for(let step=0;step<=steps;step++){
    if(step%40===0)progress?.(`Живой лабиринт · вариант ${attempt+1}/${attempts} · перестановки ${step}/${steps}`);
    if(currentPenalty<1e-8&&assessed!==current){
     assessed=current;
     const quick=assess(current,64);
     if(quick.eligible){const full=assess(current,2048);if(full.eligible)return current;last=full.issues.join(' ');}
     else last=quick.issues.join(' ');
    }
    const candidate=exchangeLivingWall(current,rng,guard);if(!candidate)continue;
    const nextPenalty=penalty(candidate);if(!Number.isFinite(nextPenalty))continue;
    const nextPromise=promise(candidate),delta=nextPenalty-currentPenalty-.4*(nextPromise-currentPromise),temperature=.5*(1-step/(steps+1))+.03;
    if(delta<=0||rng()<Math.exp(-delta/temperature)){current=candidate;currentPenalty=nextPenalty;currentPromise=nextPromise;}
   }
  }
 }
 throw new Error('Живой лабиринт не найден в заданных пределах: нужны '+(base.parameters.routeTrapCount??0)+' маршрутных и '+(base.parameters.loopTrapCount??0)+' кольцевых ловушек, сохранение контуров ≥80%. '+last+' Измените seed, требования или разрешите изменение формы. Текущий лабиринт сохранён.');
}
/** Shared optimizer entry point delegates here before any classical template or repair runs. */
export function optimizeLiving(base:Maze,options:AnalysisOptions,method:OptimizationMethod,attempts:number,progress:((done:number,total:number)=>void)|undefined,objective:OptimizationObjective):OptimizationResult{
 const fullOptions={...options,samples:base.parameters.design?2048:options.samples},before=assess(base,fullOptions.samples,fullOptions),initial=metrics(base);
 const score=(p:PotentialDifficulty)=>objective==='coldspots'?-(p.worstColdRatio+.5*p.worstColdRegion/domainOf(base).area):p.score??-Infinity;
 const protectedWalls=new Set(criticalWalls(base).map(w=>contourKey(w.a,w.b))),forks=new Set(before.traps.candidates.filter(t=>t.qualifies).map(t=>t.fork)),loops=new Set(before.loops.candidates.filter(t=>t.qualifies).map(t=>t.fork));
 const budget=Math.min(attempts,Math.max(2,Math.floor(2000000/(initial.cells*64*3)))),rng=random(base.parameters.seed+'|living-optimize');
 let guard:GuardConstraints|undefined;if(constrained(base))try{guard=portalConstraints(base);}catch{return {maze:base,changed:false,attempted:0,accepted:0,before:score(before),after:score(before),objective,beforePotential:before,afterPotential:before};}
 let best=base,bestValue=before,accepted=0;
 for(let i=0;i<budget;i++){
  let candidate:Maze|null=null;
  try{candidate=method==='seeds'?livingBase({...base,parameters:{...base.parameters,seed:base.parameters.seed.slice(0,190)+`|living-improve-${i}`}},undefined,guard):exchangeLivingWall(best,rng,guard,protectedWalls);}catch{/* A seed cannot satisfy protected contour/portal geometry. */}
  if(candidate&&metrics(candidate).cycles===initial.cycles&&[...protectedWalls].every(key=>{const [a,b]=key.split(':').map(Number);return !candidate!.passages[a!]!.includes(b!);})&&penalty(candidate)<1e-8){
   const quick=assess(candidate,Math.min(options.samples,64),options);
   if(quick.eligible&&(!before.privacy.entrance.certified||quick.privacy.entrance.certified)&&(!before.privacy.exit.certified||quick.privacy.exit.certified)&&[...forks].every(f=>quick.traps.candidates.some(t=>t.fork===f&&t.qualifies))&&[...loops].every(f=>quick.loops.candidates.some(t=>t.fork===f&&t.qualifies))){
    const value=assess(candidate,fullOptions.samples,fullOptions);
    if(value.eligible&&(!bestValue.eligible&&objective==='exploration'||score(value)>score(bestValue)+1e-9)){best=candidate;bestValue=value;accepted++;}
   }
  }
  progress?.(i+1,budget);
 }
 const display=(p:PotentialDifficulty)=>objective==='coldspots'?-score(p):score(p);
 return {maze:best,changed:best!==base,attempted:budget,accepted,before:display(before),after:display(bestValue),objective,beforePotential:before,afterPotential:bestValue};
}
