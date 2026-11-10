import {freeRay,freeRuntime,anchorGeometry} from '../free/layout';
import {corridorSupports} from './corridor-supports';
import {domainOf,type Domain} from './domain';
import {regionOwners} from './corridor-geometry';
import {cellCenter,portalPoint,walls,type Maze,type Point,type Portal,type Wall} from './maze';
export interface NavigationGeometry {source:Maze;domain:Domain;centers:Point[];representatives:number[];originalToRegion:Int32Array}
const cache=new WeakMap<Maze,{signature:string;maze:Maze}>();
const obstacleCache=new WeakMap<Maze,Wall[]>();
const openingCache=new WeakMap<Maze,Map<string,Point>>();
/** Collapse every open room to one semantic space; its raster is not a set of
 * decisions or cycles. This adapter is transient and is never serialized. */
export function corridorNavigation(source:Maze):Maze{
 if(source.navigation)return source;
 const original=source;const signature=JSON.stringify([source.passages,source.entrance,source.exit,source.portals]),known=cache.get(source);if(known?.signature===signature)return known.maze;
 source={...source,passages:source.passages.map(p=>[...p])};
 const d=domainOf(source),owners=regionOwners(source),unique=[...new Set(d.cells.map(c=>owners[c]!))].sort((a,b)=>a-b),index=new Map(unique.map((v,i)=>[v,i])),mapping=new Int32Array(source.passages.length).fill(-1),rectangles:Domain['rectangles']=[],centers:Point[]=[],representatives:number[]=[],passages:number[][]=unique.map(()=>[]);
 for(const c of d.cells){const i=index.get(owners[c]!)!,r=d.rectangles[c]!;mapping[c]=i;const q=rectangles[i];rectangles[i]=q?{x1:Math.min(q.x1,r.x1),z1:Math.min(q.z1,r.z1),x2:Math.max(q.x2,r.x2),z2:Math.max(q.z2,r.z2)}:{...r};}
 for(let i=0;i<unique.length;i++){const r=rectangles[i]!;centers.push({x:(r.x1+r.x2)/2,z:(r.z1+r.z2)/2});let best=Infinity,representative=-1;for(const c of d.cells)if(mapping[c]===i){const p=cellCenter(source,c),v=Math.hypot(p.x-centers[i]!.x,p.z-centers[i]!.z);if(v<best){best=v;representative=c;}}representatives.push(representative);}
 for(const a of d.cells)for(const b of source.passages[a]!){const x=mapping[a]!,y=mapping[b]!;if(x!==y&&!passages[x]!.includes(y))passages[x]!.push(y);}
 const portal=(p:Portal)=>({...p,cell:mapping[p.cell]!}),domain:Domain={...d,cells:unique.map((_,i)=>i),active:new Uint8Array(unique.length).fill(1),rectangles,boundary:d.boundary.map(e=>({...e,portal:portal(e.portal)}))};
 const result:Maze={...source,passages,entrance:portal(source.entrance),exit:portal(source.exit),portals:source.portals?.map(portal)};
 Object.defineProperty(result,'navigation',{value:{source,domain,centers,representatives,originalToRegion:mapping} satisfies NavigationGeometry,enumerable:false});cache.set(original,{signature,maze:result});cache.set(source,{signature,maze:result});return result;
}
export function rayDistance(source:Maze,start:Point,angle:number,limit=24):number{
 if(source.version===5)return freeRay(source,start,angle,limit);
 const dx=Math.cos(angle),dz=Math.sin(angle);let best=limit;
 let obstacles=obstacleCache.get(source);if(!obstacles){obstacles=[...walls(source)];for(const p of corridorSupports(source))obstacles.push({x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:.12});obstacleCache.set(source,obstacles);}
 for(const w of obstacles){
  const h=(w.thickness??.06)/2;let lo=0,hi=best;
  for(const [origin,direction,min,max]of [[start.x,dx,Math.min(w.x1,w.x2)-h,Math.max(w.x1,w.x2)+h],[start.z,dz,Math.min(w.z1,w.z2)-h,Math.max(w.z1,w.z2)+h]]){if(Math.abs(direction!)<1e-12){if(origin!<min!||origin!>max!){lo=Infinity;break;}}else{const a=(min!-origin!)/direction!,b=(max!-origin!)/direction!;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}}
  if(lo>1e-7&&lo<=hi)best=Math.min(best,lo);
 }

 return best;
}
export function openingMidpoint(maze:Maze,a:number,b:number):Point{
 if(maze.version===5){const r=freeRuntime(maze),c=maze.free!.connections.find(c=>c.a.room===r.rooms[a]!.id&&c.b.room===r.rooms[b]!.id||c.b.room===r.rooms[a]!.id&&c.a.room===r.rooms[b]!.id)!;const anchor=c.a.room===r.rooms[a]!.id?c.a:c.b;return anchorGeometry(maze.free!,anchor,c.width).mid;}
 const g=maze.navigation!,key=a<b?`${a}:${b}`:`${b}:${a}`;let cached=openingCache.get(maze);if(!cached){cached=new Map();openingCache.set(maze,cached);}const known=cached.get(key);if(known)return known;let x=0,z=0,n=0;
 for(const c of domainOf(g.source).cells)if(g.originalToRegion[c]===a)for(const d of g.source.passages[c]!)if(g.originalToRegion[d]===b){const r=domainOf(g.source).rectangles[c]!,s=domainOf(g.source).rectangles[d]!,vertical=r.x2===s.x1||s.x2===r.x1,lo=vertical?Math.max(r.z1,s.z1):Math.max(r.x1,s.x1),hi=vertical?Math.min(r.z2,s.z2):Math.min(r.x2,s.x2),length=hi-lo;x+=(vertical?Math.max(r.x1,s.x1):(lo+hi)/2)*length;z+=(vertical?(lo+hi)/2:Math.max(r.z1,s.z1))*length;n+=length;}
 const result=n?{x:x/n,z:z/n}:g.centers[b]!;cached.set(key,result);return result;
}
export function originalPortalPoint(maze:Maze,p:Portal):Point{
 const g=maze.navigation!,source=g.source;
 if(p.cell===maze.entrance.cell&&p.side===maze.entrance.side)return portalPoint(source,source.entrance);
 if(p.cell===maze.exit.cell&&p.side===maze.exit.side)return portalPoint(source,source.exit);
 const found=source.portals?.find(q=>g.originalToRegion[q.cell]===p.cell&&q.side===p.side);return found?portalPoint(source,found):g.centers[p.cell]!;
}
export function physicallySupported(maze:Maze,w:Wall):boolean{
 // On-module panels are tensioned by its closed frame, irrespective of length.
 const middle={x:(w.x1+w.x2)/2,z:(w.z1+w.z2)/2};
 if(maze.layout!.modules.some(m=>{const width=m.type==='2x6'&&m.rotation===0?6:2,depth=m.type==='2x6'&&m.rotation===90?6:2;return w.x1===w.x2?(Math.abs(w.x1-m.x)<1e-7||Math.abs(w.x1-m.x-width)<1e-7)&&middle.z>=m.z&&middle.z<=m.z+depth:(Math.abs(w.z1-m.z)<1e-7||Math.abs(w.z1-m.z-depth)<1e-7)&&middle.x>=m.x&&middle.x<=m.x+width;}))return true;
 return Math.hypot(w.x2-w.x1,w.z2-w.z1)<=3+1e-7;
}
/** Shortest doorway route inside rectangular open spaces. Edges join actual
 * openings directly, so a long module's centre is never a mandatory waypoint. */
