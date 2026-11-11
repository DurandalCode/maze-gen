import type {Point,Wall} from '../core/maze';
import {area,centroid,pointIn} from './geometry';
export interface FreeIsland {boundary:Point[];area:number;center:Point}
/** Trace actual closed wall components. An island has inaccessible interior
 * and walkable exterior; a plot perimeter has the opposite orientation. */
export function detectFreeIslands(panels:readonly Wall[],contains:(p:Point)=>boolean):FreeIsland[]{
 const key=(p:Point)=>`${Math.round(p.x*1e6)}:${Math.round(p.z*1e6)}`,nodes=new Map<string,Point>(),links=new Map<string,Set<string>>();
 for(const w of panels){const a={x:w.x1,z:w.z1},b={x:w.x2,z:w.z2},x=key(a),y=key(b);if(x===y)continue;nodes.set(x,a);nodes.set(y,b);if(!links.has(x))links.set(x,new Set());if(!links.has(y))links.set(y,new Set());links.get(x)!.add(y);links.get(y)!.add(x);}
 const seen=new Set<string>(),result:FreeIsland[]=[];
 for(const start of links.keys()){
  if(seen.has(start))continue;
  const component=[start];seen.add(start);for(const x of component)for(const y of links.get(x)!)if(!seen.has(y)){seen.add(y);component.push(y);}
  if(component.length<3||component.some(x=>links.get(x)!.size!==2))continue;
  const loop=[start];let previous='',at=start;
  do{const next=[...links.get(at)!].find(x=>x!==previous)!;previous=at;at=next;if(at!==start)loop.push(at);}while(at!==start&&loop.length<=component.length);
  if(at!==start||loop.length!==component.length)continue;
  const boundary=loop.map(x=>nodes.get(x)!),surface=area(boundary);if(surface<.1)continue;
  const signed=boundary.reduce((sum,p,i)=>{const q=boundary[(i+1)%boundary.length]!;return sum+p.x*q.z-q.x*p.z;},0),sign=Math.sign(signed);
  let eligible=0,checks=0;
  for(let i=0;i<boundary.length;i++){
   const a=boundary[i]!,b=boundary[(i+1)%boundary.length]!,length=Math.hypot(b.x-a.x,b.z-a.z);if(length<.2)continue;
   const p={x:(a.x+b.x)/2,z:(a.z+b.z)/2},nx=-(b.z-a.z)/length*sign*.1,nz=(b.x-a.x)/length*sign*.1;
   checks++;if(!contains({x:p.x+nx,z:p.z+nz})&&contains({x:p.x-nx,z:p.z-nz}))eligible++;
  }
  if(checks&&eligible/checks>.8){let center=centroid(boundary);if(!pointIn(center,boundary))center=boundary[0]!;result.push({boundary,area:surface,center});}
 }
 return result.sort((a,b)=>b.area-a.area);
}
