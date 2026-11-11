import type {Point} from '../core/maze';
import type {FreeLayout,FreeModule} from './model';
import {edges,ends,distance,lerp} from './geometry';
/** Reserve both stair footprints before organic growth can occupy them. This
 * connected seed has a ground detour and a lower corridor beneath each deck;
 * ordinary doorway growth, mixed modules, loops and quality checks follow. */
export function seedFreeBridges(layout:FreeLayout,count:number,center:Point,angle:number,wallHeight:number,width:number):void{
 const rise=Math.max(2.2,wallHeight+.3),run=Math.ceil(rise/.18)*.28,deck=4,half=run+deck/2+1;
 const radians=angle*Math.PI/180,rotate=(x:number,z:number):Point=>({x:center.x+x*Math.cos(radians)-z*Math.sin(radians),z:center.z+x*Math.sin(radians)+z*Math.cos(radians)});
 const zs=Array.from({length:count},(_,i)=>(i-(count-1)/2)*4),first=zs[0]!,last=zs.at(-1)!;
 const module=(id:string,x:number,z:number):FreeModule=>({id,type:'2x2',...rotate(x,z),angle});
 const addConnection=(id:string,a:FreeLayout['connections'][number]['a'],b:FreeLayout['connections'][number]['b'])=>layout.connections.push({id,a,b,width});
 for(let i=0;i<count;i++){
  const z=zs[i]!,a=`bridge-left-${i}`,b=`bridge-right-${i}`;
  layout.modules.push(module(a,-half,z),module(b,half,z));
  (layout.bridges??=[]).push({id:`bridge-${i+1}`,a:{room:a,edge:1,offset:0},b:{room:b,edge:3,offset:0},width:Math.min(width,1.4),rise,stairRun:run});
  if(i){addConnection(`bridge-left-link-${i}`,{room:`bridge-left-${i-1}`,edge:2,offset:0},{room:a,edge:0,offset:0});addConnection(`bridge-right-link-${i}`,{room:`bridge-right-${i-1}`,edge:2,offset:0},{room:b,edge:0,offset:0});}
 }
 const polygons=[
  {id:'bridge-underpass',kind:'corridor' as const,polygon:[rotate(-1,first-1),rotate(1,first-1),rotate(1,last+1),rotate(-1,last+1)]},
  {id:'bridge-ground-detour',kind:'corridor' as const,polygon:[rotate(-half-1,last+3),rotate(half+1,last+3),rotate(half+1,last+5),rotate(-half-1,last+5)]},
 ];
 layout.spaces.push(...polygons);
 addConnection('bridge-left-ground',{room:`bridge-left-${count-1}`,edge:2,offset:0},{room:'bridge-ground-detour',edge:0,offset:-half});
 addConnection('bridge-right-ground',{room:`bridge-right-${count-1}`,edge:2,offset:0},{room:'bridge-ground-detour',edge:0,offset:half});
 addConnection('bridge-under-ground',{room:'bridge-underpass',edge:2,offset:0},{room:'bridge-ground-detour',edge:0,offset:0});
 // Every long ground wall has visible, counted supports; no hidden long span.
 layout.supports??=[];
 for(const room of polygons)for(const wall of edges(room.polygon)){
  const [a,b]=ends(wall),pieces=Math.ceil(distance(a,b)/2.5);
  for(let i=0;i<=pieces;i++)layout.supports.push(lerp(a,b,i/pieces));
 }
}
