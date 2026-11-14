import type {Maze,Point,Wall} from '../core/maze';
import {supportColliders} from '../core/structure';
import {freeRuntime} from './layout';
import {bridgeGeometry,bridgeUprights} from './bridges';
import {pointIn} from './geometry';
const cross=(a:Point,b:Point):Point=>({x:(a.y??0)*b.z-a.z*(b.y??0),y:a.z*b.x-a.x*b.z,z:a.x*(b.y??0)-(a.y??0)*b.x});
const dot=(a:Point,b:Point)=>a.x*b.x+a.z*b.z+(a.y??0)*(b.y??0);
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,z:a.z-b.z,y:(a.y??0)-(b.y??0)});
function triangle(origin:Point,direction:Point,a:Point,b:Point,c:Point):number|null{
 const u=sub(b,a),v=sub(c,a),h=cross(direction,v),det=dot(u,h);if(Math.abs(det)<1e-10)return null;
 const s=sub(origin,a),t=dot(s,h)/det;if(t<0||t>1)return null;
 const q=cross(s,u),w=dot(direction,q)/det;if(w<0||t+w>1)return null;
 const distance=dot(v,q)/det;return distance>1e-7?distance:null;
}
function prism(origin:Point,direction:Point,w:Wall,height:number):number|null{
 const dx=w.x2-w.x1,dz=w.z2-w.z1,length=Math.hypot(dx,dz),ux=length?dx/length:1,uz=length?dz/length:0,h=(w.thickness??.06)/2;
 const ox=origin.x-w.x1,oz=origin.z-w.z1;
 let lo=0,hi=Infinity;
 for(const [p,d,min,max]of [[ox*ux+oz*uz,direction.x*ux+direction.z*uz,-h,length+h],[-ox*uz+oz*ux,-direction.x*uz+direction.z*ux,-h,h],[origin.y??0,direction.y??0,w.y??0,(w.y??0)+(w.height??height)]]){
  if(Math.abs(d!)<1e-12){if(p!<min!||p!>max!)return null;continue;}
  const a=(min!-p!)/d!,b=(max!-p!)/d!;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));if(lo>hi)return null;
 }
 return hi>1e-7?lo:null;
}
const scenes=new WeakMap<Maze,{runtime:ReturnType<typeof freeRuntime>;columns:Wall[];bridges:ReturnType<typeof bridgeGeometry>[]}>();
/** Continuous 3D sight through oriented walls, decks, sloped stair enclosures and
 * covered roofs. No projected bounding box can create a false upper/lower link. */
export function freeSpatialRay(maze:Maze,from:Point,direction:Point,limit:number,cue?:'sun'|'forest'):{length:number;strength:number}{
 let scene=scenes.get(maze);if(!scene){scene={runtime:freeRuntime(maze),columns:[...supportColliders(maze),...bridgeUprights(maze.free!,maze.wallHeight)],bridges:(maze.free!.bridges??[]).map(b=>bridgeGeometry(maze.free!,b))};scenes.set(maze,scene);}
 const r=scene.runtime,hits:{distance:number;fabric?:boolean;roof?:boolean}[]=[];
 const hit=(distance:number|null,fabric=false,roof=false)=>{if(distance!==null&&distance<limit)hits.push({distance,fabric,roof});};
 for(const wall of r.panels)hit(prism(from,direction,{...wall,y:wall.y??0,height:wall.height??maze.wallHeight},maze.wallHeight),true);
 for(const wall of scene.columns)hit(prism(from,direction,wall,maze.wallHeight));
 const quad=(a:Point,b:Point,c:Point,d:Point,fabric=false,roof=false)=>{
  const distances=[triangle(from,direction,a,b,c),triangle(from,direction,a,c,d)].filter((v):v is number=>v!==null);
  if(distances.length)hit(Math.min(...distances),fabric,roof);
 };
 for(const g of scene.bridges){
  const bridge=g.bridge,offset=(p:Point,side:number,y=0):Point=>({x:p.x-g.uz*side,z:p.z+g.ux*side,y:p.y!+y});
  for(let i=1;i<g.path.length;i++){
   const a=g.path[i-1]!,b=g.path[i]!,h=bridge.width/2;
   for(const side of [-h,h]){const p=offset(a,side),q=offset(b,side);quad(p,q,{...q,y:q.y!+maze.wallHeight},{...p,y:p.y!+maze.wallHeight},true);if(Math.abs(p.y!-q.y!)>1e-8)quad({...p,y:0},{...q,y:0},q,p);}
   quad(offset(a,-h),offset(b,-h),offset(b,h),offset(a,h));
   quad(offset(a,-h,maze.wallHeight),offset(b,-h,maze.wallHeight),offset(b,h,maze.wallHeight),offset(a,h,maze.wallHeight),true,true);
  }
  for(const p of [g.path[1]!,g.path[2]!])quad({...offset(p,-bridge.width/2),y:0},{...offset(p,bridge.width/2),y:0},offset(p,bridge.width/2),offset(p,-bridge.width/2));
 }
 if(maze.roof&&Math.abs(direction.y??0)>1e-12){
  const t=(maze.wallHeight-(from.y??0))/direction.y!,p={x:from.x+direction.x*t,z:from.z+direction.z*t};
  if(t>1e-7&&([...r.rooms.map(r=>({polygon:r.polygon,holes:r.holes})),...r.connections.map(c=>({polygon:c.polygon,holes:[]}))]).some(s=>pointIn(p,s.polygon)&&!s.holes.some(h=>pointIn(p,h))))hit(t,true,true);
 }
 hits.sort((a,b)=>a.distance-b.distance);let strength=1;
 for(const h of hits){if(cue==='sun'&&maze.translucentFabric&&h.fabric){strength*=(h.roof?.55:.35)*(maze.fabricTransmissionStrength??1);if(strength>=.2)continue;}return {length:h.distance,strength:0};}
 return {length:limit,strength};
}
