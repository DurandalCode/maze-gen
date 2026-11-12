import type {Point} from '../core/maze';
import type {Anchor,FreeLayout} from './model';
/** Two linked native circuits followed by two directional switchbacks.
 * Ordinary world-space growth fills the remaining inventory afterwards. */
export function seedSwitchbacks(layout:FreeLayout,origin:Point,angle:number,width=1.6,gap=3){
 const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
 // Gentle physical doglegs break aligned sightlines. Reserve enough of the
 // connector budget for the transverse displacement; both sides stay <= gap.
 const sway=Math.min(.65,gap*.25);let scale=(2+gap)/5;
 const atNative=(x:number,z:number):Point=>({x:origin.x+(x-10*scale)*c-(z-20*scale)*s,z:origin.z+(x-10*scale)*s+(z-20*scale)*c});
 const native=(x:number,z:number)=>({x:x*scale+sway*Math.sin(z*Math.PI/10),z:z*scale+sway*Math.sin(x*Math.PI/10)*Math.sin(Math.PI*(z+15)/70)+(z===-15?sway*(1-Math.cos(x*Math.PI/5))/2:0)});
 const at=(x:number,z:number)=>{const p=native(x,z);return atNative(p.x,p.z);};
 const ids=new Map<string,string>();let count=0,links=0;
 const module=(x:number,z:number)=>{const key=`${x}:${z}`;let id=ids.get(key);if(!id){id=`switch-${count++}`;ids.set(key,id);layout.modules.push({id,type:'2x2',...at(x,z),angle});}return id;};
 const chain=(points:[number,number][])=>{
  for(let i=0;i<points.length;i++)module(...points[i]!);
  for(let i=1;i<points.length;i++){
   const [x,z]=points[i-1]!,[u,v]=points[i]!,a=module(x,z),b=module(u,v),edge=u>x?1:u<x?3:v>z?2:0;
   if(layout.connections.some(link=>link.a.room===a&&link.b.room===b||link.a.room===b&&link.b.room===a))continue;
   layout.connections.push({id:`switch-link-${links++}`,a:{room:a,edge,offset:0},b:{room:b,edge:(edge+2)%4,offset:0},width});
  }
 };
 chain([[10,55],[10,50],[10,45],[10,40],[10,35],[10,30]]);
 chain([[10,50],[5,50],[0,50],[0,45],[0,40],[5,40],[10,40]]);

 chain([[10,30],[5,30],[0,30],[-5,30],[-10,30],[-10,25],[-10,20],[-5,20],[0,20],[5,20],[10,20],[15,20],[15,15],[15,10],[15,5],[15,0]]);
 chain([[10,30],[15,30],[20,30],[20,25],[20,20]]);
 chain([[15,0],[10,0],[5,0],[0,0],[-5,0],[-5,-5],[-5,-10],[-5,-15],[0,-15],[5,-15],[10,-15],[15,-15],[20,-15],[25,-15],[30,-15]]);
 chain([[15,0],[20,0],[25,0],[25,-5],[25,-10]]);
 chain([[-10,25],[-15,25],[-20,25],[-20,20],[-20,15],[-20,10],[-15,10],[-10,10],[-5,10],[0,10],[5,10],[5,15],[5,20]]);
 // Substantial two-leg alternatives throughout the route and both rings.
 // These are walkable blind branches, not terminal pockets used as counters.
 for(const branch of [
  [[0,45],[-5,45],[-5,50]],[[0,30],[0,35],[-5,35]],
  [[15,10],[20,10],[25,10]],[[-20,20],[-25,20],[-25,15]],
  [[-15,10],[-15,5],[-10,5]],[[0,10],[0,5],[-5,5]],
  [[5,0],[5,-5],[10,-5]],[[5,-15],[5,-10],[10,-10]],
  [[-5,-5],[-10,-5],[-10,0]],[[-5,-15],[-10,-15],[-10,-10]],
  [[20,-15],[20,-10],[15,-10]],
  [[20,30],[25,30],[25,25]],[[25,0],[30,0],[30,-5]],
  [[15,20],[15,25],[10,25]],
  [[0,20],[0,15],[-5,15]],
 ] as [number,number][][])chain(branch);
 // Solve the actual worst connector, including longitudinal sway. This keeps
 // the largest seed span exactly at the selected budget after deformation.
 const coordinates=new Map([...ids].map(([key,id])=>[id,key.split(':').map(Number) as [number,number]]));
 const maximum=()=>Math.max(...layout.connections.map(link=>{const a=native(...coordinates.get(link.a.room)!),b=native(...coordinates.get(link.b.room)!),dx=Math.abs(b.x-a.x),dz=Math.abs(b.z-a.z);return link.a.edge%2?Math.hypot(dx-2,dz):Math.hypot(dx,dz-2);}));
 let low=2.1/5,high=scale;
 for(let i=0;i<40;i++){scale=(low+high)/2;if(maximum()<=gap)low=scale;else high=scale;}
 scale=low;for(const m of layout.modules)Object.assign(m,at(...coordinates.get(m.id)!));
 const entrance:Anchor={room:module(10,55),edge:2,offset:0},exit:Anchor={room:module(30,-15),edge:0,offset:0};
 const fits=(poly:Point[])=>poly.every(p=>{const z=-(p.x-origin.x)*s+(p.z-origin.z)*c+20*scale;return z>=-15*scale-1-1e-7&&z<=55*scale+1+1e-7;});
 return {hubId:module(10,50),entrance,exit,fits,cycles:2,protected:new Set([module(10,30),module(15,0),module(20,20),module(25,-10),entrance.room,exit.room]),reservations:[[[1,40*scale+1],[10*scale-1,40*scale+1],[10*scale-1,50*scale-1],[1,50*scale-1]],[[-20*scale+1,10*scale+1],[5*scale-1,10*scale+1],[5*scale-1,20*scale-1],[-20*scale+1,20*scale-1]]].map(poly=>poly.map(([x,z])=>atNative(x!,z!)))};
}
