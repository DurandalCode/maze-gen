import type {Maze} from '../core/maze';
import {metrics} from '../core/metrics';
import {shortestPath} from '../core/pathfinding';
import {prepareNavigation,prepareOutline} from './navigation';
import {decisionModel,decisionScore,choiceProbabilities} from './decision-model';
export interface LoopTrap {
  fork:number; loop:number[]; correct:number; correctPath:number[];
  length:number; turns:number; width:number; depth:number;
  entryProbabilities:[number,number]; correctProbability:number;
  qualifies:boolean; score:number;
}
export interface LoopTraps {supported:boolean;candidates:LoopTrap[];qualifiedCount:number}
/** A false component has exactly two doors at ONE route junction and no other connection
 * to the entrance/exit network. Its shortest circuit returns to that junction.
 * Probabilities describe local attraction, not a guarantee that a human completes the circuit.
 */
export function loopTraps(maze:Maze):LoopTraps {
 const m=metrics(maze);
 if(m.components!==1)return {supported:false,candidates:[],qualifiedCount:0};
 if(!m.cycles)return {supported:true,candidates:[],qualifiedCount:0};
 const ctx=prepareNavigation(maze);prepareOutline(maze,ctx);
 const route=shortestPath(maze),routeSet=new Set(route),model=decisionModel(maze,ctx),candidates:LoopTrap[]=[];
 const edge=(a:number,b:number)=>Math.hypot(ctx.centers[a]!.x-ctx.centers[b]!.x,ctx.centers[a]!.z-ctx.centers[b]!.z);
 for(let i=1;i<route.length-1;i++){
  const fork=route[i]!,previous=route[i-1]!,correct=route[i+1]!,choices=maze.passages[fork]!.filter(n=>n!==previous);
  if(choices.length<3)continue;
  const features=choices.map(n=>model.features(fork,n,ctx.centers[previous],'outline'));
  const plus=choiceProbabilities(features.map(f=>decisionScore(f,3,1,1.5,1))),minus=choiceProbabilities(features.map(f=>decisionScore(f,3,1,1.5,-1)));
  const probability=(n:number)=>{const j=choices.indexOf(n);return (plus[j]!+minus[j]!)/2;};
  const checked=new Set<number>();
  for(const door of choices){
   if(door===correct||checked.has(door))continue;
   const seen=new Set([door]),queue=[door];
   for(let j=0;j<queue.length;j++)for(const n of maze.passages[queue[j]!]!)if(n!==fork&&!seen.has(n)){seen.add(n);queue.push(n);}
   for(const c of seen)checked.add(c);
   if(queue.some(c=>routeSet.has(c)||c===maze.entrance.cell||c===maze.exit.cell))continue;
   const doors=maze.passages[fork]!.filter(n=>seen.has(n));if(doors.length!==2)continue;
   const [a,b]=doors as [number,number],parent=new Map<number,number>([[a,-1]]),bfs=[a];
   for(let j=0;j<bfs.length&&!parent.has(b);j++)for(const n of maze.passages[bfs[j]!]!)if(n!==fork&&!parent.has(n)){parent.set(n,bfs[j]!);bfs.push(n);}
   if(!parent.has(b))continue;
   const path=[b];while(path.at(-1)!==a)path.push(parent.get(path.at(-1)!)!);path.reverse();
   const loop=[fork,...path,fork],points=loop.map(c=>ctx.centers[c]!);
   const length=loop.slice(1).reduce((s,c,j)=>s+edge(loop[j]!,c),0);
   let turns=0;for(let j=0;j<points.length-1;j++){const a=points[(j+points.length-2)%(points.length-1)]!,b=points[j]!,c=points[j+1]!;if(Math.abs((b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x))>1e-7)turns++;}
   const width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),depth=Math.max(...points.map(p=>p.z))-Math.min(...points.map(p=>p.z));
   const entryProbabilities:[number,number]=[probability(a),probability(b)],correctProbability=probability(correct);
   const qualifies=length>=40&&turns>=4&&width>=6&&depth>=6&&Math.min(...entryProbabilities)>=.15&&correctProbability<=.4&&entryProbabilities[0]+entryProbabilities[1]>=.6&&!features[choices.indexOf(correct)]!.exitVisible;
   candidates.push({fork,loop,correct,correctPath:route.slice(i,i+5),length,turns,width,depth,entryProbabilities,correctProbability,qualifies,score:length*(entryProbabilities[0]+entryProbabilities[1])*(1-correctProbability)});
  }
 }
 candidates.sort((a,b)=>Number(b.qualifies)-Number(a.qualifies)||b.score-a.score||a.fork-b.fork);
 return {supported:true,candidates,qualifiedCount:new Set(candidates.filter(t=>t.qualifies).map(t=>t.fork)).size};
}
