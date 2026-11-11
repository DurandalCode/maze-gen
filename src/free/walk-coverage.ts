import type {Maze,Point} from '../core/maze';
import {bridgeGeometry} from './bridges';
/** Union contiguous observed progress ranges, so entering opposite ends in
 * separate visits never invents a traversal of the unexplored middle. */
export function bridgeWalkArea(maze:Maze,samples:readonly Point[]):number{
 const bridges=new Map((maze.free?.bridges??[]).map(b=>[b.id,bridgeGeometry(maze.free!,b)])),ranges=new Map<string,[number,number][]>();
 const state:{active:{id:string;lo:number;hi:number}|null}={active:null};
 const flush=()=>{const active=state.active;if(active){const list=ranges.get(active.id)??[];list.push([active.lo,active.hi]);ranges.set(active.id,list);state.active=null;}};
 for(const p of samples){
  const g=p.bridge===undefined?undefined:bridges.get(p.bridge);
  if(!g){flush();continue;}
  const t=Math.max(0,Math.min(1,g.progress(p)));
  const current=state.active;
  if(!current||current.id!==p.bridge){flush();state.active={id:p.bridge!,lo:t,hi:t};}
  else{current.lo=Math.min(current.lo,t);current.hi=Math.max(current.hi,t);}
 }
 flush();let covered=0;
 for(const [id,intervals]of ranges){
  const g=bridges.get(id)!,b=g.bridge,runLength=Math.hypot(b.stairRun,b.rise),arc=(t:number)=>{
   const distance=t*g.length;if(distance<=b.stairRun)return distance/b.stairRun*runLength;
   if(distance<=g.length-b.stairRun)return runLength+distance-b.stairRun;
   return runLength+g.length-2*b.stairRun+(distance-g.length+b.stairRun)/b.stairRun*runLength;
  };
  intervals.sort((a,b)=>a[0]-b[0]);let current=intervals[0]!;
  for(const next of intervals.slice(1))if(next[0]<=current[1]+1e-7)current=[current[0],Math.max(current[1],next[1])];else{covered+=(arc(current[1])-arc(current[0]))*b.width;current=next;}
  covered+=(arc(current[1])-arc(current[0]))*b.width;
 }
 return covered;
}
