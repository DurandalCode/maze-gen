import type {Maze,Point} from '../core/maze';
import {mazeDraft} from './json';
import {physical,freeMaze} from './layout';
import {cavityInventory} from './cavity-inventory';
import {detectFreeIslands} from './islands';
import {area,pointIn} from './geometry';
import {organicCharacter} from './organic-character';
import {auditModuleWalls} from './module-origin';
import {promoteCavityConnectors} from './void-infill';
import {gatesFor,physicallyOpen,type CavityLedger,type CavityMazeResult} from './cavity-maze';
import {growCavityModules} from './cavity-module-growth';
import {freeGroundLengths} from './path-limits';
function positive(poly:Point[]){return poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length]!;return s+p.x*q.z-q.x*p.z;},0)>0?poly:[...poly].reverse();}
/** Chambers are built by real modules and their connecting spans. Remaining
 * closed courtyards reuse those walls; there are no BSP partitions or support
 * posts invented to legitimise an otherwise unsupported fabric panel. */
export function generateModuleCavityMaze(base:Maze,onProgress?:(s:string)=>void):CavityMazeResult{
 if(!base.free||base.free.bridges?.length||base.free.preservedPanels)throw Error('Нужна исходная одноэтажная модульная геометрия.');
 const inventory=cavityInventory(base),baseModules=base.free.modules.length;let draft=mazeDraft(base),added=0;const ledger:CavityLedger[]=inventory.records.map(r=>({...r,status:r.state==='candidate'?'unprocessed':'excluded',filledArea:0,blockedArea:0,cells:0,doors:0,closedWalls:0,loops:0,components:[]}));
 for(const row of ledger){if(row.state!=='candidate')continue;const beforeModules=draft.layout.modules.length,beforePolygons=physical(draft.layout).polygons.reduce((s,p)=>s+area(p),0),reasons:string[]=[];for(let pass=0;pass<6&&draft.layout.modules.length-beforeModules<6;pass++){const result=growCavityModules(draft,row.polygon,base.parameters.seed+'-module-cavity-'+row.id+'-'+pass,6-(draft.layout.modules.length-beforeModules),onProgress);if(!result.addedModules){reasons.push(result.reason);break;}draft=result.draft;}const count=draft.layout.modules.length-beforeModules;added+=count;const growthArea=physical(draft.layout).polygons.reduce((s,p)=>s+area(p),0)-beforePolygons;row.filledArea=Math.max(0,growthArea);row.cells=count;row.components.push({area:Math.max(0,growthArea),state:count?'filled':'blocked',reason:count?`Добавлено настоящих модулей: ${count}.`:'В ограниченном поиске не найден дополнительный модульный маршрут: '+(reasons.join(' ')||'Нужны две доступные модульные опоры.')});onProgress?.(`Модульное заполнение: область ${row.id}, добавлено рам ${count}.`);}
 const moduleIds=new Set(draft.layout.modules.filter(m=>!m.frameOnly).map(m=>m.id));draft.layout.moduleConstruction={version:1,spans:structuredClone(draft.layout.connections.filter(c=>moduleIds.has(c.a.room)&&moduleIds.has(c.b.room)))};
 const construction=auditModuleWalls(draft.layout);if(construction.issues.length)throw Error('Модульная конструкция нарушена: '+construction.issues[0]!.message);
 const frameworkGeometry=organicCharacter(draft.layout),p=physical(draft.layout),courtyards=detectFreeIslands(p.panels,p.contains).filter(c=>c.area>=2.8);promoteCavityConnectors(draft);let opened=0,doors=0;
 for(const court of courtyards){const poly=positive(court.boundary),owner=ledger.find(r=>r.state==='candidate'&&poly.every(v=>pointIn(v,r.polygon))),id=`modular-court-${opened}`;if(!owner)continue;
  const cells=[{id,polygon:poly,area:court.area}],available=gatesFor(cells,draft.layout).sort((a,b)=>{const degree=(room:string)=>draft.layout.connections.filter(c=>c.a.room===room||c.b.room===room).length;return degree(b.parent.room)-degree(a.parent.room);});
  const make=(selected:typeof available)=>{const next=structuredClone(draft);next.layout.spaces.push({id,kind:'hall' as const,polygon:poly});selected.forEach((g,i)=>next.layout.connections.push({id:id+'-door-'+i,a:g.anchor,b:g.parent,width:g.width}));return next;};
  let accepted:ReturnType<typeof make>|undefined,selectedDoors=0;
  for(const first of available){const one=make([first]);if(physicallyOpen(one))continue;for(const second of available.filter(g=>g.parent.room!==first.parent.room)){const next=make([first,second]);if(physicallyOpen(next))continue;const limits=freeGroundLengths(freeMaze(next,false));if(limits.straight<=8+1e-7&&limits.run<=16+1e-7){accepted=next;selectedDoors=2;break;}}if(!accepted){const limits=freeGroundLengths(freeMaze(one,false));if(limits.straight<=8+1e-7&&limits.run<=16+1e-7){accepted=one;selectedDoors=1;}}if(accepted)break;}
  if(!accepted){owner.components.push({area:court.area,state:'blocked',reason:'Замкнутый двор не имеет безопасных дверей в существующих модульных стенах.'});continue;}
  draft=accepted;opened++;doors+=selectedDoors;owner.filledArea+=court.area;owner.cells++;owner.doors+=selectedDoors;owner.components.push({area:court.area,state:'filled',reason:`Открыт межмодульный двор; ${selectedDoors} выборочных дверей, новых самостоятельных стен нет.`});
 }
 for(const row of ledger){if(row.state!=='candidate')continue;row.filledArea=Math.min(row.area,row.filledArea);row.blockedArea=Math.max(0,row.area-row.filledArea);row.status=row.filledArea<1e-6?'blocked':row.blockedArea>1e-6?'partial':'filled';if(row.blockedArea>1e-6)row.components.push({area:row.blockedArea,state:'blocked',reason:'Остаток не замкнут допустимыми модульными стенами; нужны дополнительные реальные рамы, отдельные стойки не заменяют их.'});}
 const audit=auditModuleWalls(draft.layout);if(audit.issues.length)throw Error(audit.issues[0]!.message);
 draft.layout.cavityReport={seed:base.parameters.seed,baseGeometry:frameworkGeometry,construction:{baseModules,addedModules:added,openedCourtyards:opened,certifiedWalls:audit.walls.length},filledArea:ledger.reduce((s,r)=>s+r.filledArea,0),blockedArea:ledger.reduce((s,r)=>s+r.blockedArea,0),outsideArea:ledger.filter(r=>r.state!=='candidate').reduce((s,r)=>s+r.area,0),regions:ledger.map(r=>({id:r.id,area:r.area,filledArea:r.filledArea,blockedArea:r.blockedArea,status:r.state==='candidate'?r.status:r.state,reason:r.components.map(c=>c.reason).join(' ')||r.reason,cells:r.cells,doors:r.doors}))};
 const maze=freeMaze(draft);return {maze,ledger,filledArea:ledger.reduce((s,r)=>s+r.filledArea,0),chambers:added+opened,externalDoors:doors,internalDoors:0,closedWalls:0};
}