export function roomAnchor(maze:Maze,room:number,p:Point):Point{
 const r=domainOf(maze).rectangles[room]!,inset=.31;
 return {x:Math.max(r.x1+inset,Math.min(r.x2-inset,p.x)),z:Math.max(r.z1+inset,Math.min(r.z2-inset,p.z))};
}
const routeCache=new WeakMap<Maze,{points:Point[];regions:number[]}>();
export function corridorRoute(source:Maze):{points:Point[];regions:number[]}{
 const maze=source.navigation?source:corridorNavigation(source),cached=routeCache.get(maze);if(cached)return cached;
 const start=portalPoint(maze,maze.entrance),finish=portalPoint(maze,maze.exit),points:Point[]=[roomAnchor(maze,maze.entrance.cell,start),roomAnchor(maze,maze.exit.cell,finish)],rooms:number[]=[maze.entrance.cell,maze.exit.cell],cross=new Map<number,number>();
 for(let a=0;a<maze.passages.length;a++)for(const b of maze.passages[a]!)if(b>a){const p=openingMidpoint(maze,a,b),i=points.length;points.push(roomAnchor(maze,a,p),roomAnchor(maze,b,p));rooms.push(a,b);cross.set(i,i+1);cross.set(i+1,i);}
 const members:number[][]=maze.passages.map(()=>[]);for(let i=0;i<rooms.length;i++)members[rooms[i]!]!.push(i);
 const dist=new Float64Array(points.length).fill(Infinity),parent=new Int32Array(points.length).fill(-1),settled=new Uint8Array(points.length);dist[0]=0;
 for(let k=0;k<points.length;k++){let a=-1;for(let i=0;i<points.length;i++)if(!settled[i]&&(a<0||dist[i]!<dist[a]!))a=i;if(a<0||!Number.isFinite(dist[a]!))break;if(a===1)break;settled[a]=1;const candidates=[...members[rooms[a]!]!];if(cross.has(a))candidates.push(cross.get(a)!);for(const b of candidates){const value=dist[a]!+Math.hypot(points[a]!.x-points[b]!.x,points[a]!.z-points[b]!.z);if(value<dist[b]!){dist[b]=value;parent[b]=a;}}}
 if(!Number.isFinite(dist[1]!))return {points:[],regions:[]};const path=[1];while(path.at(-1)!==0)path.push(parent[path.at(-1)!]!);path.reverse();
 const regionPath=[maze.entrance.cell];for(const i of path)if(regionPath.at(-1)!==rooms[i])regionPath.push(rooms[i]!);
 const result={points:[start,...path.map(i=>points[i]!),finish],regions:regionPath};routeCache.set(maze,result);return result;
}
export function validateCorridorSpaces(maze:Maze):void{
 const graph=corridorNavigation(maze),g=graph.navigation!,d=domainOf(maze),area=new Float64Array(graph.passages.length);
 for(const c of d.cells){const r=d.rectangles[c]!;area[g.originalToRegion[c]!]!+=(r.x2-r.x1)*(r.z2-r.z1);for(const n of maze.passages[c]!)if(!d.active[n])throw Error('Проход вне области.');}
 for(let i=0;i<area.length;i++){const r=g.domain.rectangles[i]!,width=r.x2-r.x1,depth=r.z2-r.z1;if(Math.abs(area[i]!-width*depth)>1e-6)throw Error('Открытое пространство должно быть прямоугольным.');const isModule=maze.layout!.modules.some(m=>m.x===r.x1&&m.z===r.z1&&(m.type==='2x6'&&m.rotation===0?6:2)===width&&(m.type==='2x6'&&m.rotation===90?6:2)===depth);const isHall=maze.layout!.spaces?.some(h=>h.kind==='hall'&&h.x===r.x1&&h.z===r.z1&&h.width===width&&h.height===depth);if(!isHall&&!isModule&&(Math.min(width,depth)<1-1e-7||Math.min(width,depth)>maze.parameters.corridorWidth+1e-7))throw Error('Проходы должны быть не уже 1 м и не шире заданного максимума.');}
}
export function corridorPathPoints(source:Maze,cells:readonly number[]):Point[]{
 if(!cells.length)return [];const graph=corridorNavigation(source),g=graph.navigation!,rooms=cells.map(c=>g.originalToRegion[c]!).filter((c,i,a)=>i===0||c!==a[i-1]),points=[g.centers[rooms[0]!]!];
 for(let i=1;i<rooms.length;i++){const a=rooms[i-1]!,b=rooms[i]!;if(!graph.passages[a]!.includes(b))return [];const p=openingMidpoint(graph,a,b);points.push(roomAnchor(graph,a,p),roomAnchor(graph,b,p));}points.push(g.centers[rooms.at(-1)!]!);return points;
}
