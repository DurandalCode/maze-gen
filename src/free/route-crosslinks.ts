import type {Anchor,FreeDraft} from './model';
import {anchorGeometry,connectionGeometry,freeGraphPath,freeMaze,freeRuntime,modulePolygon,validateFree} from './layout';
import {shortestPath,pathLength} from '../core/pathfinding';
import type {Maze} from '../core/maze';
import {distance,edges,ends,segmentDistance} from './geometry';
import {freeGroundRunWitness,freeGroundStraightWitness} from './path-limits';
import {physicallyOpen} from './cavity-maze';
export interface ReturnCircuitGuard {fork:string;doors:[string,string]}
/** Same minimum-hop circuit and physical edge lengths as loopTraps. This is
 * only a cheap geometry rejection; final perceptual qualification still runs. */
export function returnCircuitPreserved(maze:Maze,guard:ReturnCircuitGuard):boolean{
 const r=freeRuntime(maze),fork=r.rooms.findIndex(m=>m.id===guard.fork),[a,b]=guard.doors.map(id=>r.rooms.findIndex(m=>m.id===id));if(fork<0||a===undefined||b===undefined||a<0||b<0)return false;
 const component=new Set([a]),queue=[a];for(const at of queue)for(const n of r.passages[at]!)if(n!==fork&&!component.has(n)){component.add(n);queue.push(n);}
 const main=new Set(shortestPath(maze));if(queue.some(c=>main.has(c)||c===maze.entrance.cell||c===maze.exit.cell))return false;
 const doors=r.passages[fork]!.filter(c=>component.has(c));if(doors.length!==2||!doors.includes(a)||!doors.includes(b))return false;
 const parent=new Map([[a,-1]]),search=[a];for(let i=0;i<search.length&&!parent.has(b);i++)for(const n of r.passages[search[i]!]!)if(n!==fork&&!parent.has(n)){parent.set(n,search[i]!);search.push(n);}
 if(!parent.has(b))return false;const path=[b];while(path.at(-1)!==a)path.push(parent.get(path.at(-1)!)!);path.reverse();const loop=[fork,...path,fork],points=freeGraphPath(maze,loop);
 const length=loop.slice(1).reduce((sum,c,i)=>sum+pathLength(r.edgePaths.get(`${loop[i]}:${c}`)!),0),width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),depth=Math.max(...points.map(p=>p.z))-Math.min(...points.map(p=>p.z));
 let turns=0;for(let j=0;j<points.length-1;j++){const p=points[(j+points.length-2)%(points.length-1)]!,q=points[j]!,s=points[j+1]!;if(Math.abs((q.x-p.x)*(s.z-q.z)-(q.z-p.z)*(s.x-q.x))>1e-7)turns++;}
 return length>=40&&width>=6&&depth>=6&&turns>=4;
}

/** A local repair between existing native gates. No frame is moved, and no
 * protected route fork may be bypassed by the newly closed cycle. */
export function crosslinkLongRoute(source:FreeDraft,rooms:string[],straight:boolean,prefix:string,protectedRooms:readonly string[],returnGuards:readonly ReturnCircuitGuard[]=[]):FreeDraft|undefined{
 const width=Math.min(1.4,source.parameters.corridorWidth),layout=source.layout,used=[...layout.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...layout.openings];
 const slots=(room:string):Anchor[]=>{const m=layout.modules.find(m=>m.id===room)!;return edges(modulePolygon(m)).flatMap((wall,edge)=>{const length=distance(...ends(wall)),offsets=length>3?[0,-1.5,1.5,-(length-width)/2+.15,(length-width)/2-.15]:[0];return offsets.filter(offset=>!used.some(o=>o.room===room&&o.edge===edge&&Math.abs(o.offset-offset)<(o.width+width)/2+.12)).map(offset=>({room,edge,offset}));});};
 const adjacency=new Map<string,string[]>();for(const c of layout.connections){adjacency.set(c.a.room,[...adjacency.get(c.a.room)??[],c.b.room]);adjacency.set(c.b.room,[...adjacency.get(c.b.room)??[],c.a.room]);}
 const reachable=new Map<string,Set<string>>();
 const preserves=(a:string,b:string)=>protectedRooms.every(fork=>{if(a===fork||b===fork)return true;const key=a+'\0'+fork;let seen=reachable.get(key);if(!seen){seen=new Set([a]);const queue=[a];for(const at of queue)for(const next of adjacency.get(at)??[])if(next!==fork&&!seen.has(next)){seen.add(next);queue.push(next);}reachable.set(key,seen);}return seen.has(b);});
 const metric=straight?freeGroundStraightWitness:freeGroundRunWitness,before=metric(freeMaze(source,false)).length;let raw=0,full=0;
 for(const root of rooms){const m=layout.modules.find(m=>m.id===root);if(!m)continue;
  const targets=layout.modules.filter(n=>n.id!==root&&!adjacency.get(root)?.includes(n.id)&&Math.hypot(n.x-m.x,n.z-m.z)<8).sort((a,b)=>Math.hypot(a.x-m.x,a.z-m.z)-Math.hypot(b.x-m.x,b.z-m.z));
  for(const target of targets){if(!preserves(root,target.id))continue;for(const a of slots(root))for(const b of slots(target.id)){
   if(raw++>=2048||full>=12)return undefined;
   const ga=anchorGeometry(layout,a,width),gb=anchorGeometry(layout,b,width);if(distance(ga.mid,gb.mid)>3.5||ga.normal.x*gb.normal.x+ga.normal.z*gb.normal.z>-.25)continue;
   const link={id:prefix+'-cross-'+raw,a,b,width},g=connectionGeometry(layout,link),actual=Math.max(...g.sides.map(w=>distance(...ends(w))));if(actual>3+1e-7||Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1-1e-7)continue;
   const draft=structuredClone(source),record={...link,spanAudit:{desired:3,actual,reason:'Поперечная связь между фиксированными существующими модульными проёмами.'}};draft.layout.connections.push(record);draft.layout.moduleConstruction!.spans.push(structuredClone(record));full++;
   if(validateFree(draft).length||physicallyOpen(draft))continue;
   const candidate=freeMaze(draft,false),runtime=freeRuntime(candidate),route=new Set(shortestPath(candidate).map(i=>runtime.rooms[i]!.id));if(protectedRooms.some(id=>!route.has(id)))continue;
   if(returnGuards.some(guard=>!returnCircuitPreserved(candidate,guard)))continue;
   if(metric(candidate).length<before-1e-5)return draft;
  }}
 }
 return undefined;
}
