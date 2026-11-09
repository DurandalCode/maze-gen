import type {Maze} from '../core/maze';
import {metrics} from '../core/metrics';
import {shortestPath} from '../core/pathfinding';
import {prepareNavigation,prepareOutline} from './navigation';
import {decisionModel,decisionScore,choiceProbabilities} from './decision-model';
import {spatialPerception} from './spatial-perception';

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
  const m=metrics(maze);
  if(m.components!==1||m.cycles!==0)return {supported:false,candidates:[],qualifiedCount:0,best:null};
  const ctx=prepareNavigation(maze);prepareOutline(maze,ctx);
  const distance=ctx.outlineDistances!,route=shortestPath(maze),onRoute=new Set(route),model=decisionModel(maze,ctx),sight=spatialPerception(maze,ctx);
  const edge=(a:number,b:number)=>Math.hypot(ctx.centers[a]!.x-ctx.centers[b]!.x,ctx.centers[a]!.z-ctx.centers[b]!.z);
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
    const requiredRetreat=peak-distance[fork]!;
    for(let k=0;k<choices.length;k++){
      const n=choices[k]!;if(n===correct||onRoute.has(n))continue;
      const stack=[{cell:n,parent:fork,path:[fork,n],length:edge(fork,n),toward:Math.max(0,distance[fork]!-distance[n]!)}];
      while(stack.length){
        const state=stack.pop()!,children=maze.passages[state.cell]!.filter(c=>c!==state.parent);
        if(children.length){for(const c of children)stack.push({cell:c,parent:state.cell,path:[...state.path,c],length:state.length+edge(state.cell,c),toward:state.toward+Math.max(0,distance[state.cell]!-distance[c]!)});continue;}
        const deadEndDistance=distance[state.cell]!,falseApproach=distance[fork]!-deadEndDistance,entryProbability=(plus[k]!+minus[k]!)/2;
        const a=ctx.centers[fork]!,b=ctx.centers[state.cell]!,lineDistance=Math.hypot(b.x-a.x,b.z-a.z);
        const deadEndVisible=sight.trace(fork,Math.atan2(b.z-a.z,b.x-a.x),lineDistance+1e-5).length>=lineDistance-1e-7;
        const qualifies=falseApproach>=6&&state.length>=10&&state.toward/state.length>=.6&&requiredRetreat>=8&&awayLength>=8&&entryProbability>=.15&&!fs[k]!.deadEnd&&!fs[k]!.exitVisible&&!deadEndVisible;
        const score=entryProbability*Math.min(20,Math.max(0,falseApproach))*Math.min(20,requiredRetreat)/100;
        candidates.push({fork,deadEnd:state.cell,falsePath:state.path,correctAwayPath:[...correctAwayPath],forkDistance:distance[fork]!,deadEndDistance,falseApproach,falsePathLength:state.length,returnLength:state.length,requiredRetreat,awayLength,entryProbability,deadEndVisible,qualifies,score});
      }
    }
  }
  candidates.sort((a,b)=>Number(b.qualifies)-Number(a.qualifies)||b.score-a.score||a.fork-b.fork||a.deadEnd-b.deadEnd);
  return {supported:true,candidates,qualifiedCount:new Set(candidates.filter(c=>c.qualifies).map(c=>c.fork)).size,best:candidates[0]??null};
}
