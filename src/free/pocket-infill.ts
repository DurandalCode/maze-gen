import type {Maze,Point} from '../core/maze';
import {mazeDraft} from './json';
import {freeMaze,freeRuntime,rooms,validateFree} from './layout';
import {area,distance,edges,ends,lerp,segmentDistance} from './geometry';
import {organicOpenPockets,type OpenPocket} from './open-pockets';
import {sharedPanels} from './shared-wall-infill';
import {partitionOpenedVoid} from './void-infill';
import {freeGroundLengths} from './path-limits';
import {CollisionWorld} from '../simulation/collisions';
export interface PocketInfillResult{maze:Maze;candidates:OpenPocket[];opened:{id:string;area:number;doors:number;mouth:number;center:Point}[];rejected:number;partitions:number}
/** Open organic inter-branch bays. The added cap is the sole boundary which
 * wasn't already an exterior wall of the surrounding free composition. */
export function fillOpenPockets(base:Maze,onProgress?:(s:string)=>void,onCheckpoint?:(m:Maze)=>void):PocketInfillResult{
 if(!base.free||base.free.bridges?.length||!base.free.spaces.some(s=>s.id.startsWith('occupied-void-')))throw Error('Нужна подготовленная органическая карта с открытыми внутренними областями.');
 const candidates=organicOpenPockets(base),opened:PocketInfillResult['opened']=[];let maze=base,rejected=0,partitions=0;
 for(const pocket of candidates){
  const draft=mazeDraft(maze),l=draft.layout,id=`open-pocket-${opened.length}`,poly=pocket.polygon;delete l.preservedPanels;delete l.preservedSupports;
  const slots:{room:string;edge:number;offset:number;pocketEdge:number;width:number}[]=[];
  for(const [pocketEdge,wall]of edges(poly).entries()){
   const [a,b]=ends(wall),length=distance(a,b);if(length<1.4)continue;const width=Math.min(1.4,length-.12),mid=lerp(a,b,.5);
   for(const room of rooms(l))for(const [edge,w]of edges(room.polygon).entries()){
    if(segmentDistance(a,w)>1e-6||segmentDistance(b,w)>1e-6)continue;const [p,q]=ends(w),len=distance(p,q),offset=((mid.x-p.x)*(q.x-p.x)+(mid.z-p.z)*(q.z-p.z))/len-len/2;
    if(Math.abs(offset)+width/2>len/2-1e-6)continue;
    const used=[...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings];if(used.some(o=>o.room===room.id&&o.edge===edge&&Math.abs(o.offset-offset)<(o.width+width)/2+.12))continue;
    slots.push({room:room.id,edge,offset,pocketEdge,width});
   }
  }
  slots.sort((a,b)=>a.pocketEdge-b.pocketEdge);let accepted:Maze|undefined,doors=0;
  for(const count of [8,6,4,3,2]){
   if(slots.length<count)continue;const chosen=Array.from({length:count},(_,i)=>slots[Math.floor(i*slots.length/count)]!);if(new Set(chosen.map(s=>s.room)).size<2)continue;
   const next=structuredClone(draft);next.layout.spaces.push({id,kind:'hall',polygon:poly});chosen.forEach((s,i)=>next.layout.connections.push({id:id+'-door-'+i,a:{room:id,edge:s.pocketEdge,offset:0},b:{room:s.room,edge:s.edge,offset:s.offset},width:s.width}));
   next.layout.supports??=[];const capA=poly.at(-1)!,capB=poly[0]!,steps=Math.ceil(distance(capA,capB)/2.5);for(let i=0;i<=steps;i++)next.layout.supports.push(lerp(capA,capB,i/steps));
   const normalized=sharedPanels(next);if(validateFree(normalized).length)continue;const candidate=freeMaze(normalized,false),r=freeRuntime(candidate),world=new CollisionWorld([...r.panels,...r.posts.map(p=>({x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:.12}))]);let clear=true;
   for(const path of r.edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});if(distance(end,b)>1e-5)clear=false;}if(!clear)continue;
   accepted=candidate;doors=count;break;
  }
  if(!accepted){rejected++;onProgress?.(`Карман ${pocket.area.toFixed(1)} м² оставлен: физические двери не подтвердились.`);continue;}
  maze=accepted;onCheckpoint?.(maze);opened.push({id,area:pocket.area,doors,mouth:pocket.mouth,center:pocket.center});onProgress?.(`Открыт карман ${pocket.area.toFixed(1)} м²: ${doors} дверей.`);
  // Real partitions keep large bays as branching rooms rather than one long
  // undivided hall. Preserve their irregular outside footprint exactly.
  const targets=()=>maze.free!.spaces.filter(s=>s.id.startsWith(id)&&area(s.polygon)>38).sort((a,b)=>area(b.polygon)-area(a.polygon));
  const tried=new Set<string>();for(let i=0;i<5;i++){const target=targets().find(s=>!tried.has(s.id));if(!target)break;tried.add(target.id);try{maze=partitionOpenedVoid(maze,target.id,false);partitions++;onCheckpoint?.(maze);onProgress?.(`Перегородка в ${target.id}.`);}catch{/* Keep the valid bay; final length check remains mandatory. */}}
 }
 if(!opened.length)throw Error('Не удалось открыть ни одного дополнительного кармана.');
 let limits=freeGroundLengths(maze);
 if(limits.straight>8||limits.run>16){const targets=maze.free!.spaces.filter(s=>s.id.startsWith('open-pocket-')&&area(s.polygon)>20).sort((a,b)=>area(b.polygon)-area(a.polygon));for(const target of targets){try{maze=partitionOpenedVoid(maze,target.id);partitions++;break;}catch{/* Try another actual room, without weakening the limit. */}}limits=freeGroundLengths(maze);}
 if(limits.straight>8+1e-7||limits.run>16+1e-7)throw Error(`Открытые области требуют дополнительных перегородок: ${limits.straight.toFixed(2)}/${limits.run.toFixed(2)} м.`);
 const result=mazeDraft(maze);result.parameters={...result.parameters,seed:base.parameters.seed+'-open-pockets',extraConnections:maze.free!.connections.length-rooms(maze.free!).length+1};maze=freeMaze(sharedPanels(result));
 return {maze,candidates,opened,rejected,partitions};
}
