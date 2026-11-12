import type {Maze} from '../core/maze';
import {portalPoint} from '../core/maze';
import type {Anchor,FreeDraft} from './model';
import {distance} from './geometry';
import {growCavityModules} from './cavity-module-growth';
import {sectorEnvelope} from './sector-envelope';
import {freeMaze,physical} from './layout';
import {routeDenseTraps} from './dense-trap-routing';
import {repairIntegratedRoutes} from './integrated-route-repair';
/** A retreat and return grown between real existing gates. Each new frame is
 * traversed between different sides; repairs close links inside the envelope. */
export function growOrganicDenseSector(source:Maze,base:FreeDraft,root:Anchor,target:Anchor,onProgress?:(s:string)=>void):FreeDraft{
 const module=base.layout.modules.find(m=>m.id===root.room)!,goal=portalPoint(source,source.exit);
 const grown=growCavityModules(base,sectorEnvelope(base,12),source.parameters.seed+'-integrated-sector-v1',7,onProgress,{
  root:root.room,target:target.room,rootAnchors:[-2.18,0,2.18].map(offset=>({...root,offset})),targetAnchors:[target],
  deferLengthCheck:true,minimumNewModules:4,maxDepth:7,minimumExitDistance:distance(module,goal)+8.1,exitPoint:goal,
  diverse:true,lateral:true,maximumSpanFirst:true,retainExcursion:true,targetApproachDistance:4,physicalExcursion:true,throughRoutes:true,
  acceptCandidate:d=>{const added=d.layout.modules.filter(m=>!base.layout.modules.some(b=>b.id===m.id)),angles=added.map(m=>(m.angle%90+90)%90).sort((a,b)=>a-b),span=90-Math.max(...angles.map((v,i)=>(angles[(i+1)%angles.length]!+(i===angles.length-1?90:0))-v));return added.length>=4&&span>=15-1e-7;}
 });
 if(!grown.addedModules)throw Error('Органический связующий сектор не помещается: '+grown.reason);
 const d=grown.draft,modules=new Set(d.layout.modules.map(m=>m.id)),known=new Set(d.layout.moduleConstruction!.spans.map(c=>c.id));
 for(const c of d.layout.connections)if(modules.has(c.a.room)&&modules.has(c.b.room)&&!known.has(c.id)){d.layout.moduleConstruction!.spans.push(structuredClone(c));known.add(c.id);}
 return d;
}

export function organicDenseSector(source:Maze,base:FreeDraft,root:Anchor,target:Anchor,onProgress?:(s:string)=>void):Maze{
 const d=growOrganicDenseSector(source,base,root,target,onProgress);
 const result=routeDenseTraps(freeMaze(d,false),2,onProgress,false,(maze,traps)=>repairIntegratedRoutes(maze,new Set(source.free!.modules.map(m=>m.id)),traps,onProgress));
 const report=result.free!.cavityReport;if(report?.construction){const added=result.free!.modules.length-source.free!.modules.length;report.construction.addedModules+=added;report.construction.certifiedWalls=physical(result.free!).panels.length;report.regions.push({id:'organic-sectors-v1',area:0,filledArea:0,blockedArea:0,status:'filled',cells:added,doors:0,reason:'Связующий органический сектор: индивидуально повёрнутые сквозные рамы и замыкания в существующие проходы. Без повторяющихся решётчатых сборок и наружных тупиковых ремонтных залов.'});}
 return result;
}
