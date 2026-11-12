import type {Maze,Parameters} from '../core/maze';
import {portalPoint} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
import {generateDenseTraps} from './dense-traps';
import {generateSecondDenseTrap} from './dense-second-trap';
import {attachDenseReturnLoop} from './dense-return-loop';
import {anchorGeometry,freeRuntime} from './layout';
import {auditModuleWalls} from './module-origin';
/** Compose the requested gameplay features before the public length/quality
 * acceptance. Intermediate detours never replace the user's current map. */
export function generateDenseGameplay(source:Maze,parameters:Parameters,onProgress?:(s:string)=>void):Maze{
 let maze=generateDenseTraps(source,1,onProgress);
 if((parameters.routeTrapCount??0)>=2)maze=generateSecondDenseTrap(maze,onProgress,(parameters.loopTrapCount??0)>0);
 if((parameters.loopTrapCount??0)>0){
  const runtime=freeRuntime(maze),route=shortestPath(maze),onRoute=new Set(route),goal=portalPoint(maze,maze.exit),candidates:{id:string;score:number}[]=[];
  for(let i=1;i<route.length-1;i++){
   const cell=route[i]!,id=runtime.rooms[cell]!.id,module=maze.free!.modules.find(m=>m.id===id);if(module?.type!=='2x2')continue;
   const neighbor=(at:number)=>maze.free!.connections.find(c=>c.a.room===id&&c.b.room===runtime.rooms[at]!.id||c.b.room===id&&c.a.room===runtime.rooms[at]!.id);
   const port=(c:NonNullable<ReturnType<typeof neighbor>>)=>c.a.room===id?c.a:c.b,previous=neighbor(route[i-1]!),correct=neighbor(route[i+1]!);if(!previous||!correct)continue;
   const delta=(port(previous).edge-port(correct).edge+4)%4;if(delta!==1&&delta!==3)continue;
   const used=new Set(maze.free!.connections.flatMap(c=>c.a.room===id?[c.a.edge]:c.b.room===id?[c.b.edge]:[]));
   const free=[0,1,2,3].filter(edge=>!used.has(edge));if(free.length!==1)continue;
   for(const arm of runtime.passages[cell]!.filter(n=>n!==route[i-1]&&n!==route[i+1])){
    const seen=new Set([arm]),queue=[arm];for(const at of queue)for(const next of runtime.passages[at]!)if(next!==cell&&!seen.has(next)){seen.add(next);queue.push(next);}
    if(queue.some(c=>onRoute.has(c)))continue;
    const first=neighbor(arm);if(!first)continue;
    const a=runtime.centers[cell]!,dx=goal.x-a.x,dz=goal.z-a.z,len=Math.hypot(dx,dz),alignment=(edge:number)=>{const n=anchorGeometry(maze.free!,{room:id,edge,offset:0},1.4).normal;return (n.x*dx+n.z*dz)/len;};
    candidates.push({id,score:alignment(port(first).edge)+alignment(free[0]!)-2*alignment(port(correct).edge)});
   }
  }
  const reserved=maze.free!.cavityReport?.construction?.reservedReturnFork,ranked=[...new Map(candidates.map(c=>[c.id,c])).values()].sort((a,b)=>b.score-a.score),selected=parameters.freePassagePattern==='two-row-v1'&&reserved?ranked.find(c=>c.id===reserved):ranked[0];if(!selected||selected.score<=0)throw Error('Нет свободного углового модуля с двумя убедительными ложными входами для возвратного кольца.');
  const before=maze.free!.modules.length;maze=attachDenseReturnLoop(maze,selected.id,parameters.seed+'-dense-return-v1',onProgress);
  const report=maze.free!.cavityReport;if(report?.construction){report.construction.addedModules+=maze.free!.modules.length-before;report.construction.certifiedWalls=auditModuleWalls(maze.free!).walls.length;report.regions.push({id:'dense-return-v1',area:0,filledArea:0,blockedArea:0,status:'filled',cells:maze.free!.modules.length-before,doors:0,reason:'Подтверждённое возвратное кольцо: два ложных входа возвращаются к одной развилке. Его внешний пол не выдаётся за заполнение исходных внутренних полостей.'});}
 }
 return maze;
}
