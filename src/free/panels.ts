import type {Point,Wall} from '../core/maze';
import {distance,ends,segment} from './geometry';
/** Coincident native room boundaries are one editable wall. Leave all ordinary
 * non-overlapping panels in their original order and orientation; only shared
 * boundaries need normalising. Imported authoritative panels bypass this. */
export function nativePanels(input:Wall[]):Wall[]{
 type Group={origin:Point;dx:number;dz:number;entries:{wall:Wall;lo:number;hi:number}[];overlap:boolean};
 const groups=new Map<string,Group>(),owners=new Map<Wall,Group>(),valid:Wall[]=[];
 for(const wall of input){const [a,b]=ends(wall),length=distance(a,b);if(length<1e-7)continue;valid.push(wall);let dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;if(dx< -1e-9||Math.abs(dx)<=1e-9&&dz<0){dx=-dx;dz=-dz;}const offset=-dz*a.x+dx*a.z,key=`${Math.round(dx*1e8)}:${Math.round(dz*1e8)}:${Math.round(offset*1e7)}`;let g=groups.get(key);if(!g){g={origin:a,dx,dz,entries:[],overlap:false};groups.set(key,g);}const at=(p:Point)=>(p.x-g!.origin.x)*g!.dx+(p.z-g!.origin.z)*g!.dz,x=at(a),y=at(b);g.entries.push({wall,lo:Math.min(x,y),hi:Math.max(x,y)});owners.set(wall,g);}
 let shared=false;for(const g of groups.values()){const intervals=[...g.entries].sort((a,b)=>a.lo-b.lo);let end=-Infinity;for(const e of intervals){if(e.lo<end-1e-7){g.overlap=true;shared=true;break;}end=Math.max(end,e.hi);}}
 if(!shared)return valid;
 const result:Wall[]=[],emitted=new Set<Group>();for(const wall of valid){const g=owners.get(wall)!;if(!g.overlap){result.push(wall);continue;}if(emitted.has(g))continue;emitted.add(g);const points=g.entries.flatMap(e=>[e.lo,e.hi]).sort((a,b)=>a-b).filter((t,i,all)=>i===0||t-all[i-1]!>1e-7);for(let i=1;i<points.length;i++){const lo=points[i-1]!,hi=points[i]!,mid=(lo+hi)/2;if(!g.entries.some(e=>mid>e.lo-1e-7&&mid<e.hi+1e-7))continue;result.push(segment({x:g.origin.x+g.dx*lo,z:g.origin.z+g.dz*lo},{x:g.origin.x+g.dx*hi,z:g.origin.z+g.dz*hi}));}}
 return result;
}
