import {spatialEdgeLength} from '../core/two-storey';
import {corridorPathPoints} from '../core/corridor-navigation';
import type {Maze} from '../core/maze';
import {decisionModel,type DecisionFeatures} from './decision-model';
import {prepareNavigation,prepareOutline} from './navigation';
export interface LoopProbe {entry:number;policy:'direction'|'direction-straight';distance:number;decisions:number;returnedToFork:boolean;stop:'familiar'|'dead-end'|'budget'}
export interface LoopCredibility {strongEntry:boolean;credible:boolean;directionMargin:number;falseDirections:[number,number];correctDirection:number;commitmentDistance:number;branchingDecisions:number;loopReturns:number;probes:LoopProbe[]}
/** A separate adversarial design control. It knows only the goal direction,
 * locally visible openings and its own visited prefix, never the loop membership. */
export function traceCommitment(passages:readonly (readonly number[])[],knownPrefix:readonly number[],first:number,features:(at:number,next:number,previous:number)=>DecisionFeatures,straightWeight:number){
 const fork=knownPrefix.at(-1)!,seen=new Set(knownPrefix),path=[fork,first];let previous=fork,at=first,decisions=0;
 for(let step=0;step<=passages.length;step++){
  if(seen.has(at))return {path,decisions,returnedToFork:at===fork,stop:'familiar' as const};seen.add(at);
  const options=passages[at]!.filter(n=>!seen.has(n)).map(n=>({n,f:features(at,n,previous)})).filter(({f})=>!f.exhausted&&!f.deadEnd||!!f.exitVisible);
  if(!options.length){const familiar=passages[at]!.some(n=>n!==previous&&seen.has(n));return {path,decisions,returnedToFork:passages[at]!.includes(fork)&&previous!==fork,stop:familiar?'familiar' as const:'dead-end' as const};}
  if(options.length>1)decisions++;
  const score=(f:DecisionFeatures)=>f.exitVisible*100+f.direction+straightWeight*f.straight;
  options.sort((a,b)=>score(b.f)-score(a.f)||a.n-b.n);previous=at;at=options[0]!.n;path.push(at);
 }
 return {path,decisions,returnedToFork:false,stop:'budget' as const};
}
export function loopCredibility(maze:Maze,knownPrefix:number[],doors:[number,number],correct:number,model?:ReturnType<typeof decisionModel>):LoopCredibility{
 const ctx=prepareNavigation(maze);prepareOutline(maze,ctx);model??=decisionModel(maze,ctx);const fork=knownPrefix.at(-1)!,previous=knownPrefix.at(-2),features=(n:number)=>model!.features(fork,n,previous===undefined?undefined:ctx.centers[previous],'outline'),falseDirections=doors.map(n=>features(n).direction) as [number,number],correctDirection=features(correct).direction,directionMargin=Math.min(...falseDirections)-correctDirection;
 const strongEntry=correctDirection<=-.15&&Math.min(...falseDirections)>=.1&&directionMargin>=.3;
 const probes:LoopProbe[]=doors.flatMap(entry=>(['direction','direction-straight'] as const).map(policy=>{
  const trace=traceCommitment(maze.passages,knownPrefix,entry,(a,b,p)=>model!.features(a,b,ctx.centers[p],'outline'),policy==='direction'?0:.25),g=maze.navigation,points=g?corridorPathPoints(g.source,trace.path.map(c=>g.representatives[c]!)):trace.path.map(c=>ctx.centers[c]!),distance=maze.storeys?trace.path.slice(1).reduce((sum,c,i)=>sum+spatialEdgeLength(maze,trace.path[i]!,c),0):points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i]!.x,p.z-points[i]!.z),0);
  return {entry,policy,distance,decisions:trace.decisions,returnedToFork:trace.returnedToFork,stop:trace.stop};
 }));
 const commitmentDistance=Math.min(...probes.map(p=>p.distance)),branchingDecisions=Math.min(...probes.map(p=>p.decisions));
 const loopReturns=probes.filter(p=>p.returnedToFork).length;
 return {strongEntry,credible:strongEntry&&commitmentDistance>=24&&loopReturns>0,loopReturns,directionMargin,falseDirections,correctDirection,commitmentDistance,branchingDecisions,probes};
}
