import type {Maze,Point,Wall} from '../core/maze';
import {freeRuntime,freeAnalysisMaze,localRoute} from './layout';
import {distance,edges,ends,intersection,pointIn,segment,segmentInside,movementClearance,centroid} from './geometry';
type Runtime=ReturnType<typeof freeRuntime>;
interface Region {polygon:Point[];holes:Point[][];room?:number;connection?:number}
interface Aperture {a:number;b:number;mid:Point;left:Point;right:Point;wall:Wall}
const radius=.25,reach=.35;
/** Intervals where the crossing capsule meets a remaining oriented solid.
 * Distance to a convex solid along a translated segment is convex. Bisection
 * retains thin blockers and posts instead of sampling past them. */
function blockedInterval(w:Wall,at:(t:number,side:number)=>Point,project:(p:Point)=>Point,length:number):[number,number]|null{
 const dx=w.x2-w.x1,dz=w.z2-w.z1,d=Math.hypot(dx,dz),ux=d?dx/d:1,uz=d?dz/d:0,h=(w.thickness??.06)/2;
 const corners=[[-h,-h],[d+h,-h],[d+h,h],[-h,h]].map(([x,z])=>project({x:w.x1+ux*x!-uz*z!,z:w.z1+uz*x!+ux*z!}));
 if(Math.min(...corners.map(p=>p.z))>reach+radius||Math.max(...corners.map(p=>p.z))< -reach-radius)return null;
 const lo=Math.max(0,Math.min(...corners.map(p=>p.x))-radius),hi=Math.min(length,Math.max(...corners.map(p=>p.x))+radius);if(hi<=lo)return null;
 const clearance=(t:number)=>movementClearance(at(t,-reach),at(t,reach),w),blocked=(t:number)=>clearance(t)<radius-1e-8;
 let a=lo,b=hi;for(let i=0;i<35;i++){const p=(2*a+b)/3,q=(a+2*b)/3;if(clearance(p)<clearance(q))b=q;else a=p;}
 const minimum=(a+b)/2;if(!blocked(minimum))return null;
 a=lo;b=minimum;if(!blocked(a))for(let i=0;i<35;i++){const m=(a+b)/2;if(blocked(m))b=m;else a=m;}const left=blocked(lo)?lo:(a+b)/2;
 a=minimum;b=hi;if(!blocked(b))for(let i=0;i<35;i++){const m=(a+b)/2;if(blocked(m))a=m;else b=m;}return [left,blocked(hi)?hi:(a+b)/2];
}
function apertures(base:Runtime,wall:Wall,obstacles:Wall[],regions:Region[]):Aperture[]{
 const length=distance(...ends(wall));if(length<1e-7)return [];
 const ux=(wall.x2-wall.x1)/length,uz=(wall.z2-wall.z1)/length,at=(t:number,n:number):Point=>({x:wall.x1+ux*t-uz*n,z:wall.z1+uz*t+ux*n}),project=(p:Point):Point=>({x:(p.x-wall.x1)*ux+(p.z-wall.z1)*uz,z:-(p.x-wall.x1)*uz+(p.z-wall.z1)*ux});
 const cuts=[0,length],forbidden:([number,number])[]=[];
 for(const r of regions)for(const side of [-reach,reach])for(const edge of [...edges(r.polygon),...r.holes.flatMap(edges)]){
  const t=intersection(at(0,side),at(length,side),...ends(edge));if(t!==null)cuts.push(t*length);
  for(const p of ends(edge)){const q=project(p);if(q.x>0&&q.x<length)cuts.push(q.x);}
 }
 for(const obstacle of obstacles){const interval=blockedInterval(obstacle,at,project,length);if(interval){forbidden.push(interval);cuts.push(...interval);}}
 cuts.sort((a,b)=>a-b);const windows:{lo:number;hi:number;a:number;b:number}[]=[],owner=(p:Point)=>regions.findIndex(r=>pointIn(p,r.polygon,false)&&!r.holes.some(h=>pointIn(p,h)));
 for(let i=1;i<cuts.length;i++){
  const lo=cuts[i-1]!,hi=cuts[i]!,t=(lo+hi)/2;if(hi-lo<1e-6||forbidden.some(([a,b])=>t>a-1e-7&&t<b+1e-7))continue;
  const left=at(t,-reach),right=at(t,reach),a=owner(left),b=owner(right);
  if(a<0||b<0||a===b||!segmentInside(left,right,base.contains,base.boundaries))continue;
  // Continuous clearance of the entire crossing, with all original posts retained.
  if(obstacles.some(w=>movementClearance(left,right,w)<radius-1e-7))continue;
  const previous=windows.at(-1);if(previous&&previous.a===a&&previous.b===b&&Math.abs(previous.hi-lo)<1e-6)previous.hi=hi;else windows.push({lo,hi,a,b});
 }
 return windows.map(({lo,hi,a,b})=>{const t=(lo+hi)/2;return {a,b,mid:at(t,0),left:at(t,-reach),right:at(t,reach),wall:segment(at(lo,0),at(hi,0))};});
}
/** Remove exactly one physical panel. The accessible union, islands, remaining
 * panels, posts and upper bridge edges are retained. Added decisions are local
 * junctions at physically traversable apertures, never projected grid neighbours. */
