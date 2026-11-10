import {effectiveLimits} from '../core/design-limits';
import {neighbors,validateParameters,type Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {metrics} from '../core/metrics';
import {random,shuffle} from '../core/random';
import {loopTraps} from '../analysis/loop-traps';
import {routeTraps} from '../analysis/route-traps';
import {corridorQuality} from '../analysis/corridor-quality';
import {mazePortalPrivacy} from '../analysis/portal-privacy';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../analysis/coldspots';
import {connectionRouteGain} from '../analysis/route-alternatives';
import {criticalWalls} from '../analysis/critical-walls';

/** Add exactly the requested independent cycles, keeping real blind traps and portal shielding.
 * Partial candidates use coarse heat estimates only for ranking; acceptance is checked at full precision.
 */
export function addConstrainedConnections(base:Maze,count:number,seed=base.parameters.seed,onProgress?:(message:string)=>void):Maze {
  validateParameters({...base.parameters,extraConnections:count});
  const initial=metrics(base),privacy=mazePortalPrivacy(base,false);
  if(initial.components!==1||initial.cycles>count)throw new Error('Добавление связей требует связной области и не удаляет существующие кольца.');
  if(!privacy.certified)throw new Error('Для совместного подбора связей нужны скрытые проёмы.');
  const protectedCells=new Set([...privacy.entrance.pocket,...privacy.exit.pocket]);
  const protectedEdges=new Set(criticalWalls(base).map(w=>`${w.a}:${w.b}`));
  const pairs:[number,number][]=[];
  for(const a of domainOf(base).cells)for(const b of neighbors(base,a))if(b>a&&!protectedCells.has(a)&&!protectedCells.has(b)&&!protectedEdges.has(`${a}:${b}`))pairs.push([a,b]);
  const requested=base.parameters.routeTrapCount??0,limits=base.parameters.design,bounds=effectiveLimits(base.parameters);
  const originalForks=new Set(routeTraps(base).candidates.filter(t=>t.qualifies).map(t=>t.fork));
  const originalLoops=new Set(loopTraps(base).candidates.filter(t=>t.qualifies).map(t=>t.fork));
  const assess=(maze:Maze,samples:number)=>analyzePotential(maze,{...DEFAULT_ANALYSIS,routeMemory:1,samples},undefined,false);
  if(initial.cycles===count){const maze={...base,parameters:{...base.parameters,extraConnections:count,seed}};if(!assess(maze,2048).eligible)throw new Error('Текущая область не проходит ограничения качества.');return maze;}
  if(count-initial.cycles>pairs.filter(([a,b])=>!base.passages[a]!.includes(b)).length)throw new Error('Недостаточно доступных перегородок для заданного числа соединений.');
  for(let restart=0;restart<4;restart++){
    const rng=random(seed+`|connections-v1-${restart}`);
    let beam=[{maze:base,score:0}];
    for(let cycles=initial.cycles+1;cycles<=count;cycles++){
      onProgress?.(`Дополнительные соединения: ${cycles}/${count} · попытка ${restart+1}`);
      const next=new Map<string,{maze:Maze;score:number}>();
      for(const state of beam){
        const closed=pairs.filter(([a,b])=>!state.maze.passages[a]!.includes(b));shuffle(closed,rng);
        const gains=new Map(closed.map(([a,b])=>[a+':'+b,connectionRouteGain(state.maze,a,b)]));
        closed.sort(([a,b],[c,d])=>gains.get(c+':'+d)!-gains.get(a+':'+b)!);
        let assessed=0;
        for(const [a,b] of closed){
          if(assessed>=32)break;
          const passages=[...state.maze.passages];passages[a]=[...passages[a]!,b].sort((x,y)=>x-y);passages[b]=[...passages[b]!,a].sort((x,y)=>x-y);
          const maze={...state.maze,parameters:{...base.parameters,extraConnections:cycles,seed},passages};
          const c=corridorQuality(maze,Math.min(40,bounds.maxForcedStraight));
          if(c.longestForcedStraight>(bounds.maxForcedStraight)||c.longestForcedRun>(bounds.maxForcedRun)||c.longestVisibleStraight>(bounds.maxVisibleStraight))continue;
          const traps=routeTraps(maze),forks=new Set(traps.candidates.filter(t=>t.qualifies).map(t=>t.fork));
          const loops=loopTraps(maze);
          if(loops.qualifiedCount<(base.parameters.loopTrapCount??0)||[...originalLoops].some(fork=>!loops.candidates.some(t=>t.qualifies&&t.fork===fork))||traps.qualifiedCount<requested||[...originalForks].some(fork=>!forks.has(fork)))continue;
          assessed++;
          const value=assess(maze,64);
          if(!value.privacy.certified||limits&&(value.worstColdRatio>bounds.maxColdRatio+.04||value.worstColdRegion>bounds.maxColdRegion+8))continue;
          const score=value.score!+.002*gains.get(a+':'+b)!;
          next.set(JSON.stringify(passages),{maze,score});
          if(!limits)break;
        }
      }
      beam=[...next.values()].sort((a,b)=>b.score-a.score).slice(0,4);
      if(!beam.length)break;
    }
    for(const {maze} of beam)if(metrics(maze).cycles===count&&assess(maze,2048).eligible)return maze;
  }
  throw new Error('Не удалось добавить все соединения с сохранением ловушек, коротких коридоров и холодных областей. Текущий лабиринт сохранён; уменьшите число соединений или измените seed.');
}
