import type {Point} from '../core/maze';
import type {FreeDraft} from './model';
import {anchorGeometry,physical} from './layout';
/** Local construction envelope around the existing floor, clipped to the
 * real portal support planes. It is not a new rectangular maze boundary. */
export function sectorEnvelope(source:FreeDraft,margin:number):Point[]{
 const points=physical(source.layout).polygons.flatMap(p=>p).flatMap(p=>margin?Array.from({length:8},(_,i)=>({x:p.x+margin*Math.cos(i*Math.PI/4),z:p.z+margin*Math.sin(i*Math.PI/4)})):[p]),sorted=points.sort((a,b)=>a.x-b.x||a.z-b.z),cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x),low:Point[]=[],high:Point[]=[];
 for(const p of sorted){while(low.length>1&&cross(low.at(-2)!,low.at(-1)!,p)<=1e-8)low.pop();low.push(p);}for(const p of [...sorted].reverse()){while(high.length>1&&cross(high.at(-2)!,high.at(-1)!,p)<=1e-8)high.pop();high.push(p);}
 let polygon=[...low.slice(0,-1),...high.slice(0,-1)];
 const planes=[{x:0,z:0,nx:-1,nz:0},{x:source.parameters.columns,z:0,nx:1,nz:0},{x:0,z:0,nx:0,nz:-1},{x:0,z:source.parameters.rows,nx:0,nz:1},...source.layout.openings.filter(o=>o.id===source.layout.entrance||o.id===source.layout.exit).map(o=>{const g=anchorGeometry(source.layout,o,o.width);return {x:g.mid.x,z:g.mid.z,nx:g.normal.x,nz:g.normal.z};})];
 for(const plane of planes){const out:Point[]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,da=(a.x-plane.x)*plane.nx+(a.z-plane.z)*plane.nz,db=(b.x-plane.x)*plane.nx+(b.z-plane.z)*plane.nz;if(da<=1e-7)out.push(a);if((da<=1e-7)!==(db<=1e-7)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}}polygon=out;}
 return polygon;
}