export function removeFreePanel(maze:Maze,index:number):Maze{
 const base=freeRuntime(maze),wall=base.panels[index];if(!wall)throw Error('Панель не найдена.');
 const panels=base.panels.filter((_,i)=>i!==index),posts=base.posts.map(p=>({...segment(p,p),thickness:.12})),obstacles=[...panels,...posts];
 const layout={...maze.free!,preservedPanels:panels,walls:[],supports:base.posts},r:Runtime={...base,panels,obstacles,rooms:[...base.rooms],centers:[...base.centers],links:[...base.links],passages:base.rooms.map(()=>[]),edgePaths:new Map(),paths:[],portalPaths:new Map(base.portalPaths),analysisStart:base.rooms.length};
 const regions:Region[]=[...base.rooms.map((room,i)=>({...room,room:i})),...base.connections.map((c,i)=>({polygon:c.polygon,holes:[],connection:i}))],openings=apertures(base,wall,obstacles,regions),converted=new Map<number,number>();
 const addRoom=(polygon:Point[],center:Point)=>{const i=r.rooms.length;r.rooms.push({id:`panel-analysis-${i}`,polygon,holes:[]});r.centers.push(center);r.passages.push([]);return i;};
 const owner=(region:number):number=>{
  const v=regions[region]!;if(v.room!==undefined)return v.room;if(converted.has(region))return converted.get(region)!;
  const c=base.connections[v.connection!]!,old=r.links.find(e=>e.connection===c.id)!;
  const center=centroid(c.polygon),node=addRoom(c.polygon,center);converted.set(region,node);r.links=r.links.filter(e=>e!==old);
  r.links.push({a:old.a,b:node,from:old.from,to:old.openingA,points:[old.from,old.openingA],openingA:old.openingA,openingB:old.openingA,gateA:old.gateA,gateB:old.gateA},{a:node,b:old.b,from:old.openingB,to:old.to,points:[old.openingB,old.to],openingA:old.openingB,openingB:old.openingB,gateA:old.gateB,gateB:old.gateB});return node;
 };
 for(const o of openings){
  const a=owner(o.a),b=owner(o.b),dx=o.right.x-o.left.x,dz=o.right.z-o.left.z,l=Math.hypot(dx,dz),nx=dx/l*.15,nz=dz/l*.15,tx=-nz,tz=nx;
  const node=addRoom([{x:o.mid.x-nx-tx,z:o.mid.z-nz-tz},{x:o.mid.x+nx-tx,z:o.mid.z+nz-tz},{x:o.mid.x+nx+tx,z:o.mid.z+nz+tz},{x:o.mid.x-nx+tx,z:o.mid.z-nz+tz}],o.mid);
  r.links.push({a,b:node,from:o.left,to:o.mid,points:[o.left,o.mid],openingA:o.mid,openingB:o.mid,gateA:o.wall,gateB:o.wall},{a:node,b,from:o.mid,to:o.right,points:[o.mid,o.right],openingA:o.mid,openingB:o.mid,gateA:o.wall,gateB:o.wall});
 }
 const interiorRooms=new Set<number>();
 for(const [i,room]of base.rooms.entries()){
  const cuts=[0,1];for(const edge of edges(room.polygon)){const t=intersection(...ends(wall),...ends(edge));if(t!==null)cuts.push(t);}cuts.sort((a,b)=>a-b);
  for(let j=1;j<cuts.length;j++){const t=(cuts[j-1]!+cuts[j]!)/2,p={x:wall.x1+(wall.x2-wall.x1)*t,z:wall.z1+(wall.z2-wall.z1)*t};if(pointIn(p,room.polygon,false))interiorRooms.add(i);}
 }
 // Recompute paths inside affected rooms, including shortening around an internal screen.
 for(const e of r.links){
  const saved=base.links.includes(e)&&!interiorRooms.has(e.a)&&!interiorRooms.has(e.b)?base.edgePaths.get(`${e.a}:${e.b}`):undefined;
  const a=r.rooms[e.a]!,b=r.rooms[e.b]!,ra=saved?null:localRoute(r.centers[e.a]!,e.from,a.polygon,a.holes,obstacles),rb=saved?null:localRoute(e.to,r.centers[e.b]!,b.polygon,b.holes,obstacles);
  if(!saved&&(!ra||!rb))throw Error('Не удалось восстановить физический путь после удаления панели.');
  const path=saved??[...ra!,...e.points.slice(1),...rb!.slice(1)];r.passages[e.a]!.push(e.b);r.passages[e.b]!.push(e.a);r.edgePaths.set(`${e.a}:${e.b}`,path);r.edgePaths.set(`${e.b}:${e.a}`,[...path].reverse());r.paths.push(path);
 }
 const interior=interiorRooms.size>0;
 return freeAnalysisMaze(maze,layout,r,!openings.length&&!interior);
}
