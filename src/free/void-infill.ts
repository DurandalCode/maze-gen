import type {Maze,Point} from '../core/maze';
import type {FreeDraft} from './model';
import {CollisionWorld} from '../simulation/collisions';
import {freeGroundLengths} from './path-limits';
import {mazeDraft} from './json';
import {connectionGeometry,freeMaze,freeRuntime,physical,rooms,validateFree} from './layout';
import {detectFreeIslands} from './islands';
import {sharedPanels} from './shared-wall-infill';
import {area,distance,edges,ends,segmentDistance,segmentInside,segment,pointIn,simple} from './geometry';
const signed=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0);
/** Existing connector floors become ordinary native polygon rooms, retaining
 * the same panels and supports, so a real side doorway can open into a void. */
export function promoteCavityConnectors(d:FreeDraft){const l=d.layout,old=[...l.connections];l.connections=[];for(const c of old){const g=connectionGeometry(d.layout,c);if(distance(g.a.mid,g.b.mid)<1){l.connections.push(c);continue;}const id=`void-frame-${c.id}`;l.spaces.push({id,kind:'corridor',polygon:[g.a.from,g.b.to,g.b.from,g.a.to]});l.connections.push({id:c.id+'-a',a:c.a,b:{room:id,edge:3,offset:0},width:c.width},{id:c.id+'-b',a:{room:id,edge:1,offset:0},b:c.b,width:c.width});}}
export interface VoidInfillResult{maze:Maze;filled:{area:number;center:Point;doors:number;id:string}[];attempts:number}
/** Fill actual closed negative spaces in the existing organic floor boundary.
 * Their irregular outline is retained; surrounding floors/modules never move. */
export function fillOrganicVoids(base:Maze,maxVoids=4,onProgress?:(s:string)=>void):VoidInfillResult{
 if(!base.free||base.free.bridges?.length||base.free.preservedPanels)throw Error('Нужна одноэтажная свободная геометрия.');
 const original=physical(base.free),voids=detectFreeIslands(original.panels,original.contains).filter(v=>v.area>=4),draft=mazeDraft(base);delete draft.layout.preservedPanels;delete draft.layout.preservedSupports;promoteCavityConnectors(draft);
 const filled:VoidInfillResult['filled']=[];let attempts=0;
 for(const island of voids.slice(0,maxVoids)){
  const poly=signed(island.boundary)>0?[...island.boundary]:[...island.boundary].reverse(),id=`occupied-void-${filled.length}`,l=draft.layout;
  const candidates:{room:string;edge:number;offset:number;voidEdge:number;width:number}[]=[];
  for(const [voidEdge,wall]of edges(poly).entries()){
   const [a,b]=ends(wall),length=distance(a,b);if(length<1.4)continue;const width=Math.min(1.4,length-.12),mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
   if(width<1.1)continue;
   for(const room of rooms(l))for(const [edge,w]of edges(room.polygon).entries()){
    if(segmentDistance(a,w)>1e-6||segmentDistance(b,w)>1e-6)continue;
    const [p,q]=ends(w),len=distance(p,q),offset=((mid.x-p.x)*(q.x-p.x)+(mid.z-p.z)*(q.z-p.z))/len-len/2;
    if(Math.abs(offset)+width/2>len/2-1e-6)continue;
    const used=[...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings];if(used.some(o=>o.room===room.id&&o.edge===edge&&Math.abs(o.offset-offset)<(o.width+width)/2+.12))continue;
    candidates.push({room:room.id,edge,offset,voidEdge,width});
   }
  }
  // Spread openings around the actual cavity, rather than placing them all
  // beside the same branch. Every selected door must remain physically usable.
  candidates.sort((a,b)=>a.voidEdge-b.voidEdge);
  let accepted:FreeDraft|undefined,doorCount=0;
  const alternatives=Array.from({length:Math.max(1,candidates.length)},(_,i)=>[candidates[i]!,candidates[(i+1)%candidates.length]!]).filter(c=>c[0]&&c[1]&&c[0].room!==c[1].room);
  onProgress?.(`Граница ${island.area.toFixed(1)} м²: ${candidates.length} возможных дверей`);
  for(const count of [6,5,4,3,2,...alternatives.map(()=>-1)]){
   if(candidates.length<count)continue;
   const chosen=count===-1?alternatives.shift()!:Array.from({length:count},(_,i)=>candidates[Math.floor(i*candidates.length/count)]!);if(new Set(chosen.map(c=>c.room)).size<2)continue;
   const next=structuredClone(draft);next.layout.spaces.push({id,kind:'hall',polygon:poly});
   chosen.forEach((c,i)=>next.layout.connections.push({id:id+'-door-'+i,a:{room:id,edge:c.voidEdge,offset:0},b:{room:c.room,edge:c.edge,offset:c.offset},width:c.width}));
   attempts++;const normalized=sharedPanels(next),issues=validateFree(normalized);if(issues.length){onProgress?.(`Пустота ${island.area.toFixed(1)} м²: ${issues.map(i=>i.code).join(',')}`);continue;}accepted=next;doorCount=chosen.length;break;
  }
  if(accepted){draft.layout=accepted.layout;filled.push({area:area(poly),center:island.center,doors:doorCount,id});onProgress?.(`Открыта неправильная область ${island.area.toFixed(1)} м², дверей ${doorCount}`);}
 }
 if(!filled.length)throw Error('В существующих пустотах не найдены два физически проходимых входа.');
 draft.parameters={...draft.parameters,seed:base.parameters.seed+'-occupied-voids',routeTrapCount:0,loopTrapCount:0};
 return {maze:freeMaze(sharedPanels(draft)),filled,attempts};
}

