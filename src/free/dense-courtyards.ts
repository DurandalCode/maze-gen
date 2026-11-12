import type {Point} from '../core/maze';
import type {FreeDraft} from './model';
import {cavityInventory} from './cavity-inventory';
import {growCavityModules} from './cavity-module-growth';
import {freeMaze,physical} from './layout';
import {area,centroid,distance} from './geometry';
import {polygonUnionBoundary} from './open-pockets';
import {promoteCavityConnectors} from './void-infill';
import {gatesFor,physicallyOpen} from './cavity-maze';
import {auditModuleWalls} from './module-origin';
import {freeGroundLengths} from './path-limits';
export interface DenseAddition {polygon:Point[];area:number;modules:number;doors:number;reason:string}
export interface DenseCourtyards {draft:FreeDraft;additions:DenseAddition[];rejected:string[]}
const signed=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0)/2;
/** Versioned second pass. Re-inventory the remaining floor after each bridge:
 * its new frame offers different contacts and subdivides a large bay into
 * actual smaller courts. Original framework positions and spans never move. */
export function densifyCourtyards(source:FreeDraft,seed:string,onProgress?:(s:string)=>void):DenseCourtyards{
 let draft=source,serial=0;const additions:DenseAddition[]=[],rejected:string[]=[];
 const openClosed=()=>{
  const courts=polygonUnionBoundary(physical(draft.layout).polygons).filter(p=>signed(p)<-2.8&&area(p)<=24).map(p=>[...p].reverse()).sort((a,b)=>area(a)-area(b));
  for(const polygon of courts){
   const id='dense-court-'+serial++,available=gatesFor([{id,polygon,area:area(polygon)}],draft.layout),pairs:{a:typeof available[number];b:typeof available[number];distance:number}[]=[];
   for(let i=0;i<available.length;i++)for(let j=i+1;j<available.length;j++){const a=available[i]!,b=available[j]!;if(a.parent.room!==b.parent.room)pairs.push({a,b,distance:distance(centroid([a.from,a.to]),centroid([b.from,b.to]))});}
   pairs.sort((a,b)=>b.distance-a.distance);
   for(const pair of pairs.slice(0,16)){
    const trial=structuredClone(draft);trial.layout.spaces.push({id,kind:'hall',polygon});[pair.a,pair.b].forEach((gate,i)=>trial.layout.connections.push({id:id+'-door-'+i,a:gate.anchor,b:gate.parent,width:gate.width}));
    if(physicallyOpen(trial))continue;const length=freeGroundLengths(freeMaze(trial,false));if(length.straight>8+1e-7||length.run>16+1e-7||auditModuleWalls(trial.layout).issues.length)continue;
    draft=trial;additions.push({polygon,area:area(polygon),modules:0,doors:2,reason:'Открыта компактная часть после настоящего модульного разбиения; две выборочные двери.'});break;
   }
  }
 };
 for(let pass=0;pass<3;pass++){
  const remaining=cavityInventory(freeMaze(draft,false)).records.filter(r=>r.state==='candidate').sort((a,b)=>b.area-a.area);let changed=false;
  for(const row of remaining.slice(0,4)){
   const before=physical(draft.layout).polygons,result=growCavityModules(draft,row.polygon,seed+'-'+pass+'-'+row.id,4,onProgress);
   if(!result.addedModules){rejected.push(row.area.toFixed(2)+'м²: '+result.reason);continue;}
   draft=result.draft;
   const ids=new Set(draft.layout.modules.map(m=>m.id)),refs=draft.layout.moduleConstruction!.spans,known=new Set(refs.map(c=>c.id));
   for(const c of draft.layout.connections)if(ids.has(c.a.room)&&ids.has(c.b.room)&&!known.has(c.id))refs.push(structuredClone(c));
   const addedArea=physical(draft.layout).polygons.reduce((s,p)=>s+area(p),0)-before.reduce((s,p)=>s+area(p),0);
   additions.push({polygon:row.polygon,area:addedArea,modules:result.addedModules,doors:0,reason:result.reason});
   promoteCavityConnectors(draft);openClosed();changed=true;
   onProgress?.(`Уплотнение: +${additions.reduce((s,a)=>s+a.area,0).toFixed(1)}м², настоящих рам${additions.reduce((s,a)=>s+a.modules,0)}.`);
  }
  if(!changed)break;
 }
 return {draft,additions,rejected};
}
