import type {Maze} from '../core/maze';
import {guardedMaze} from './guarded';
import {pRouteTrapMaze} from './p-route-trap';
import {routeTrapCandidates} from './route-trap-candidates';
import {routeTraps} from '../analysis/route-traps';
import {corridorQuality} from '../analysis/corridor-quality';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../analysis/coldspots';
import {domainOf} from '../core/domain';
import {jointGenerate} from './joint-generate';
import {jointRepair} from './joint-repair';

/** The ordinary generator's numeric trap constraint. No hand-edited topology is required. */
export function standardTraps(base:Maze,onProgress?:(message:string)=>void):Maze {
  if(base.parameters.design)return jointGenerate(base,onProgress);
  const requested=base.parameters.routeTrapCount??0;
  if(!requested)return base;
  const ranking={...DEFAULT_ANALYSIS,samples:32,routeMemory:1};
  let best:Maze|undefined,bestScore=-Infinity,qualified=0;
  const repairable:{maze:Maze;penalty:number}[]=[];
  const consider=(candidate:Maze)=>{
    const maze={...candidate,parameters:{...base.parameters}};
    if(routeTraps(maze).qualifiedCount<requested)return;
    const c=corridorQuality(maze);
    if(c.longestForcedStraight>12||c.longestForcedRun>20){
      const penalty=Math.max(0,c.longestForcedStraight/12-1)+Math.max(0,c.longestForcedRun/20-1);
      repairable.push({maze,penalty});repairable.sort((a,b)=>a.penalty-b.penalty);if(repairable.length>4)repairable.pop();
      return;
    }
    const p=analyzePotential(maze,ranking,undefined,false);
    if(!p.eligible)return;
    qualified++;
    if(p.score!>bestScore){best=maze;bestScore=p.score!;}
  };
  const cells=domainOf(base).cells.length,budget=Math.min(96,Math.max(2,Math.floor(2000000/(cells*64*3))));
  for(let i=0;i<budget;i++){
    const seed=base.parameters.seed.slice(0,160)+`|ordinary-trap-${i+1}`;
    const constructed=pRouteTrapMaze(base,seed);
    if(constructed)consider(constructed);
    else {
      const guarded=guardedMaze(base,seed);
      consider(guarded.maze);
      if(i<4&&cells<=800)for(const candidate of routeTrapCandidates(guarded.maze,guarded.constraints,12,20,4))consider(candidate);
    }
    if(qualified>=8)break;
  }
  // A valid trap template can still contain a long run masked by obvious blind
  // pockets. Repair a bounded set of near misses rather than weakening its limits.
  if(!best)for(const [index,{maze}] of [...repairable].entries()){
    onProgress?.(`Сокращение проходов без содержательного выбора · вариант ${index+1}/${repairable.length}`);
    for(const candidate of jointRepair(maze,base.parameters.seed+`|ordinary-corridor-repair-${index}`,640))consider(candidate);
    if(best)break;
  }
  if(!best)throw new Error(`Не удалось разместить ловушки: нужно не менее ${requested} разных развилок. Измените seed, форму или уменьшите количество. Текущий лабиринт сохранён.`);
  return best;
}