/** Split an opened irregular cavity by a real fabric partition with a doorway.
 * A cut is accepted only when it crosses the polygon twice, preserving exactly
 * its existing footprint, and every old doorway still fits its original wall. */
export function partitionOpenedVoid(base:Maze,spaceId:string,enforceLimits=true):Maze{
 const source=mazeDraft(base),room=source.layout.spaces.find(s=>s.id===spaceId);if(!room)throw Error('Область не найдена.');
 const poly=room.polygon,boundary=edges(poly),cuts:{parts:Point[][];a:Point;b:Point;score:number}[]=[];
 for(let i=0;i<poly.length;i++)for(let j=i+2;j<poly.length;j++){
  if(i===0&&j===poly.length-1)continue;const a=poly[i]!,b=poly[j]!,length=distance(a,b);if(length<1.6||length>8)continue;
  if(!pointIn({x:(a.x+b.x)/2,z:(a.z+b.z)/2},poly,false)||!segmentInside(a,b,p=>pointIn(p,poly),boundary))continue;
  const parts=[poly.slice(i,j+1),[...poly.slice(j),...poly.slice(0,i+1)]];if(parts.some(p=>area(p)<5||!simple(p))||Math.abs(area(parts[0]!)+area(parts[1]!)-area(poly))>1e-5)continue;
  cuts.push({parts,a,b,score:Math.min(...parts.map(area))/area(poly)-length*.01});
 }
 cuts.sort((a,b)=>b.score-a.score);
 for(const cut of cuts.slice(0,12)){
  const {parts,a,b}=cut,next=structuredClone(source);delete next.layout.preservedPanels;delete next.layout.preservedSupports;next.layout.spaces=next.layout.spaces.filter(s=>s.id!==spaceId);parts.forEach((polygon,i)=>next.layout.spaces.push({id:spaceId+'-'+i,kind:'hall',polygon}));
  let invalid=false;for(const c of next.layout.connections)for(const side of ['a','b']as const)if(c[side].room===spaceId){const g=connectionGeometry(source.layout,source.layout.connections.find(old=>old.id===c.id)!)[side];let match=false;for(let i=0;i<parts.length;i++){const polygon=parts[i]!,edge=edges(polygon).findIndex(w=>segmentDistance(g.from,w)<1e-6&&segmentDistance(g.to,w)<1e-6);if(edge<0)continue;const p=polygon[edge]!,q=polygon[(edge+1)%polygon.length]!,len=distance(p,q);c[side]={room:spaceId+'-'+i,edge,offset:((g.mid.x-p.x)*(q.x-p.x)+(g.mid.z-p.z)*(q.z-p.z))/len-len/2};match=true;break;}if(!match)invalid=true;}
  if(invalid)continue;const cutWall=segment(a,b),cutEdges=parts.map(p=>edges(p).findIndex(w=>ends(w).every(v=>segmentDistance(v,cutWall)<1e-6)));if(cutEdges.some(i=>i<0))continue;
  next.layout.connections.push({id:spaceId+'-partition-door',a:{room:spaceId+'-0',edge:cutEdges[0]!,offset:0},b:{room:spaceId+'-1',edge:cutEdges[1]!,offset:0},width:1.4});
  next.layout.supports??=[];const steps=Math.ceil(distance(a,b)/2.5);for(let i=0;i<=steps;i++){if(Math.abs(i/steps-.5)*distance(a,b)<.85)continue;next.layout.supports.push({x:a.x+(b.x-a.x)*i/steps,z:a.z+(b.z-a.z)*i/steps});}
  const normalized=sharedPanels(next);if(validateFree(normalized).length)continue;const maze=freeMaze(normalized,false);
  if(enforceLimits){const lengths=freeGroundLengths(maze);if(lengths.straight>8+1e-7||lengths.run>16+1e-7)continue;}
  const runtime=freeRuntime(maze),world=new CollisionWorld([...runtime.panels,...runtime.posts.map(p=>({x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:.12}))]);let traversable=true;for(const path of runtime.edgePaths.values())for(let i=1;i<path.length;i++){const p=path[i-1]!,q=path[i]!,end=world.move(p,{x:q.x-p.x,z:q.z-p.z});if(distance(end,q)>1e-5)traversable=false;}if(traversable)return maze;
 }
 throw Error('Не найдена физически проходимая перегородка по форме области.');
}
