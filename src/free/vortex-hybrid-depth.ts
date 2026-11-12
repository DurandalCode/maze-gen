import type {Maze,Point} from '../core/maze';
import {loopTraps} from '../analysis/loop-traps';
import {freeRuntime,localRoute} from './layout';

const radius=(p:Point,c:Point)=>Math.hypot(p.x-c.x,p.z-c.z);
function nearestRadius(a:Point,b:Point,c:Point){
 const x=b.x-a.x,z=b.z-a.z,length=x*x+z*z;
 const t=length?Math.max(0,Math.min(1,((c.x-a.x)*x+(c.z-a.z)*z)/length)):0;
 return radius({x:a.x+t*x,z:a.z+t*z},c);
}
/** Follow real doorway seats across each room, without visiting its centre.
 * A large room's centre must not manufacture an inward excursion. */
export function physicalVortexCircuit(maze:Maze,chain:readonly number[]):Point[]{
 const r=freeRuntime(maze);if(!chain.length)return [];
 const points:Point[]=[r.centers[chain[0]!]!];
 for(let i=1;i<chain.length;i++){
  const from=chain[i-1]!,to=chain[i]!,link=r.links.find(e=>e.a===from&&e.b===to||e.b===from&&e.a===to);
  if(!link)throw Error('В глубокой петле отсутствует настоящий проём.');
  const directed=link.a===from?link.points:[...link.points].reverse(),room=r.rooms[from]!;
  const inside=localRoute(points.at(-1)!,directed[0]!,room.polygon,room.holes,r.obstacles);
  if(!inside)throw Error('Нет физического перехода между проёмами петли.');
  points.push(...inside.slice(1),...directed.slice(1));
 }
 const end=chain.at(-1)!,room=r.rooms[end]!,tail=localRoute(points.at(-1)!,r.centers[end]!,room.polygon,room.holes,r.obstacles);
 if(!tail)throw Error('Не удалось замкнуть физический путь петли.');
 points.push(...tail.slice(1));return points;
}
/** Geometry and topology facts. Radial range is deliberately separate from
 * inward excursion measured from the actual exterior fork. */
export function inspectHybridVortexDepth(maze:Maze,center:Point){
 const r=freeRuntime(maze);
 return loopTraps(maze).candidates.map(loop=>{
  const points=physicalVortexCircuit(maze,loop.loop),forkRadius=radius(r.centers[loop.fork]!,center);
  const minimumRadius=points.slice(1).reduce((min,p,i)=>Math.min(min,nearestRadius(points[i]!,p,center)),Infinity);
  const members=[...new Set(loop.loop.filter(i=>i!==loop.fork))];
  const transitions=(chain:number[])=>chain.slice(1).flatMap((to,j)=>{
   const from=chain[j]!,a=r.rooms[from]!.id.match(/^spiral(\d)-/),b=r.rooms[to]!.id.match(/^spiral(\d)-/);
   return a&&b&&a[1]!==b[1]&&radius(r.centers[from]!,center)-radius(r.centers[to]!,center)>=2
    ?[{from:r.rooms[from]!.id,to:r.rooms[to]!.id}]:[];
  });
  const forward=transitions(loop.loop),reverse=transitions([...loop.loop].reverse());
  return {fork:r.rooms[loop.fork]!.id,qualifies:loop.qualifies,forkRadius,minimumRadius,
   inwardExcursion:forkRadius-minimumRadius,
   inwardBandConnections:forward.length>=reverse.length?forward:reverse,
   pure:members.every(i=>r.passages[i]!.length===2),members:members.map(i=>r.rooms[i]!.id),points};
 });
}
