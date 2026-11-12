import type {Maze} from '../core/maze';
import type {Anchor,FreeConnection,FreeDraft,FreeModule} from './model';
import {emptyLayout} from './model';
import {mazeDraft} from './json';
import {shortestPath} from '../core/pathfinding';
import {freeMaze,freeRuntime,anchorGeometry,connectionGeometry,modulePolygon,physical,validateFree} from './layout';
import {distance,ends,overlap} from './geometry';
import {maximumConnectionGap} from './connection-span';
import {promoteCavityConnectors} from './void-infill';
import {routeDenseTraps} from './dense-trap-routing';
import {routeTraps} from '../analysis/route-traps';
/** Replace a newly constructed long frame with three actual square frames.
 * External anchors keep their exact physical positions. Internal offset doors
 * leave no radius-clear common straight line, unlike a centre-point zigzag. */
export function squareFrameAssembly(draft:FreeDraft,id:string,prefix:string,baffled=false){
 const old=draft.layout.modules.find(m=>m.id===id);if(!old||old.type!=='2x6')throw Error('Нужна настоящая новая рама2×6.');
 const angle=old.angle*Math.PI/180,parts=[-2,0,2].map((x,i):FreeModule=>({id:prefix+'-'+i,type:'2x2',x:old.x+x*Math.cos(angle),z:old.z+x*Math.sin(angle),angle:old.angle}));
 draft.layout.modules=draft.layout.modules.filter(m=>m.id!==old.id);draft.layout.modules.push(...parts);
 for(const c of [...draft.layout.connections,...draft.layout.moduleConstruction!.spans])for(const side of ['a','b']as const)if(c[side].room===old.id){const a=c[side],piece=a.edge===1?2:a.edge===3?0:Math.max(0,Math.min(2,Math.floor(((a.edge===0?a.offset:-a.offset)+3)/2))),center=(piece-1)*2;c[side]={room:parts[piece]!.id,edge:a.edge,offset:a.edge===0?a.offset-center:a.edge===2?a.offset+center:a.offset};}
 if(baffled)for(let i=0;i<2;i++){const offset=i?.45:-.45;append(draft,{id:prefix+'-baffle-'+i,a:{room:parts[i]!.id,edge:1,offset},b:{room:parts[i+1]!.id,edge:3,offset:-offset},width:1});}
 return parts;
}
const append=(d:FreeDraft,c:FreeConnection)=>{d.layout.connections.push(c);d.layout.moduleConstruction!.spans.push(structuredClone(c));};
interface Site {root:string;anchor:Anchor;tail:string;join:Anchor;side:number}
/** Locate a later route fork and its neighbouring deep arm. The far arm frame
 * can be sectioned into real modules: one remains a false end, while the other
 * sections join a different sector through an existing supported boundary. */
