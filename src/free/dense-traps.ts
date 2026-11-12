import type {Maze} from '../core/maze';
import {portalPoint} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
import {prepareNavigation,prepareOutline} from '../analysis/navigation';
import {routeTraps} from '../analysis/route-traps';
import {mazeDraft} from './json';
import {freeMaze,freeRuntime} from './layout';
import {distance} from './geometry';
import {growCavityModules} from './cavity-module-growth';
import {routeDenseTraps} from './dense-trap-routing';
import {auditModuleWalls} from './module-origin';
/** Requested dense traps are built after the chamber geometry, where the
 * actual cross-sector routes exist. The source v3 recipe with count zero is
 * untouched. Budgets are fixed; only fully qualified, physical maps return. */
export function generateDenseTraps(source:Maze,requested:number,onProgress?:(s:string)=>void):Maze{
 const route=shortestPath(source),runtime=freeRuntime(source),context=prepareNavigation(source);prepareOutline(source,context);const outline=context.outlineDistances!,goal=portalPoint(source,source.exit),pairs:{fork:number;root:string;target:string;minimum:number;distance:number}[]=[];
 let traversal=0;const modules=new Map(source.free!.modules.map(m=>[m.id,m]));
 for(let at=1;at<route.length-1;at++){
  const fork=route[at]!,before=new Set(route.slice(0,at));if(source.passages[fork]!.length<3)continue;
  const visit=(nodes:number[],length:number)=>{if(traversal++>=512)return;const last=nodes.at(-1)!,root=runtime.rooms[last]!.id;
   if(nodes.length>1&&modules.has(root)&&source.passages[last]!.length>=2){
    for(const target of source.free!.modules){const cell=runtime.rooms.findIndex(r=>r.id===target.id),separation=distance(runtime.centers[last]!,runtime.centers[cell]!);if(source.passages[cell]!.length!==1||cell===source.entrance.cell||cell===source.exit.cell||separation<4||separation>12||Math.abs(outline[cell]!-outline[last]!)>3)continue;
     pairs.push({fork,root,target:target.id,minimum:Math.ceil(outline[fork]!+8),distance:separation});
    }
   }
   if(nodes.length>=6)return;for(const next of source.passages[last]!){if(before.has(next)||nodes.includes(next)||outline[next]!<outline[last]!-1e-7)continue;const edge=context.edgeLengths!.get(last+':'+next)!;if(length+edge<=12)visit([...nodes,next],length+edge);}
  };visit([fork],0);
 }
 const unique=[...new Map(pairs.map(p=>[p.fork+'/'+p.root+'/'+p.target,p])).values()].sort((a,b)=>route.indexOf(a.fork)-route.indexOf(b.fork)||a.distance-b.distance),errors:string[]=[];
 for(const pair of unique.slice(0,2)){
  const draft=mazeDraft(source),polygon=[{x:0,z:0},{x:source.width,z:0},{x:source.width,z:source.depth},{x:0,z:source.depth}];
  const grown=growCavityModules(draft,polygon,source.parameters.seed+'-trap-sectors-v1',4,onProgress,{root:pair.root,target:pair.target,deferLengthCheck:true,minimumExitDistance:pair.minimum,exitPoint:goal});
  if(!grown.addedModules){errors.push(grown.reason);continue;}
  const ids=new Set(grown.draft.layout.modules.map(m=>m.id)),known=new Set(grown.draft.layout.moduleConstruction!.spans.map(c=>c.id));for(const c of grown.draft.layout.connections)if(ids.has(c.a.room)&&ids.has(c.b.room)&&!known.has(c.id))grown.draft.layout.moduleConstruction!.spans.push(structuredClone(c));
  try{
   const result=routeDenseTraps(freeMaze(grown.draft,false),requested,onProgress),analysis=routeTraps(result),report=result.free!.cavityReport,audit=auditModuleWalls(result.free!);
   if(audit.issues.length)throw Error(audit.issues[0]!.message);
   if(report){const extra=result.free!.modules.length-source.free!.modules.length;if(report.construction){report.construction.addedModules+=extra;report.construction.certifiedWalls=audit.walls.length;}report.regions.push({id:'route-trap-construction-v1',area:0,filledArea:0,blockedArea:0,status:'filled',cells:extra,doors:0,reason:`Новый модульный маршрут: дополнительных рам${extra}; подтверждённых Л${analysis.qualifiedCount}. Длинные двухкомнатные ложные ветви создают реальные решения. Исходные модульные рамы и дворы сохранены; площадь нового внешнего обхода не выдаётся за заполнение старых полостей.`});}
   return result;
  }catch(error){errors.push(String((error as Error).message));}
 }
 throw Error('Не построены запрошенные ловушки плотного гибрида. '+(errors.join(' ')||'Нет подходящих отдельных секторов для обязательного отхода.'));
}
