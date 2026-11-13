import type {Maze,Point} from '../core/maze';
import type {FreeDraft} from './model';
import {mazeDraft} from './json';
import {freeMaze,freeRuntime,physical} from './layout';
import {cavityInventory} from './cavity-inventory';
import {area,centroid,distance,pointIn} from './geometry';
import {polygonUnionBoundary} from './open-pockets';
import {promoteCavityConnectors} from './void-infill';
import {gatesFor,physicallyOpen} from './cavity-maze';
import {growCavityModules} from './cavity-module-growth';
import {openVortexBayCourts} from './vortex-hybrid-courts';
import {routeTraps,type RouteTraps} from '../analysis/route-traps';
import {shortestPath} from '../core/pathfinding';
import {auditModuleWalls} from './module-origin';
import {freeGroundLengths} from './path-limits';
const signed=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0)/2;

/** Inventory the finished route, including spaces created AFTER the initial
 * cavity pass. Open separate compact courts, not an entire enclosing hall. */
export function completeRouteCourtyards(base:Maze,onProgress?:(s:string)=>void):{maze:Maze;routeAnalysis:RouteTraps}{
 if(!base.free?.moduleConstruction||base.free.bridges?.length||base.free.preservedPanels)throw Error('Нужна подтверждённая одноэтажная модульная композиция.');
 onProgress?.('Проверяем ловушки и внутренние полости готовой карты.');
 const before=cavityInventory(base),runtime=freeRuntime(base),analysis=routeTraps(base),traps=analysis.candidates.filter(t=>t.qualifies),required=analysis.qualifiedCount;
 const critical=new Set(traps.flatMap(t=>[runtime.rooms[t.fork]!.id,runtime.rooms[t.correctAwayPath.at(-1)!]!.id])),excluded=new Set(critical);
 for(const t of traps){const queue=[t.falsePath[1]!],seen=new Set(queue);for(const at of queue)for(const n of runtime.passages[at]!)if(n!==t.fork&&!seen.has(n)){seen.add(n);queue.push(n);}queue.forEach(i=>excluded.add(runtime.rooms[i]!.id));}
 const stable=(d:FreeDraft,m=freeMaze(d,false))=>{const r=freeRuntime(m),path=new Set(shortestPath(m).map(i=>r.rooms[i]!.id));return [...critical].every(id=>path.has(id));};
 let checks=0;const reasons=new Map<string,Set<string>>(),opened:{area:number;polygon:Point[];id:string}[]=[];
 const note=(polygon:Point[],reason:string)=>{const c=centroid(polygon),key=c.x.toFixed(3)+':'+c.z.toFixed(3);if(!reasons.has(key))reasons.set(key,new Set());reasons.get(key)!.add(reason);};
 const prepared=mazeDraft(base);
 // Keep the actual trap entrances, false trees and retreat peak exact. Other
 // supported spans expose their side walls for ordinary courtyard doors.
 promoteCavityConnectors(prepared,new Set(prepared.layout.connections.filter(c=>excluded.has(c.a.room)||excluded.has(c.b.room)).map(c=>c.id)));
 let draft=!physicallyOpen(prepared)&&stable(prepared)?prepared:mazeDraft(base),serial=0,validated=true;
 const ids=new Set([...draft.layout.modules,...draft.layout.spaces,...draft.layout.connections,...draft.layout.openings].map(v=>v.id));
 const courtId=()=>{let id:string;do{id='post-route-court-'+serial++;}while(ids.has(id));ids.add(id);return id;};
 const history:FreeDraft[]=[mazeDraft(base)];
 // Each commit has already passed full geometry and capsule acceptance.
 const commit=(next:FreeDraft)=>{history.push(structuredClone(draft));draft=next;validated=true;};
 const addCompactCourts=()=>{
  const courts=polygonUnionBoundary(physical(draft.layout).polygons).filter(p=>signed(p)<-2.8&&area(p)<=24).map(p=>[...p].reverse()).sort((a,b)=>area(b)-area(a));
  for(const polygon of courts){
   if(opened.length>=10)break;
   const id=courtId(),available=gatesFor([{id,polygon,area:area(polygon)}],draft.layout).filter(g=>!excluded.has(g.parent.room)),pairs=[];
   for(let i=0;i<available.length;i++)for(let j=i+1;j<available.length;j++)if(available[i]!.parent.room!==available[j]!.parent.room)pairs.push([available[i]!,available[j]!]as const);
   pairs.sort((a,b)=>distance(b[0].from,b[1].from)-distance(a[0].from,a[1].from));
   const failures=new Set<string>();let accepted=false;
   for(const pair of pairs.slice(0,16)){
    const next=structuredClone(draft);next.layout.spaces.push({id,kind:'hall',polygon});pair.forEach((g,i)=>next.layout.connections.push({id:id+'-door-'+i,a:g.anchor,b:g.parent,width:g.width}));
    const physicalIssue=physicallyOpen(next);if(physicalIssue){failures.add(physicalIssue);continue;}
    const candidate=freeMaze(next,false),n=freeGroundLengths(candidate);if(n.straight>8+1e-7||n.run>16+1e-7){failures.add('Непрерывный физический путь превышает8/16.');continue;}
    if(!stable(next,candidate)){failures.add('Соединение обходит обязательную развилку или отступление Л.');continue;}
    commit(next);opened.push({area:area(polygon),polygon,id});accepted=true;onProgress?.(`После маршрута открыт двор ${area(polygon).toFixed(1)} м² через две существующие стены.`);break;
   }
   if(!accepted)note(polygon,!pairs.length?'Нет двух допустимых дверей вне защищённых ложных ветвей.':[...failures].slice(0,3).join(' '));
  }
 };
 addCompactCourts();
 const regions=before.records.filter(r=>r.state==='candidate'&&r.area>24).sort((a,b)=>Number(a.kind==='bay')-Number(b.kind==='bay')||b.area-a.area);
 for(const row of regions.slice(0,5)){
  if(row.area<=24)continue;
  onProgress?.('Проверяем модульное заполнение внутренней области '+row.area.toFixed(1)+' м².');
  const grown=growCavityModules(draft,row.polygon,base.parameters.seed+'|post-route-v1|'+row.id,2,onProgress,{limits:{straight:8,run:16},excludeRooms:excluded,maximumSpans:true,localPlacementCheck:true,maximumSpanFirst:true,lateral:false,diverse:true,throughRoutes:true,doorWidth:2,acceptCandidate:stable});
  if(grown.addedModules){commit(grown.draft);const ids=new Set(draft.layout.modules.map(m=>m.id)),known=new Set(draft.layout.moduleConstruction!.spans.map(c=>c.id));for(const c of draft.layout.connections)if(ids.has(c.a.room)&&ids.has(c.b.room)&&!known.has(c.id)){draft.layout.moduleConstruction!.spans.push(structuredClone(c));known.add(c.id);}promoteCavityConnectors(draft,new Set(draft.layout.connections.filter(c=>excluded.has(c.a.room)||excluded.has(c.b.room)).map(c=>c.id)));validated=false;addCompactCourts();}
  else note(row.polygon,grown.reason);
  if(row.kind==='bay'){
   onProgress?.('Проверяем выборочные связи во внутренней бухте '+row.area.toFixed(1)+' м².');
   const near=openVortexBayCourts(draft,row.polygon,base.parameters.seed+'|post-route-caps|'+row.id,excluded,{straight:8,run:16},stable,1,onProgress);if(near.opened.length)commit(near.draft);
   near.opened.forEach(c=>opened.push({id:c.id,area:c.area+c.spanArea,polygon:row.polygon}));if(!near.opened.length)note(row.polygon,near.reason);addCompactCourts();
  }
 }
 // Full perception is evaluated once at the atomic boundary. If a later
 // opening changed a trap, roll back complete construction steps; never
 // return a partially qualified map or repeatedly simulate every gate pair.
 onProgress?.('Проверяем ловушки после заполнения.');
 let result=freeMaze(draft,!validated),verified:RouteTraps|undefined;
 while(checks<16){checks++;const analysis=routeTraps(result);if(analysis.qualifiedCount>=required){verified=analysis;break;}const previous=history.pop();if(!previous)break;draft=previous;result=freeMaze(draft);}
 if(!verified)throw Error('Финальное заполнение не сохранило подтверждённые Л; исходная карта не изменена.');
 const surviving=new Set(draft.layout.spaces.map(s=>s.id));for(let i=opened.length-1;i>=0;i--)if(!surviving.has(opened[i]!.id)){note(opened[i]!.polygon,'Последний конструктивный шаг отменён после проверки Л.');opened.splice(i,1);}
 const after=cavityInventory(result),addedArea=after.floorArea-before.floorArea,addedModules=draft.layout.modules.length-base.free!.modules.length;
 if(addedArea<1e-6)throw Error('После маршрута не найдено дополнительного безопасного внутреннего прохода: '+[...reasons.values()].flatMap(s=>[...s]).slice(0,3).join(' '));
 const audit=auditModuleWalls(draft.layout);if(audit.issues.length)throw Error('У внутреннего прохода потеряна модульная опора.');
 if(JSON.stringify(draft.layout.modules.slice(0,base.free!.modules.length))!==JSON.stringify(base.free!.modules))throw Error('Финальное заполнение сдвинуло исходные модули.');
 const report=draft.layout.cavityReport!;
 report.postRoute={version:1,beforeNegativeArea:before.negativeArea,afterNegativeArea:after.negativeArea,beforeClosedArea:before.records.filter(r=>r.kind==='closed').reduce((s,r)=>s+r.area,0),afterClosedArea:after.records.filter(r=>r.kind==='closed').reduce((s,r)=>s+r.area,0),addedFloorArea:addedArea,addedModules,openedCourts:opened.length,checks,remaining:after.records.map(r=>({id:r.id,area:r.area,state:r.state,reason:r.reason}))};
 report.filledArea+=addedArea;report.blockedArea=after.records.filter(r=>r.state==='candidate').reduce((s,r)=>s+r.area,0);report.outsideArea=after.records.filter(r=>r.state!=='candidate').reduce((s,r)=>s+r.area,0);
 if(report.construction){report.construction.addedModules+=addedModules;report.construction.openedCourtyards+=opened.length;report.construction.certifiedWalls=audit.walls.length;}
 report.regions.push(...before.records.filter(r=>r.state==='candidate').map(r=>{const residual=after.records.filter(a=>pointIn(centroid(a.polygon),r.polygon)).reduce((s,a)=>s+a.area,0),filled=Math.max(0,r.area-residual),key=centroid(r.polygon);return{id:'post-route-'+r.id,area:r.area,filledArea:filled,blockedArea:Math.max(0,r.area-filled),status:filled>1e-6?'partial':'blocked',reason:(reasons.get(key.x.toFixed(3)+':'+key.z.toFixed(3))?[...reasons.get(key.x.toFixed(3)+':'+key.z.toFixed(3))!].slice(0,2).join(' '):filled>1e-6?'Две выборочные двери в существующих модульных стенах; обязательные Л сохранены.':'Область не открыта в фиксированном конструктивном проходе; это не доказательство геометрической непригодности.').slice(0,2900),cells:0,doors:0};}));
 onProgress?.(`Финальная гибридизация: ещё ${addedArea.toFixed(1)} м², дворов${opened.length}, настоящих новых рам${addedModules}; Л${required}.`);
 result.free!.cavityReport=structuredClone(report);
 return {maze:result,routeAnalysis:verified};
}