function sites(source:Maze){
 const r=freeRuntime(source),route=shortestPath(source),onRoute=new Set(route),result:Site[]=[],width=1.4;
 const used=[...source.free!.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...source.free!.openings];
 for(let i=1;i<route.length-2;i++){
  const root=r.rooms[route[i]!]!.id,next=route[i+1]!,m=source.free!.modules.find(m=>m.id===root);if(m?.type!=='2x6'||source.free!.modules.find(m=>m.id===r.rooms[next]!.id)?.type!=='2x2')continue;
  for(const a of r.passages[next]!.filter(v=>!onRoute.has(v)))for(const b of r.passages[a]!.filter(v=>v!==next)){
   const tail=source.free!.modules.find(m=>m.id===r.rooms[b]!.id);if(!tail||!tail.id.startsWith('route-arm-')||tail.type!=='2x6'||r.passages[b]!.length!==1||r.passages[a]!.length!==2)continue;
   for(const side of [0,2])for(const other of source.free!.modules.filter(m=>m.id!==tail.id&&m.id!==root&&m.id!==r.rooms[next]!.id&&m.id!==r.rooms[a]!.id))for(let edge=0;edge<4;edge++){
    const join={room:other.id,edge,offset:0};if(used.some(o=>o.room===join.room&&o.edge===edge&&Math.abs(o.offset)<(o.width+width)/2+.12))continue;
    const connection={id:'probe',a:{room:tail.id,edge:side,offset:0},b:join,width};let g;try{g=connectionGeometry(source.free!,connection);}catch{continue;}if(g.sides.some(w=>distance(...ends(w))>3+1e-7)||distance(g.a.mid,g.b.mid)<.2)continue;
    const vector={x:g.b.mid.x-g.a.mid.x,z:g.b.mid.z-g.a.mid.z};if(vector.x*g.a.normal.x+vector.z*g.a.normal.z<=0||-vector.x*g.b.normal.x-vector.z*g.b.normal.z<=0)continue;
    for(const rootEdge of [0,2]){const anchor={room:root,edge:rootEdge,offset:0};if(used.some(o=>o.room===root&&o.edge===rootEdge&&Math.abs(o.offset)<(o.width+width)/2+.12))continue;result.push({root,anchor,tail:tail.id,join,side});}
   }
  }
 }
 return [...new Map(result.map(v=>[JSON.stringify(v),v])).values()];
}
/** A finite gate-relative apex/return construction, fitted to the actual arm
 * and its neighbouring sector. It supplements the dense geometry, not replaces
 * it with a fixed maze. No source world coordinates or module IDs are used. */
/** returnLoopReady is an internal atomic stage: the requested return loop
 * supplies its next real decision. Public generateFree enforces8/16 after
 * that loop; this intermediate body is never saved or returned by the UI. */
