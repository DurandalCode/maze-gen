import type{Maze,Point}from'../core/maze';
import type{FreeDraft}from'./model';
import{mazeDraft}from'./json';
import{freeMaze,freeRuntime,physical}from'./layout';
import{cavityInventory}from'./cavity-inventory';
import{growCavityModules}from'./cavity-module-growth';
import{growVortexBay}from'./vortex-hybrid-growth';
import{openVortexBayCourts}from'./vortex-hybrid-courts';
import{vortexDistrictStructure}from'./vortex-district-structure';
import{routeTraps}from'../analysis/route-traps';
import{loopTraps}from'../analysis/loop-traps';
import{shortestPath}from'../core/pathfinding';
import{area,pointIn}from'./geometry';
import{detectFreeIslands}from'./islands';
import{gatesFor,physicallyOpen}from'./cavity-maze';

import{auditModuleWalls}from'./module-origin';
import{freeGroundLengths,freeLengthLimits}from'./path-limits';
const positive=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0)>0?p:[...p].reverse();
/** Real frames close small parts of negative-space bays. Courtyard walls are
 * exclusively those frames and their existing supported connector sides. */
export function generateVortexHybrid(base:Maze,onProgress?:(s:string)=>void):Maze{
 if(!base.free||!base.parameters.freeVortexContinuous)throw Error('Межспиральные дворы требуют непрерывный вортекс.');
 const r=freeRuntime(base),districts=vortexDistrictStructure(base),traps=routeTraps(base).candidates.filter(t=>t.qualifies),critical=new Set([...districts.map(d=>d.fork!),...traps.map(t=>r.rooms[t.fork]!.id)]),protectedRooms=new Set(districts.flatMap(d=>[d.fork!,...d.members]));
 for(const t of traps){protectedRooms.add(r.rooms[t.fork]!.id);const queue=[t.falsePath[1]!],seen=new Set(queue);for(const at of queue)for(const n of r.passages[at]!)if(n!==t.fork&&!seen.has(n)){seen.add(n);queue.push(n);}queue.forEach(i=>protectedRooms.add(r.rooms[i]!.id));}
 const guarded=base.parameters.freeVortexHybridRevision==='atomic-turns-v2',baseRoute=shortestPath(base).map(i=>r.rooms[i]!.id),localChoices=new Map([...critical].map(id=>{const at=baseRoute.indexOf(id);return[id,[baseRoute[at-1],baseRoute[at+1]]];}));
 const qualified=(draft:FreeDraft)=>{if(!guarded)return true;const m=freeMaze(draft,false);return routeTraps(m).qualifiedCount>=(base.parameters.routeTrapCount??0)&&loopTraps(m).qualifiedCount>=(base.parameters.loopTrapCount??0);};
 if(!qualified(mazeDraft(base)))throw Error('До заполнения не подтверждены исходные Л/К нового профиля.');
 const stable=(draft:FreeDraft)=>{const m=freeMaze(draft,false),runtime=freeRuntime(m),path=new Set(shortestPath(m).map(i=>runtime.rooms[i]!.id));if(guarded){const ordered=shortestPath(m).map(i=>runtime.rooms[i]!.id);if([...localChoices].some(([id,neighbors])=>{const at=ordered.indexOf(id);return ordered[at-1]!==neighbors[0]||ordered[at+1]!==neighbors[1];}))return false;}const trees=traps.every(t=>{const fork=runtime.rooms.findIndex(q=>q.id===r.rooms[t.fork]!.id),first=runtime.rooms.findIndex(q=>q.id===r.rooms[t.falsePath[1]!]!.id),seen=new Set([first]),queue=[first];for(const at of queue)for(const n of runtime.passages[at]!)if(n!==fork&&!seen.has(n)){seen.add(n);queue.push(n);}const edges=queue.reduce((s,c)=>s+runtime.passages[c]!.filter(n=>seen.has(n)).length,0)/2;return !queue.some(c=>path.has(runtime.rooms[c]!.id))&&edges===queue.length-1;});return trees&&[...critical].every(id=>path.has(id))&&vortexDistrictStructure(m).every((d,i)=>d.doorsAtFork===2&&d.members.length===districts[i]!.members.length&&d.members.every(id=>districts[i]!.members.includes(id))&&d.members.every(id=>runtime.passages[runtime.rooms.findIndex(q=>q.id===id)]!.length===2));};
 const treeExcluded=new Set([...districts.flatMap(d=>[d.fork!,...d.members]),...critical,...traps.flatMap(t=>[r.rooms[t.falsePath[1]!]!.id,r.rooms[t.deadEnd]!.id])]);
 const inventory=cavityInventory(base),limits=freeLengthLimits(base.parameters),original=JSON.stringify(base.free.modules),ledger=inventory.records.map(row=>({...row,filledArea:0,addedModules:0,openedCourts:0,reason:row.reason}));let draft=mazeDraft(base),added=0,opened=0;
 for(const row of ledger.filter(row=>row.state==='candidate'&&row.kind==='bay')){
  const checkpoint=draft,before=physical(draft.layout).polygons.reduce((s,p)=>s+area(p),0),start=draft.layout.modules.length;
  const spread=growVortexBay(draft,row.polygon,base.parameters.seed+'|spread|'+row.id,18,treeExcluded,limits,stable,onProgress);draft=spread.draft;row.reason=spread.reason;
  for(let pass=0;pass<3;pass++){
   const result=growCavityModules(draft,row.polygon,base.parameters.seed+'|hybrid-v1|'+row.id+'|'+pass,4,onProgress,{limits,excludeRooms:protectedRooms,maximumSpans:true,doorWidth:2,acceptCandidate:stable});
   if(!result.addedModules){row.reason=result.reason;break;}draft=result.draft;
  }
  if(!qualified(draft)){draft=checkpoint;row.reason='Область оставлена незаполненной: новые рамы меняют квалифицированный ложный выбор на исходной развилке.';}
  row.addedModules=draft.layout.modules.length-start;added+=row.addedModules;row.filledArea=Math.max(0,physical(draft.layout).polygons.reduce((s,p)=>s+area(p),0)-before);onProgress?.(`Межспиральная область ${row.id}: настоящих новых рам ${row.addedModules}.`);
 }
 draft.layout.moduleConstruction={version:1,spans:structuredClone(draft.layout.connections)};
 for(const row of ledger.filter(row=>row.state==='candidate'&&row.kind==='bay')){const result=openVortexBayCourts(draft,row.polygon,base.parameters.seed+'|courts|'+row.id,protectedRooms,limits,stable,3,onProgress);if(!qualified(result.draft)){row.reason+=' Открытие дворов отменено: меняются квалифицированные Л/К.';continue;}draft=result.draft;row.filledArea+=result.opened.reduce((s,c)=>s+c.area+c.spanArea,0);row.openedCourts+=result.opened.length;opened+=result.opened.length;row.reason+=' '+result.reason;}

 const courts=detectFreeIslands(physical(draft.layout).panels,physical(draft.layout).contains).filter(c=>c.area>=2.8&&c.area<=24).sort((a,b)=>a.area-b.area);
 for(const court of courts){
  const polygon=positive(court.boundary),owner=ledger.find(row=>row.kind==='bay'&&row.state==='candidate'&&polygon.every(p=>pointIn(p,row.polygon)));if(!owner||owner.openedCourts>=2)continue;
  const id='vortex-hybrid-court-'+opened,available=gatesFor([{id,polygon,area:court.area}],draft.layout).filter(g=>!protectedRooms.has(g.parent.room));let accepted:FreeDraft|undefined;
  const pairs=[];for(let i=0;i<available.length;i++)for(let j=i+1;j<available.length;j++)if(available[i]!.parent.room!==available[j]!.parent.room)pairs.push([available[i]!,available[j]!]as const);
  for(const pair of pairs.slice(0,12)){
   const trial=structuredClone(draft);trial.layout.spaces.push({id,kind:'hall',polygon});pair.forEach((g,i)=>trial.layout.connections.push({id:id+'-door-'+i,a:g.anchor,b:g.parent,width:g.width}));
   if(physicallyOpen(trial)||!stable(trial)||!qualified(trial))continue;const n=freeGroundLengths(freeMaze(trial,false));if(n.straight>limits.straight+1e-7||n.run>limits.run+1e-7)continue;accepted=trial;break;
  }
  if(accepted){draft=accepted;owner.filledArea+=court.area;owner.openedCourts++;opened++;onProgress?.(`Открыт неправильный двор ${court.area.toFixed(1)} м² через две существующие стены.`);}
 }
 if(!added||!opened)throw Error('Не удалось построить межспиральный гибрид с настоящими рамами и проходимыми дворами; исходные карты сохранены.');
 if(JSON.stringify(draft.layout.modules.slice(0,base.free.modules.length))!==original)throw Error('Гибрид изменил исходные спиральные рамы.');
 const audit=auditModuleWalls(draft.layout);if(audit.issues.length)throw Error(audit.issues[0]!.message);
 const result=freeMaze(draft,false),dead=routeTraps(result),loops=loopTraps(result);if(dead.qualifiedCount<(base.parameters.routeTrapCount??0)||loops.qualifiedCount<(base.parameters.loopTrapCount??0))throw Object.assign(Error(`Межспиральные связи нарушили ловушки: Л${dead.qualifiedCount}/К${loops.qualifiedCount}.`),{diagnosticDraft:draft});
 draft.layout.cavityReport={seed:base.parameters.seed,construction:{baseModules:base.free.modules.length,addedModules:added,openedCourtyards:opened,certifiedWalls:audit.walls.length},filledArea:ledger.reduce((s,row)=>s+row.filledArea,0),blockedArea:ledger.filter(row=>row.state==='candidate'&&row.kind==='bay').reduce((s,row)=>s+Math.max(0,row.area-row.filledArea),0),outsideArea:ledger.filter(row=>row.state!=='candidate'||row.kind==='closed').reduce((s,row)=>s+row.area,0),regions:ledger.map(row=>({id:row.id,area:row.area,filledArea:row.filledArea,blockedArea:row.state==='candidate'&&row.kind==='bay'?Math.max(0,row.area-row.filledArea):0,status:row.filledArea?'partial':row.kind==='closed'?'protected':row.state,reason:row.kind==='closed'?'Сохранена чистая возвратная петля: её внутренние стены и двери не меняются.':row.reason,cells:row.addedModules+row.openedCourts,doors:row.openedCourts*2}))};
 onProgress?.(`Гибрид: новых рам ${added}, открыто дворов ${opened}; Л${dead.qualifiedCount}/К${loops.qualifiedCount}.`);return freeMaze(draft,false);
}
