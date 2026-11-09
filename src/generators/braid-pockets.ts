import {neighbors,type Maze} from '../core/maze';
import {metrics} from '../core/metrics';
import {obviousForkDeadEnds} from '../analysis/visible-deadends';
import {routeTraps} from '../analysis/route-traps';
import {loopTraps} from '../analysis/loop-traps';
import {corridorQuality} from '../analysis/corridor-quality';
import {mazePortalPrivacy} from '../analysis/portal-privacy';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../analysis/coldspots';

/** Braid only fully visible fork pockets, preserving every already qualified trap
 * fork and return-loop fork. Leaf relocation can preserve pendant tree traps. Additional cycles are explicit in the returned parameters.
 * Heat remains physical; every returned edit passes the original quality limits.
 */
export function braidObviousPockets(base:Maze,targetRatio=.12,maxAdditionalCycles=24,onProgress?:(message:string)=>void):Maze {
 if(!Number.isFinite(targetRatio)||targetRatio<0||targetRatio>1||!Number.isInteger(maxAdditionalCycles)||maxAdditionalCycles<0||maxAdditionalCycles>20000)throw new Error('Некорректная цель сокращения очевидных карманов.');
 const originalTraps=new Set(routeTraps(base).candidates.filter(t=>t.qualifies).map(t=>t.fork));
 const originalLoops=new Set(loopTraps(base).candidates.filter(t=>t.qualifies).map(t=>t.fork));
 const privacy=mazePortalPrivacy(base,false),protectedCells=new Set([...privacy.entrance.pocket,...privacy.exit.pocket]);
 const limits=base.parameters.design;
 const assess=(maze:Maze,samples:number)=>analyzePotential(maze,{...DEFAULT_ANALYSIS,samples,routeMemory:1},undefined,false);
 let current=base,ratio=obviousForkDeadEnds(base).ratio;
 for(let step=0;step<maxAdditionalCycles&&ratio>targetRatio;step++){
  const candidates:{maze:Maze;ratio:number}[]=[],keys=new Set<string>();
  const offer=(maze:Maze)=>{
   const nextRatio=obviousForkDeadEnds(maze).ratio;if(nextRatio>=ratio-1e-9)return;
   const c=corridorQuality(maze,limits?.maxForcedStraight??12);
   if(c.longestForcedStraight>c.straightLimit||c.longestForcedRun>(limits?.maxForcedRun??20)||c.longestVisibleStraight>(limits?.maxVisibleStraight??Infinity))return;
   const traps=new Set(routeTraps(maze).candidates.filter(t=>t.qualifies).map(t=>t.fork));if([...originalTraps].some(f=>!traps.has(f)))return;
   const loops=new Set(loopTraps(maze).candidates.filter(t=>t.qualifies).map(t=>t.fork));if([...originalLoops].some(f=>!loops.has(f)))return;
   candidates.push({maze,ratio:nextRatio});
  };
  for(const tail of obviousForkDeadEnds(current).branches)for(const a of [tail.end])for(const b of neighbors(current,a)){
   const key=Math.min(a,b)+':'+Math.max(a,b);if(keys.has(key)||current.passages[a]!.includes(b)||protectedCells.has(a)||protectedCells.has(b))continue;keys.add(key);
   const passages=[...current.passages];passages[a]=[...passages[a]!,b].sort((x,y)=>x-y);passages[b]=[...passages[b]!,a].sort((x,y)=>x-y);
   offer({...current,parameters:{...current.parameters,extraConnections:metrics(current).cycles+1},passages});
   // A leaf may be moved to another adjacent attachment without adding a cycle.
   // This retains genuine pendant tree traps, which cannot be braided internally.
   const parent=current.passages[a]![0]!;
   if(current.passages[a]!.length===1&&!protectedCells.has(parent)){
    const graft=[...current.passages];graft[a]=[b];graft[parent]=graft[parent]!.filter(n=>n!==a);graft[b]=[...graft[b]!,a].sort((x,y)=>x-y);
    offer({...current,passages:graft});
   }
  }
  candidates.sort((a,b)=>a.ratio-b.ratio||metrics(a.maze).cycles-metrics(b.maze).cycles);
  let next:typeof candidates[number]|undefined;
  for(const candidate of candidates){
   if(!mazePortalPrivacy(candidate.maze,false).certified)continue;
   if(!assess(candidate.maze,64).eligible||!assess(candidate.maze,256).eligible||!assess(candidate.maze,2048).eligible)continue;
   next=candidate;break;
  }
  if(!next)break;
  current=next.maze;ratio=next.ratio;
  onProgress?.(`Сокращение очевидных карманов: ${(ratio*100).toFixed(1)}%, циклов ${metrics(current).cycles}`);
 }
 return current;
}
