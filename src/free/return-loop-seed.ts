import type {Point} from '../core/maze';
import type {Anchor,FreeLayout} from './model';
/** Native return circuit with two doors at one fork, plus a separate retreat trap. */
export function seedReturnLoop(layout:FreeLayout,origin:Point,angle=20,width=1.6,connected=false){
 const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 const at=(x:number,z:number)=>{const dx=connected?.2*Math.cos(z*Math.PI/5):0,dz=connected?(z===-30?.2+.2*(1-Math.cos(x*Math.PI/5)):.2*Math.cos(x*Math.PI/5)):0,X=(x-15)*.9+dx,Z=(z+7.5)*.9+dz;return {x:origin.x+X*c-Z*s,z:origin.z+X*s+Z*c};};
 const ids=new Map<string,string>();let n=0,k=0;
 const module=(x:number,z:number)=>{const key=`${x}:${z}`;let id=ids.get(key);if(!id){id=`return-${n++}`;ids.set(key,id);layout.modules.push({id,type:'2x2',...at(x,z),angle});}return id;};
 const chain=(p:[number,number][])=>{for(const [x,z]of p)module(x,z);for(let i=1;i<p.length;i++){const [x,z]=p[i-1]!,[u,v]=p[i]!,from=module(x,z),to=module(u,v),edge=u>x?1:u<x?3:v>z?2:0;if(!layout.connections.some(c=>c.a.room===from&&c.b.room===to||c.a.room===to&&c.b.room===from))layout.connections.push({id:`return-link-${k++}`,a:{room:from,edge,offset:0},b:{room:to,edge:(edge+2)%4,offset:0},width});}};
 chain([[-10,15],[-10,10],[-10,5],[-10,0],[-5,0],[0,0],[0,5],[0,10],[5,10],[10,10],[15,10],[20,10],[25,10],[25,5],[25,0],[30,0],[35,0],[40,0],[45,0],[45,-5],[45,-10],[45,-15],[45,-20],[40,-20],[35,-20],[30,-20],[25,-20],[20,-20],[15,-20],[10,-20],[5,-20],[0,-20],[-5,-20],[-10,-20],[-10,-25],[-10,-30]]);
 chain([[0,0],[5,0],[10,0],[15,0],[15,-5],[15,-10],[10,-10],[5,-10],[0,-10],[0,-5],[0,0]]);
 chain([[25,0],[25,-5],[25,-10],[25,-15],[20,-15]]);
 for(const branch of [
  [[10,10],[10,15],[15,15]],[[35,0],[35,5],[40,5]],
  [[45,-10],[50,-10],[50,-5]],[[35,-20],[35,-15],[30,-15]],
  [[20,-20],[20,-25],[25,-25]],[[5,-20],[5,-15],[0,-15]],
  [[-10,-20],[-15,-20],[-15,-25]],[[15,-5],[20,-5],[20,0]],
  [[5,-10],[5,-5],[10,-5]],
 ] as [number,number][][])chain(branch);
 if(connected){
  // Crosslinks between the early and later route sections. The qualified
  // return circuit keeps its sole attachment; the false trap stays a tree.
  chain([[15,15],[20,15],[20,10]]);chain([[15,15],[15,10]]);
  chain([[25,-25],[30,-25],[35,-25],[35,-20]]);
  // Several long, bent blind branches, rather than one compulsory backbone.
  for(const branch of [
   [[-10,5],[-15,5],[-20,5],[-20,0]],[[0,10],[0,15],[-5,15],[-5,10]],
   [[10,0],[10,5],[5,5]],[[40,5],[45,5]],
   [[45,0],[50,0],[55,0],[55,5]],[[45,-20],[50,-20],[55,-20],[55,-15]],
   [[25,-5],[30,-5],[35,-5]],[[0,-15],[-5,-15]],[[-15,-25],[-15,-30]],
   [[30,-25],[30,-30],[35,-30],[40,-30]],
  ] as [number,number][][])chain(branch);
 }
 const entrance:Anchor={room:module(-10,15),edge:2,offset:0},exit:Anchor={room:module(-10,-30),edge:0,offset:0};
 return {entrance,exit,cycles:connected?4:1,coordinates:ids};
}
