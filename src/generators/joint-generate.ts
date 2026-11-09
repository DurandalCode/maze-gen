import type {Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {pRouteTrapMaze} from './p-route-trap';
import {guardedMaze} from './guarded';
import {bootstrapRouteTraps} from './route-trap-candidates';
import {routeTraps} from '../analysis/route-traps';
import {jointRepair} from './joint-repair';
import {shapeAlternatives} from './shape-alternatives';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../analysis/coldspots';

/** Try the original footprint first, then authorized alternatives; never relax any quality bound. */
export function jointGenerate(base:Maze,onProgress?:(message:string)=>void):Maze {
  const requested=base.parameters.routeTrapCount??0,stages=[base,...shapeAlternatives(base)];
  for(let stage=0;stage<stages.length;stage++){
    const source=stages[stage]!,cells=domainOf(source).cells.length;
    if(cells>1200)continue;
    let best:Maze|undefined,score=-Infinity;
    const consider=(candidate:Maze)=>{
      const maze={...candidate,parameters:{...source.parameters}};
      const value=analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:2048,routeMemory:1},undefined,false);
      if(value.eligible&&value.score!>score){best=maze;score=value.score!;}
    };
    consider(source);
    if(best)return best;
    const attempts=stage===0?(source.parameters.shape?6:32):3;
    for(let i=0;i<attempts;i++){
      onProgress?.(`Подбор ${source.parameters.columns}×${source.parameters.rows}, ${domainOf(source).modules.reduce((a,b)=>a+b,0)} модулей · попытка ${i+1}`);
      const seed=source.parameters.seed.slice(0,140)+`|joint-${source.parameters.columns}x${source.parameters.rows}-${cells}-${i}`;
      const constructed=pRouteTrapMaze(source,seed),sources:Maze[]=[];
      if(constructed)sources.push(constructed);
      else {
        const guarded=guardedMaze(source,seed);
        const currentCount=routeTraps(guarded.maze).qualifiedCount;
        if(currentCount>=requested)sources.push(guarded.maze);
        if(!sources.length&&(i<2||currentCount>0))sources.push(...bootstrapRouteTraps(guarded.maze,guarded.constraints,requested));
      }
      for(const candidate of sources){
        if(routeTraps(candidate).qualifiedCount<requested)continue;
        for(const repaired of jointRepair(candidate,seed,800))consider(repaired);
      }
      if(best)break;
    }
    if(best)return best;
  }
  throw new Error('Совместный подбор не нашёл вариант в заданных пределах. Ловушки и ограничения не ослаблены; текущий лабиринт сохранён. Разрешите изменение формы или больший рост числа модулей либо измените пределы.');
}
