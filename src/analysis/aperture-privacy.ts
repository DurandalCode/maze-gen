import type {Point,Portal,Wall} from '../core/maze';
import {FRAME_POST_SIZE} from '../core/structure';
import {CollisionWorld} from '../simulation/collisions';
import {bounds,pointIn,distance} from '../free/geometry';
export interface PortalPrivacy {portal:Portal;certified:boolean;pocket:number[];gates:Wall[];blockers:Wall[];reason:string;witness?:{cell:number;from:Point;to:Point;distance:number}}
export interface PrivacyScene {
 rooms:{polygon:Point[];holes:Point[][]}[];centers:Point[];passages:number[][];polygons:Point[][];
 links:{a:number;b:number;gateA:Wall;gateB:Wall}[];panels:Wall[];posts:Point[];wallHeight:number;
 opening:{room:number;from:Point;to:Point;mid:Point;normal:Point};portals:{room:number;key:string}[];key:string;
 visible:(from:Point,to:Point)=>boolean;allowPocket?:(pocket:number[])=>boolean;
}
/** All endpoint rays must cross one real oriented panel. */
export function separatesApertures(source:readonly Point[],gate:readonly Point[],wall:Wall):boolean{
 const dx=wall.x2-wall.x1,dz=wall.z2-wall.z1,length=Math.hypot(dx,dz);if(length<1e-8)return false;
 const local=(p:Point)=>({x:((p.x-wall.x1)*dx+(p.z-wall.z1)*dz)/length,z:((p.z-wall.z1)*dx-(p.x-wall.x1)*dz)/length}),a=source.map(local),b=gate.map(local),h=(wall.thickness??.06)/2;
 if(!((a.every(p=>p.z>h)&&b.every(p=>p.z< -h))||(a.every(p=>p.z< -h)&&b.every(p=>p.z>h))))return false;
 return a.every(p=>b.every(q=>{const t=-p.z/(q.z-p.z),x=p.x+t*(q.x-p.x);return x>=-h+1e-9&&x<=length+h-1e-9;}));
}
/** Exclude only aperture portions occupied by actual square support posts. */
function usable(a:Point,b:Point,posts:Point[]):Point[]{
 const length=distance(a,b);if(length<1e-8)return [];
 const ux=(b.x-a.x)/length,uz=(b.z-a.z)/length,trim=FRAME_POST_SIZE/2/Math.max(Math.abs(ux),Math.abs(uz)),lo=posts.some(p=>distance(p,a)<1e-7)?trim:0,hi=posts.some(p=>distance(p,b)<1e-7)?trim:0;
 if(lo+hi>=length)return [];return [{x:a.x+ux*lo,z:a.z+uz*lo},{x:b.x-ux*hi,z:b.z-uz*hi}];
}
export function certifyAperturePrivacy(scene:PrivacyScene,portal:Portal,maxPocket:number,findWitness:boolean):PortalPrivacy{
 const full=certifyPocket(scene,portal,maxPocket,false);if(full.certified)return full;
 // A nearer, fully screened gate is a stronger certificate. Enlarging an
 // already hidden vestibule up to a junction must not discard that proof.
 for(let size=1;size<maxPocket;size++){const local=certifyPocket(scene,portal,size,false);if(local.certified)return local;}
 return findWitness?certifyPocket(scene,portal,maxPocket,true):full;
}
function certifyPocket(scene:PrivacyScene,portal:Portal,maxPocket:number,findWitness:boolean):PortalPrivacy{
 const {opening,passages}=scene,start=opening.room;
 if(start<0||start!==portal.cell||!passages[start])throw Error('Проём не соответствует пространству.');
 const pocket=[start];while(pocket.length<maxPocket){const next=passages[pocket.at(-1)!]!.filter(n=>!pocket.includes(n));if(next.length!==1)break;pocket.push(next[0]!);}
 const inside=new Set(pocket),gates=scene.links.filter(e=>inside.has(e.a)!==inside.has(e.b)).map(e=>inside.has(e.a)?e.gateA:e.gateB),source=usable(opening.from,opening.to,scene.posts),panels=scene.panels.filter(w=>(w.y??0)<=1.7&&(w.y??0)+(w.height??scene.wallHeight)>=1.7);
 const blockers=gates.map(g=>{const gate=usable({x:g.x1,z:g.z1},{x:g.x2,z:g.z2},scene.posts);return source.length&&gate.length?panels.find(w=>separatesApertures(source,gate,w)):undefined;}).filter((w):w is Wall=>!!w);
 const inward=scene.polygons.every(poly=>poly.every(p=>(p.x-opening.mid.x)*opening.normal.x+(p.z-opening.mid.z)*opening.normal.z<=1e-7)),other=scene.portals.some(p=>inside.has(p.room)&&p.key!==scene.key),unbranched=passages[start]!.length===1&&pocket.every(c=>passages[c]!.length<=2);
 const certified=inward&&unbranched&&!other&&source.length>0&&gates.length>0&&blockers.length===gates.length&&(scene.allowPocket?.(pocket)??true),result:PortalPrivacy={portal:{...portal},certified,pocket,gates,blockers,reason:certified?'Полная ширина проёма экранирована от всех выходов из локального кармана.':'Скрытность не доказана; вариант не проходит обязательный фильтр.'};
 if(certified||!findWitness||!source.length)return result;
 const obstacles=[...scene.panels,...scene.posts.map(p=>({x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:FRAME_POST_SIZE}))];
 if(scene.rooms.length*45*obstacles.length>20_000_000)return result;
 const world=new CollisionWorld(obstacles),targets=[0,.25,.5,.75,1].map(t=>({x:source[0]!.x+(source[1]!.x-source[0]!.x)*t,z:source[0]!.z+(source[1]!.z-source[0]!.z)*t}));
 for(let cell=0;cell<scene.rooms.length;cell++)if(!inside.has(cell)){
  const room=scene.rooms[cell]!,box=bounds(room.polygon),points=[scene.centers[cell]!,...[box.x1+.251,(box.x1+box.x2)/2,box.x2-.251].flatMap(x=>[box.z1+.251,(box.z1+box.z2)/2,box.z2-.251].map(z=>({x,z})))];
  for(const from of points)if(pointIn(from,room.polygon)&&!room.holes.some(h=>pointIn(from,h))&&!world.blocked(from))for(const to of targets)if(scene.visible(from,to)){result.witness={cell,from,to,distance:distance(from,to)};result.reason='Есть прямая видимость проёма из основной области, включая диагонали.';return result;}
 }
 return result;
}
