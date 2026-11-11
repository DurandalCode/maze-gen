import type {Parameters,Point} from '../core/maze';
import type {FreeLayout,FreeModule,FreeZone} from './model';
import {seedFreeBridges} from './bridge-generate';
import {area,centroid} from './geometry';
export const zoneStyles=['branching','braided','winding'] as const;
export interface ZoneSeed {hubId:string;reservations:Point[][];owner:(room:string)=>FreeZone|undefined;fits:(zone:string,polygon:Point[])=>boolean}
/** Each ring consists of eight ordinary modules and eight physical portals,
 * not a hole in a single navigation node. A closed ring adds exactly one cycle. */
export function seedFreeZones(layout:FreeLayout,p:Parameters,origin:Point,angle:number,wallHeight:number,width:number):ZoneSeed{
 const count=p.freeZoneCount!,islands=p.freeIslandCount??count,middle=Math.floor(count/2),r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
 const rotate=(x:number,z:number):Point=>({x:origin.x+x*c-z*s,z:origin.z+x*s+z*c}),inverse=(p:Point)=>({x:(p.x-origin.x)*c+(p.z-origin.z)*s,z:-(p.x-origin.x)*s+(p.z-origin.z)*c});
 const centers=Array.from({length:count},(_,i)=>(i-(count-1)/2)*18),reservations:Point[][]=[];
 layout.zones=centers.map((_,i)=>({id:`zone-${i+1}`,title:`Зона ${i+1}`,style:zoneStyles[i%3]!}));
 const connect=(id:string,a:{room:string;edge:number;offset:number},b:{room:string;edge:number;offset:number})=>layout.connections.push({id,a,b,width});
 const ringIds:string[][]=[];
 for(let i=0;i<count;i++){
  const zone=layout.zones[i]!,x=centers[i]!,hx=i%3===1?6:5,hz=i%3===2?6:5,prefix=zone.id;
  const ring:[string,number,number,FreeModule['type'],number][]=[['nw',-hx,-hz,'2x2',0],['n',0,-hz,'2x6',0],['ne',hx,-hz,'2x2',0],['e',hx,0,'2x6',90],['se',hx,hz,'2x2',0],['s',0,hz,'2x6',0],['sw',-hx,hz,'2x2',0],['w',-hx,0,'2x6',90]];
  for(const [id,dx,dz,type,rotation]of ring)layout.modules.push({id:`${prefix}-${id}`,type,...rotate(x+dx,dz),angle:angle+rotation,zone:zone.id});
  const ids=ring.map(([id])=>`${prefix}-${id}`);ringIds.push(ids);
  // Local edges follow each physical module's rotation, not projected grid axes.
  const sides=[[1,3],[1,3],[2,3],[1,0],[3,1],[3,1],[0,1],[3,2]];
  for(let j=0;j<8;j++)if(i<islands||j!==7)connect(`${prefix}-ring-${j}`,{room:ids[j]!,edge:sides[j]![0]!,offset:0},{room:ids[(j+1)%8]!,edge:sides[j]![1]!,offset:0});
  if(i<islands)reservations.push([rotate(x-hx+1,-hz+1),rotate(x+hx-1,-hz+1),rotate(x+hx-1,hz-1),rotate(x-hx+1,hz-1)]);
 }
 for(let i=1;i<count;i++){
  const left=layout.modules.find(m=>m.id===ringIds[i-1]![3])!,right=layout.modules.find(m=>m.id===ringIds[i]![7])!,a={x:left.x+c,z:left.z+s},b={x:right.x-c,z:right.z-s},id=`zone-gateway-${i}`;
  layout.modules.push({id,type:'2x2',x:(a.x+b.x)/2,z:(a.z+b.z)/2,angle});
  connect(`${id}-left`,{room:left.id,edge:0,offset:0},{room:id,edge:3,offset:0});
  connect(`${id}-right`,{room:id,edge:1,offset:0},{room:right.id,edge:2,offset:0});
 }
 let hubId=ringIds[middle]![1]!;
 if(p.freeBridgeCount){
  const previousModules=layout.modules.length,previousSpaces=layout.spaces.length,x=centers[middle]!;
  const hz=middle%3===2?6:5,bridgeZ=hz+11+2*(p.freeBridgeCount-1);
  seedFreeBridges(layout,p.freeBridgeCount,rotate(x,bridgeZ),angle,wallHeight,width);
  for(const m of layout.modules.slice(previousModules))m.zone=layout.zones[middle]!.id;
  for(const room of layout.spaces.slice(previousSpaces))room.zone=layout.zones[middle]!.id;
  const id='zone-bridge-approach';layout.modules.push({id,type:'2x6',...rotate(x,hz+5),angle:angle+90,zone:layout.zones[middle]!.id});
  connect(`${id}-north`,{room:ringIds[middle]![5]!,edge:2,offset:0},{room:id,edge:3,offset:0});
  connect(`${id}-south`,{room:id,edge:1,offset:0},{room:'bridge-underpass',edge:0,offset:0});
  hubId='bridge-ground-detour';
 }
 const owner=(id:string)=>layout.zones!.find(z=>z.id===([...layout.modules,...layout.spaces].find(room=>room.id===id)?.zone));
 return {hubId,reservations,owner,fits:(zone,poly)=>{const index=layout.zones!.findIndex(z=>z.id===zone),x=centers[index]!;return poly.every(p=>{const v=inverse(p);return v.x>=x-8.8&&v.x<=x+8.8;});}};
}
export function freeZoneSummary(layout:FreeLayout){
 return (layout.zones??[]).map(zone=>{const modules=layout.modules.filter(m=>m.zone===zone.id),spaces=layout.spaces.filter(s=>s.zone===zone.id),points=[...modules.map(m=>({x:m.x,z:m.z})),...spaces.map(s=>centroid(s.polygon))];return {...zone,modules:modules.length,spaces:spaces.length,center:points.length?centroid(points):null,spaceArea:spaces.reduce((sum,s)=>sum+area(s.polygon),0)};}).filter(z=>z.modules+z.spaces>0);
}
