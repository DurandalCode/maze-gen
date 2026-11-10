import {domainOf} from '../core/domain';
import {cellCenter,portalPoint,type Maze} from '../core/maze';
import {pathLength,routePoints} from '../core/pathfinding';
import {LearnedGraph} from './learned-graph';
import {visibleDeadEnd} from './visible-deadends';
import {viewCorridor} from './corridor-view';
import {prepareNavigation} from './navigation';
export interface CompassRun {policy:'direction'|'direction-straight'|'vertical-first'|'horizontal-first'|'visible-progress'|'nearest-goal';length:number;ratio:number;visited:number;revisits:number}
export interface CompassProbe {supported:boolean;bestRatio:number|null;meanRatio:number|null;runs:CompassRun[]}
const cache=new WeakMap<Maze,{signature:string;value:CompassProbe}>();
/** An adversarial control, not a fitted human model. Only observed openings and
 * previously entered cells are used for return travel; the exit position is known. */
export function compassProbe(maze:Maze):CompassProbe{
 const original=maze,signature=JSON.stringify([maze.version,maze.parameters,maze.entrance,maze.exit,maze.portals,maze.passages]);const cached=cache.get(original);if(cached?.signature===signature)return cached.value;
 maze={...maze};
 const d=domainOf(maze),optimal=pathLength(routePoints(maze));
 if(d.cells.length>1200||!optimal)return {supported:false,bestRatio:null,meanRatio:null,runs:[]};
 const context=prepareNavigation(maze),goal=portalPoint(maze,maze.exit),start=portalPoint(maze,maze.entrance),end=cellCenter(maze,maze.exit.cell),root=cellCenter(maze,maze.entrance.cell);
 const edge=(a:number,b:number)=>{const p=context.centers[a]!,q=context.centers[b]!;return Math.hypot(q.x-p.x,q.z-p.z);};
 const runs:CompassRun[]=[];
 for(const policy of ['direction','direction-straight','vertical-first','horizontal-first','visible-progress','nearest-goal'] as const){
  const learned=new LearnedGraph(maze.passages.length,d.cells,edge),visited=new Set<number>(),frontier=new Set<number>();let at=maze.entrance.cell,previous:number|undefined,length=Math.hypot(start.x-root.x,start.z-root.z),revisits=0;
  for(let step=0;step<=d.cells.length;step++){
   visited.add(at);frontier.delete(at);learned.observe(at,maze.passages[at]!);
   if(at===maze.exit.cell)break;
   for(const n of learned.neighbors(at))if(!visited.has(n)&&!visibleDeadEnd(maze,at,n,context))frontier.add(n);
   const local=learned.neighbors(at).filter(n=>frontier.has(n)&&!visited.has(n));let path:number[];
   if(policy!=='nearest-goal'&&local.length){
    const p=context.centers[at]!,g={x:goal.x-p.x,z:goal.z-p.z},last=previous===undefined?null:context.centers[previous]!;
    const score=(n:number)=>{const q=context.centers[n]!,dx=q.x-p.x,dz=q.z-p.z,heading=(dx*g.x+dz*g.z)/(Math.hypot(dx,dz)*Math.hypot(g.x,g.z)||1),straight=last?((p.x-last.x)*dx+(p.z-last.z)*dz)/(Math.hypot(p.x-last.x,p.z-last.z)*Math.hypot(dx,dz)||1):0;if(policy==='vertical-first')return Math.sign(dz)*Math.sign(g.z)*2+Math.sign(dx)*Math.sign(g.x);if(policy==='horizontal-first')return Math.sign(dx)*Math.sign(g.x)*2+Math.sign(dz)*Math.sign(g.z);if(policy==='visible-progress'){const view=viewCorridor(maze,context,at,n),point=context.centers[view.endCell]!;return Math.hypot(g.x,g.z)-Math.hypot(goal.x-point.x,goal.z-point.z)+.1*heading;}return heading+(policy==='direction-straight'?.25*straight:0);};
    local.sort((a,b)=>score(b)-score(a)||a-b);path=[at,local[0]!];
   }else{
    const routes=learned.routesFrom(at),choices=[...frontier].filter(c=>!visited.has(c)&&Number.isFinite(routes.distanceTo(c)));
    if(!choices.length)throw new Error('Контрольный поиск не достиг выхода.');
    choices.sort((a,b)=>{const p=context.centers[a]!,q=context.centers[b]!;return Math.hypot(p.x-goal.x,p.z-goal.z)+.25*routes.distanceTo(a)-Math.hypot(q.x-goal.x,q.z-goal.z)-.25*routes.distanceTo(b)||a-b;});
    path=routes.routeTo(choices[0]!)!.cells;
   }
   for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!;length+=edge(a,b);if(visited.has(b))revisits++;previous=a;at=b;}
  }
  if(at!==maze.exit.cell)throw new Error('Контрольный поиск превысил бюджет.');
  length+=Math.hypot(goal.x-end.x,goal.z-end.z);runs.push({policy,length,ratio:length/optimal,visited:visited.size,revisits});
 }
 const result={supported:true,bestRatio:Math.min(...runs.map(r=>r.ratio)),meanRatio:runs.reduce((s,r)=>s+r.ratio,0)/runs.length,runs};cache.set(original,{signature,value:result});return result;
}
