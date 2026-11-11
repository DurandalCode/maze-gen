import type {Maze,Point,Portal,Wall} from '../core/maze';
import type {PortalPrivacy} from '../analysis/portal-privacy';
import {freePortal,freeRuntime} from './layout';
import {freeSpatialRay} from './spatial-visibility';
/** Sufficient continuous certificate: every endpoint ray crosses the same
 * oriented physical panel. Never substitute its axis-aligned bounding box. */
export function separatesApertures(source:readonly Point[],gate:readonly Point[],wall:Wall):boolean{
 const dx=wall.x2-wall.x1,dz=wall.z2-wall.z1,length=Math.hypot(dx,dz);if(length<1e-8)return false;
 const local=(p:Point)=>({x:((p.x-wall.x1)*dx+(p.z-wall.z1)*dz)/length,z:((p.z-wall.z1)*dx-(p.x-wall.x1)*dz)/length}),a=source.map(local),b=gate.map(local),h=(wall.thickness??.06)/2;
 if(!((a.every(p=>p.z>h)&&b.every(p=>p.z< -h))||(a.every(p=>p.z< -h)&&b.every(p=>p.z>h))))return false;
 return a.every(p=>b.every(q=>{const t=-p.z/(q.z-p.z),x=p.x+t*(q.x-p.x);return x>=-h+1e-9&&x<=length+h-1e-9;}));
}
export function freePortalPrivacy(maze:Maze,portal:Portal,maxPocketCells:number,findWitness:boolean,excludedPanel=-1):PortalPrivacy{
 const r=freeRuntime(maze),opening=freePortal(maze,portal.freeId!),room=maze.free!.openings.find(o=>o.id===portal.freeId)!.room,start=r.rooms.findIndex(v=>v.id===room);
 if(start!==portal.cell)throw Error('Проём не соответствует пространству.');
 const pocket=[start];while(pocket.length<maxPocketCells){const next=maze.passages[pocket.at(-1)!]!.filter(n=>!pocket.includes(n));if(next.length!==1)break;pocket.push(next[0]!);}
 const inside=new Set(pocket),roomIds=new Set(pocket.map(i=>r.rooms[i]!.id)),gates:Wall[]=[];
 for(const e of r.links)if(inside.has(e.a)!==inside.has(e.b))gates.push(inside.has(e.a)?e.gateA:e.gateB);
 const source=[opening.from,opening.to],panels=r.panels.filter((w,i)=>i!==excludedPanel&&(w.y??0)<=1.7&&(w.y??0)+(w.height??maze.wallHeight)>=1.7),blockers=gates.map(g=>panels.find(w=>separatesApertures(source,[{x:g.x1,z:g.z1},{x:g.x2,z:g.z2}],w))).filter((w):w is Wall=>!!w);
 const inward=r.polygons.every(poly=>poly.every(p=>(p.x-opening.mid.x)*opening.normal.x+(p.z-opening.mid.z)*opening.normal.z<=1e-7));
 // A ground-plane certificate cannot certify an open view from an upper bridge.
 const groundPocket=!(maze.free!.bridges??[]).some(b=>roomIds.has(b.a.room)||roomIds.has(b.b.room)),covered=!maze.free!.bridges?.length||!!maze.roof;
 const other=maze.free!.openings.some(o=>o.id!==portal.freeId&&roomIds.has(o.room)),unbranched=maze.passages[start]!.length===1&&pocket.every(c=>maze.passages[c]!.length<=2),certified=inward&&groundPocket&&covered&&unbranched&&!other&&gates.length>0&&blockers.length===gates.length;
 const result:PortalPrivacy={portal:{...portal},certified,pocket,gates,blockers,reason:certified?'Полная ширина свободного проёма экранирована от выходов из локального кармана.':'Скрытность свободного проёма не доказана.'};
 if(findWitness&&!certified)for(let i=0;i<r.centers.length;i++)if(!inside.has(i))for(const target of source){const from=r.centers[i]!,length=Math.hypot(target.x-from.x,target.z-from.z);if(length<1e-8)continue;const ray=freeSpatialRay(maze,{...from,y:1.7},{x:(target.x-from.x)/length,z:(target.z-from.z)/length},length);if(ray.length>=length-1e-7){result.witness={cell:i,from,to:target,distance:length};return result;}}
 return result;
}
