import {spatialLineVisible} from '../core/spatial-visibility';
import {corridorNavigation} from '../core/corridor-navigation';
import type {Maze} from '../core/maze';
import {componentCount,independentCycles} from '../core/graph';
import {shortestPath} from '../core/pathfinding';
import {prepareNavigation,prepareOutline,edgeLength} from './navigation';
import {decisionModel,decisionScore,choiceProbabilities} from './decision-model';
import {spatialPerception} from './spatial-perception';
import {minimaxRetreat} from './minimax-retreat';

export interface RouteTrap {
  fork:number; deadEnd:number;
  falsePath:number[]; correctAwayPath:number[];
  forkDistance:number; deadEndDistance:number; falseApproach:number;
  falsePathLength:number; returnLength:number;
  requiredRetreat:number; awayLength:number; entryProbability:number;
  deadEndVisible:boolean; qualifies:boolean; score:number;
}
export interface RouteTraps {supported:boolean; candidates:RouteTrap[]; qualifiedCount:number; best:RouteTrap|null}
/** Design analysis only: pairs a dead-end branch with the correct continuation at the SAME fork.
 * Exit distances use the footprint without internal walls. No solution is supplied to the player policy.
 */
export function routeTraps(maze:Maze):RouteTraps {
 if(maze.version===4&&!maze.navigation){const graph=corridorNavigation(maze),result=routeTraps(graph),map=(c:number)=>graph.navigation!.representatives[c]!;return {...result,candidates:result.candidates.map(t=>({...t,fork:map(t.fork),deadEnd:map(t.deadEnd),falsePath:t.falsePath.map(map),correctAwayPath:t.correctAwayPath.map(map)})),best:result.best?{...result.best,fork:map(result.best.fork),deadEnd:map(result.best.deadEnd),falsePath:result.best.falsePath.map(map),correctAwayPath:result.best.correctAwayPath.map(map)}:null};}

  const components=componentCount(maze),m={components,cycles:independentCycles(maze,components)};
  if(m.components!==1)return {supported:false,candidates:[],qualifiedCount:0,best:null};
  const ctx=prepareNavigation(maze);prepareOutline(maze,ctx);
  const distance=ctx.outlineDistances!,route=shortestPath(maze),onRoute=new Set(route),model=decisionModel(maze,ctx),sight=spatialPerception(maze,ctx);
  const minimumPeak=m.cycles?minimaxRetreat(maze,distance):null;
  const edge=(a:number,b:number)=>edgeLength(ctx,a,b);
  const candidates:RouteTrap[]=[];
  for(let i=0;i<route.length-1;i++){
    const fork=route[i]!,correct=route[i+1]!,choices=maze.passages[fork]!.filter(n=>n!==route[i-1]);
    if(choices.length<2)continue;
    const fs=choices.map(n=>model.features(fork,n,i?ctx.centers[route[i-1]!]:undefined,'outline'));
    const plus=choiceProbabilities(fs.map(f=>decisionScore(f,3,1,1.5,1))),minus=choiceProbabilities(fs.map(f=>decisionScore(f,3,1,1.5,-1)));
    // Initial uninterrupted retreat only; a later unrelated detour cannot count for this fork.
    let peak=distance[fork]!,awayLength=0;
    const correctAwayPath=[fork];
    for(let j=i+1;j<route.length;j++){
      const c=route[j]!,prev=route[j-1]!;
      if(distance[c]!<distance[prev]!-1e-7)break;
      awayLength+=edge(prev,c);peak=Math.max(peak,distance[c]!);correctAwayPath.push(c);
    }
    // A later unrelated detour must not inflate the initial retreat, while a cyclic shortcut
    // can reduce how much of this apparent retreat is actually necessary.
    const requiredRetreat=Math.min(peak,minimumPeak?minimumPeak[fork]!:peak)-distance[fork]!;
    for(let k=0;k<choices.length;k++){
      const n=choices[k]!;if(n===correct||onRoute.has(n))continue;
      if(m.cycles){
        // Only real pendant tree branches count as blind traps. A loop leading back to the main
        // network is an alternative route, not a dead end, even if one DFS happens to stop there.
        const seen=new Set([n]),queue=[n];let edges=0;
        for(let q=0;q<queue.length;q++)for(const next of maze.passages[queue[q]!]!)if(next!==fork){edges++;if(!seen.has(next)){seen.add(next);queue.push(next);}}
        const attachments=queue.reduce((sum,c)=>sum+Number(maze.passages[c]!.includes(fork)),0);
        if(attachments!==1||queue.some(c=>onRoute.has(c))||edges/2!==queue.length-1)continue;
      }
      const stack=[{cell:n,parent:fork,path:[fork,n],length:edge(fork,n),toward:Math.max(0,distance[fork]!-distance[n]!)}];
      while(stack.length){
        const state=stack.pop()!,children=maze.passages[state.cell]!.filter(c=>c!==state.parent);
        if(children.length){for(const c of children)stack.push({cell:c,parent:state.cell,path:[...state.path,c],length:state.length+edge(state.cell,c),toward:state.toward+Math.max(0,distance[state.cell]!-distance[c]!)});continue;}
        const deadEndDistance=distance[state.cell]!,falseApproach=distance[fork]!-deadEndDistance,entryProbability=(plus[k]!+minus[k]!)/2;
        const a=ctx.centers[fork]!,b=ctx.centers[state.cell]!,lineDistance=Math.hypot(b.x-a.x,b.z-a.z);
        const deadEndVisible=(!maze.storeys||spatialLineVisible(maze,{...a,y:(a.y??0)+1.7},{...b,y:(b.y??0)+1.7}))&&sight.trace(fork,Math.atan2(b.z-a.z,b.x-a.x),lineDistance+1e-5).length>=lineDistance-1e-7;
        const qualifies=falseApproach>=6&&state.length>=10&&state.toward/state.length>=.6&&requiredRetreat>=8&&awayLength>=8&&entryProbability>=.15&&!fs[k]!.deadEnd&&!fs[k]!.exitVisible&&!deadEndVisible;
        const score=entryProbability*Math.min(20,Math.max(0,falseApproach))*Math.min(20,requiredRetreat)/100;
        candidates.push({fork,deadEnd:state.cell,falsePath:state.path,correctAwayPath:[...correctAwayPath],forkDistance:distance[fork]!,deadEndDistance,falseApproach,falsePathLength:state.length,returnLength:state.length,requiredRetreat,awayLength,entryProbability,deadEndVisible,qualifies,score});
      }
    }
  }
  candidates.sort((a,b)=>Number(b.qualifies)-Number(a.qualifies)||b.score-a.score||a.fork-b.fork||a.deadEnd-b.deadEnd);
  return {supported:true,candidates,qualifiedCount:new Set(candidates.filter(c=>c.qualifies).map(c=>c.fork)).size,best:candidates[0]??null};
}
