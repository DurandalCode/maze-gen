import type {Maze,Point} from '../core/maze';
import {portalPoint} from '../core/maze';
import {freeRuntime,localRoute,physical,connectionGeometry,rooms,anchorGeometry} from './layout';
import {centroid} from './geometry';
import type {FreeLayout} from './model';
import type {Parameters} from '../core/maze';
import {bridgeGeometry} from './bridges';
import {pathLength} from '../core/pathfinding';
/** Actual doorway-to-doorway paths, including bends around physical screens.
 * The explicit bridge experiment measures continuous ground stretches separately. */
export function freeGroundLengths(maze:Maze){
 const r=freeRuntime(maze),portals=maze.portals??[maze.entrance,maze.exit];
 return {...measure(r,portals.map(p=>({cell:p.cell,point:portalPoint(maze,p)}))),bridges:(maze.free!.bridges??[]).map(b=>({id:b.id,length:pathLength(bridgeGeometry(maze.free!,b).path)}))};
}
/** Geometry-only growth guard: no simulation, whole-maze navigation or scoring.
 * Only chains changed by the new leaf need checking; final portals are checked later. */
export function freeGrowthLengths(layout:FreeLayout,roomId:string){
 // An added leaf changes only its chain up to the first junction. Include
 // neighbours of that chain to retain all genuine door cuts and junction degrees.
 const adjacency=new Map<string,string[]>();
 for(const c of layout.connections){adjacency.set(c.a.room,[...adjacency.get(c.a.room)??[],c.b.room]);adjacency.set(c.b.room,[...adjacency.get(c.b.room)??[],c.a.room]);}
 const rs=rooms(layout),index=new Map(rs.map((r,i)=>[r.id,i])),topology={rooms:rs,passages:rs.map(r=>(adjacency.get(r.id)??[]).map(id=>index.get(id)!))};
 const terminalRooms=new Set(layout.openings.map(o=>index.get(o.room)!).filter(i=>i!==undefined));
 const chain=new Set([roomId]);let previous=roomId,at=adjacency.get(roomId)?.[0];
 while(at&&!chain.has(at)){chain.add(at);const next=continuation(topology,index.get(at)!,index.get(previous)!,terminalRooms);previous=at;at=next===undefined?undefined:rs[next]!.id;}
 const near=new Set([...chain].flatMap(id=>[id,...adjacency.get(id)??[]]));
 const ids=new Set([...near].flatMap(id=>[id,...adjacency.get(id)??[]]));
 const local:FreeLayout={...layout,modules:layout.modules.filter(m=>ids.has(m.id)),spaces:layout.spaces.filter(s=>ids.has(s.id)),connections:layout.connections.filter(c=>ids.has(c.a.room)&&ids.has(c.b.room)),openings:layout.openings.filter(o=>ids.has(o.room))};
 const phys=physical(local),centers=phys.rooms.map(r=>centroid(r.polygon)),passages=phys.rooms.map(()=>[] as number[]);
 const links=local.connections.map(c=>{const g=connectionGeometry(local,c),a=phys.rooms.findIndex(r=>r.id===c.a.room),b=phys.rooms.findIndex(r=>r.id===c.b.room);
  passages[a]!.push(b);passages[b]!.push(a);
  const inward=(p:typeof g.a)=>({x:p.mid.x-p.normal.x*.35,z:p.mid.z-p.normal.z*.35});
  return {a,b,points:[inward(g.a),g.a.mid,g.b.mid,inward(g.b)]};
 });
 const portals=local.openings.map(o=>({cell:phys.rooms.findIndex(r=>r.id===o.room),point:anchorGeometry(local,o,o.width).mid}));
 return measure({...phys,centers,passages,links},portals,phys.rooms.findIndex(r=>r.id===roomId));
}
/** Explicit user bounds (including disabled switches) override free defaults. */
export function freeLengthLimits(p:Parameters){
 const value=(key:'maxForcedStraight'|'maxForcedRun',fallback:number)=>p.design?.disabledLimits?.includes(key)?Infinity:p.design?.[key]??fallback;
 return {straight:value('maxForcedStraight',8),run:value('maxForcedRun',16)};
}
function measure(r:Pick<ReturnType<typeof freeRuntime>,'rooms'|'centers'|'passages'|'obstacles'> & {links:{a:number;b:number;points:Point[]}[]},portals:{cell:number;point:Point}[],onlyStart?:number){
 let straight=0,run=0;
 const terminalRooms=new Set(portals.map(p=>p.cell));
 const cached=new Map<string,Point[]|null>();
 const inside=(room:number,a:Point,b:Point)=>{const key=[room,a.x,a.z,b.x,b.z].join(':');if(!cached.has(key))cached.set(key,localRoute(a,b,r.rooms[room]!.polygon,r.rooms[room]!.holes,r.obstacles));return cached.get(key);};
 for(let a=0;a<r.rooms.length;a++)if(onlyStart===undefined||a===onlyStart)for(const b of r.passages[a]!){
  const chain=[a,b],seen=new Set([a]);let at=b,previous=a;
  while(!seen.has(at)){const next=continuation(r,at,previous,terminalRooms);if(next===undefined)break;seen.add(at);chain.push(next);previous=at;at=next;}
  const start=portals.find(p=>p.cell===a),end=portals.find(p=>p.cell===at),points:Point[]=[start?start.point:r.centers[a]!];
  for(let i=1;i<chain.length;i++){
   const from=chain[i-1]!,to=chain[i]!,link=r.links.find(e=>e.a===from&&e.b===to||e.b===from&&e.a===to)!;
   const directed=link.a===from?link.points:[...link.points].reverse(),entry=directed[0]!,route=inside(from,points.at(-1)!,entry);
   if(!route)throw Error('Не удалось проверить физический проход.');points.push(...route.slice(1),...directed.slice(1));
  }
  const tail=inside(at,points.at(-1)!,end?end.point:r.centers[at]!);if(!tail)throw Error('Не удалось проверить окончание прохода.');points.push(...tail.slice(1));
  let distance=0,line=0,dx=0,dz=0;
  for(let i=1;i<points.length;i++){
   const a=points[i-1]!,b=points[i]!;
   if(a.bridge||b.bridge||(a.y??0)>.001||(b.y??0)>.001){distance=0;line=0;dx=0;dz=0;continue;}
   const x=b.x-a.x,z=b.z-a.z,len=Math.hypot(x,z);if(len<1e-8)continue;
   distance+=len;run=Math.max(run,distance);
   line=dx*x/len+dz*z/len>.999?line+len:len;dx=x/len;dz=z/len;straight=Math.max(straight,line);
  }
 }
 return {straight,run};
}

/** A single small end room is a shallow alcove, not a new route decision.
 * Keep measuring through its junction instead of letting decorative buds hide
 * a long main corridor. Real portal terminals, longer branches and loops
 * remain genuine choices. */
function continuation(r:Pick<ReturnType<typeof freeRuntime>,'rooms'|'passages'>,at:number,previous:number,terminalRooms:ReadonlySet<number>):number|undefined {
 if(terminalRooms.has(at))return undefined;
 const ns=r.passages[at]!;
 if(ns.length===2)return ns.find(n=>n!==previous);
 if(ns.length<3)return undefined;
 const onward=ns.filter(n=>n!==previous).filter(n=>{
  if(terminalRooms.has(n)||r.passages[n]!.length!==1)return true;
  const poly=r.rooms[n]!.polygon;
  return poly.some(a=>poly.some(b=>Math.hypot(a.x-b.x,a.z-b.z)>3.01));
 });
 return onward.length===1?onward[0]:undefined;
}