export function generateSecondDenseTrap(source:Maze,onProgress?:(s:string)=>void,returnLoopReady=false):Maze{
 const sourceModules=source.free!.modules,baseline=sourceModules.filter(m=>!m.id.startsWith('route-arm-')),width=Math.min(1.4,source.parameters.corridorWidth);let hash=2166136261;for(const c of source.parameters.seed)hash=Math.imul(hash^c.charCodeAt(0),16777619);const prefix='dense-apex-'+(hash>>>0).toString(16),failures=new Set<string>();let finalChecks=0;
 for(const site of sites(source).slice(0,4)){
  const base=mazeDraft(source),parts=squareFrameAssembly(base,site.tail,prefix+'-tail');
  append(base,{id:prefix+'-tail-door',a:{room:parts[1]!.id,edge:1,offset:0},b:{room:parts[2]!.id,edge:3,offset:0},width});
  append(base,{id:prefix+'-sector-door',a:{room:parts[1]!.id,edge:site.side,offset:0},b:site.join,width});
  if(validateFree(base,false).length)continue;
  const originalFloor=physical(base.layout).polygons;
  for(const offset of [1,0,2,-1,-2])for(const span of [3,2.5,2,1.5,1,.75,.5])for(const bend of (returnLoopReady?[0]:[-30,-15,0,15])){
   const draft=structuredClone(base);let from={...site.anchor,offset},bad=false;
   const steps:readonly [FreeModule['type'],number,number,number,number,number?,number?,number?][]=[['2x6',1,0,3,3],['2x2',2,0,3,1],['2x6',3,0,3,1],['2x6',0,0,3,3],['2x6',3,0,3,1],['2x6',3,0,span,returnLoopReady?0:1,returnLoopReady?-2.18:0],...(returnLoopReady?[
    ['2x6',3,0,3,2,-2.18],['2x6',0,0,3,3],['2x6',1,0,3,3,0,Math.min(2,source.parameters.corridorWidth),-2.3]
   ] as [FreeModule['type'],number,number,number,number,number?,number?,number?][]:[['2x2',0,bend,3,3] as [FreeModule['type'],number,number,number,number]])];
   for(let i=0;i<steps.length;i++){
    const [type,incoming,turn,wanted,outgoing,outOffset=0,stepWidth=width,lateral=0]=steps[i]!,a=anchorGeometry(draft.layout,from,stepWidth),angle=((Math.atan2(-a.normal.z,-a.normal.x)*180/Math.PI+turn-[-90,0,90,180][incoming]!)%360+360)%360,module:FreeModule={id:prefix+'-'+i,type,x:0,z:0,angle},anchor={room:module.id,edge:incoming,offset:0},gate=anchorGeometry({...emptyLayout(),modules:[module]},anchor,stepWidth),tangent={x:-a.normal.z*lateral,z:a.normal.x*lateral},shifted={...gate,from:{x:gate.from.x+tangent.x,z:gate.from.z+tangent.z},to:{x:gate.to.x+tangent.x,z:gate.to.z+tangent.z}},gap=maximumConnectionGap(a,shifted,wanted);
    if(gap<.1){bad=true;break;}module.x=a.mid.x+a.normal.x*gap+tangent.x-gate.mid.x;module.z=a.mid.z+a.normal.z*gap+tangent.z-gate.mid.z;
    const polygon=modulePolygon(module);if(polygon.some(p=>p.x<0||p.z<0||p.x>source.width||p.z>source.depth)||originalFloor.some(p=>overlap(polygon,p))||physical(draft.layout).polygons.some(p=>overlap(polygon,p))){bad=true;break;}
    draft.layout.modules.push(module);append(draft,{id:prefix+'-span-'+i,a:from,b:anchor,width:stepWidth,spanAudit:{desired:3,actual:wanted,...(wanted<3?{reason:'Подгонка замыкания к существующему модульному сектору; исходные рамы не сдвигаются.'}:{})}});from={room:module.id,edge:outgoing,offset:outOffset};
   }
   if(bad)continue;
   append(draft,{id:prefix+'-return',a:from,b:{room:parts[2]!.id,edge:1,offset:0},width});const g=connectionGeometry(draft.layout,draft.layout.connections.at(-1)!);if(g.sides.some(w=>distance(...ends(w))>3+1e-7))continue;
   const candidateIssues=validateFree(draft,false);if(candidateIssues.length){if(failures.size<4)failures.add(candidateIssues[0]!.message);continue;}
   for(const module of [...draft.layout.modules].filter(m=>m.id.startsWith(prefix+'-')&&m.type==='2x6'))squareFrameAssembly(draft,module.id,module.id+'-frame',true);
   promoteCavityConnectors(draft);const nav=freeRuntime(freeMaze(draft,false));if(nav.paths.some(p=>!p)){if(failures.size<4)failures.add('Для одного из новых стыков нет капсульного прохода.');continue;}
   if(finalChecks++>=2)throw Error('Исчерпаны две полные сборки второй ловушки. '+[...failures].join(' '));
   try{
    const result=routeDenseTraps(freeMaze(draft,false),2,onProgress,returnLoopReady);if(routeTraps(result).qualifiedCount<2)continue;
    if(baseline.some(old=>JSON.stringify(result.free!.modules.find(m=>m.id===old.id))!==JSON.stringify(old)))throw Error('Изменена исходная плотная рама.');
    const report=result.free!.cavityReport;if(report?.construction){report.construction.addedModules+=result.free!.modules.length-sourceModules.length;report.construction.certifiedWalls=physical(result.free!).panels.length;report.regions.push({id:prefix,area:0,filledArea:0,blockedArea:0,status:'filled',cells:result.free!.modules.length-sourceModules.length,doors:0,reason:'Вторая полноценная маршрутная ловушка: новый модульный обход соединяет существующие секторы. Вспомогательные длинные рамы собраны из реальных2×2 со смещёнными метровыми дверями; исходные рамы плотной основы и дворы сохранены.'});}
    return result;
   }catch(error){failures.add(String((error as Error).message));}
  }
 }
 throw Error('Не построена вторая полноценная ловушка на плотной основе. '+[...failures].join(' '));
}
