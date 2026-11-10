import {emptyMaze,connect,neighbors,routingSize,portalPoint,type Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {withPortals} from '../core/portals';
import {routePoints,shortestPath,pathLength} from '../core/pathfinding';
import {random,shuffle} from '../core/random';
export interface RouteRun {dx:number;dz:number;length:number}
/** Ignore physical corner chamfers, retaining the ordered axial corridor legs. */
export function routeRuns(maze:Maze):RouteRun[]{const points=routePoints(maze),runs:RouteRun[]=[];for(let i=1;i<points.length;i++){const dx=points[i]!.x-points[i-1]!.x,dz=points[i]!.z-points[i-1]!.z;if(Math.abs(dx)>1e-6&&Math.abs(dz)>1e-6)continue;const length=Math.hypot(dx,dz);if(length<1e-6)continue;const x=Math.sign(dx),z=Math.sign(dz),last=runs.at(-1);if(last&&last.dx===x&&last.dz===z)last.length+=length;else runs.push({dx:x,dz:z,length});}return runs;}
interface Tile {x:number;z:number}
const key=(p:Tile)=>`${p.x}:${p.z}`;
interface Packing {path:Tile[];used:Set<string>;edges:number;cost:number}
export function packRoute(runs:RouteRun[],edges:number,seed:string):Tile[]{
 if(!runs.length||edges<runs.length||edges>300)throw Error('Невыполнимый бюджет маршрута.');const rng=random(seed),total=runs.reduce((s,r)=>s+r.length,0);let beam:Packing[]=[{path:[{x:0,z:0}],used:new Set(['0:0']),edges:0,cost:0}];
 for(let i=0;i<runs.length;i++){const r=runs[i]!,next:Packing[]=[];for(const b of beam)for(let n=1;n<=Math.min(12,edges-b.edges-(runs.length-i-1));n++){
   if(b.edges+n+(runs.length-i-1)*12<edges)continue;const path=[...b.path],used=new Set(b.used);let valid=true;for(let j=0;j<n;j++){const a=path.at(-1)!,p={x:a.x+r.dx,z:a.z+r.dz};if(used.has(key(p))||p.x<0){valid=false;break;}path.push(p);used.add(key(p));}if(!valid)continue;
   const xs=path.map(p=>p.x),zs=path.map(p=>p.z),w=Math.max(...xs)-Math.min(...xs)+1,h=Math.max(...zs)-Math.min(...zs)+1;
   next.push({path,used,edges:b.edges+n,cost:w*h+.6*(w+h)+.8*(w-h)**2+.15*Math.abs(n-r.length/total*edges)+rng()*.05});
  }next.sort((a,b)=>a.cost-b.cost);beam=next.slice(0,600);if(!beam.length)throw Error('Не удалось упаковать последовательность поворотов.');
 }
 const best=beam.filter(b=>b.edges===edges&&!b.used.has(`${b.path.at(-1)!.x+1}:${b.path.at(-1)!.z}`)).sort((a,b)=>a.cost-b.cost)[0];if(!best)throw Error('Нет свободного места для выхода.');return best.path;
}
export interface ClassicalTransfer {maze:Maze;modulePath:Tile[];runs:RouteRun[];fillRegions:number;addedRouteForks:number;sourceRouteMetres:number;targetRouteMetres:number}
/** Route-only experiment: new branches/outline, unchanged ordered axial turns.
 * Every added component attaches once, preserving the sole entrance-exit path. */
export function classicalTransfer(source:Maze,seed=source.parameters.seed+'|route-only',targetModules=70):ClassicalTransfer{
 if(source.entrance.side!=='west'||source.exit.side!=='east')throw Error('Этот эксперимент использует западный вход и восточный выход.');
 const runs=routeRuns(source),edges=Math.max(runs.length,Math.round((pathLength(routePoints(source))-2)/4));let packed:Tile[]|undefined;for(let n=edges;n<Math.min(targetModules,edges+33);n++){try{packed=packRoute(runs,n,seed);break;}catch{/* A short budget may force the ordered turns to intersect. */}}if(!packed)throw Error('Не удалось сохранить повороты в заданном бюджете модулей.');const path=packed,rng=random(seed),mask=new Map(path.map(p=>[key(p),p])),start=path[0]!,finish=path.at(-1)!,forbidden=new Set([`${start.x-1}:${start.z}`,`${finish.x+1}:${finish.z}`]);
 if(targetModules<path.length)throw Error('Бюджет модулей меньше самого маршрута.');
 while(mask.size<targetModules){const offers=new Map<string,Tile>();for(const p of mask.values())for(const [dx,dz]of [[-1,0],[1,0],[0,-1],[0,1]]){const q={x:p.x+dx!,z:p.z+dz!},k=key(q);if(!mask.has(k)&&!forbidden.has(k))offers.set(k,q);}const choices=[...offers.values()];shuffle(choices,rng);const cost=(q:Tile)=>{const all=[...mask.values(),q],xs=all.map(p=>p.x),zs=all.map(p=>p.z),w=Math.max(...xs)-Math.min(...xs)+1,h=Math.max(...zs)-Math.min(...zs)+1;return w*h+2*([[-1,0],[1,0],[0,-1],[0,1]].filter(([dx,dz])=>!mask.has(`${q.x+dx!}:${q.z+dz!}`)).length);};choices.sort((a,b)=>cost(a)-cost(b));if(!choices.length)throw Error('Нет места для заполнения.');const q=choices[0]!;mask.set(key(q),q);}
 const minX=Math.min(...[...mask.values()].map(p=>p.x)),minZ=Math.min(...[...mask.values()].map(p=>p.z)),cols=Math.max(...[...mask.values()].map(p=>p.x))-minX+1,rows=Math.max(...[...mask.values()].map(p=>p.z))-minZ+1;
 const maze=emptyMaze({generationType:'classical',columns:cols,rows,moduleSize:2,corridorWidth:2,algorithm:'backtracker',seed,extraConnections:0,routeTrapCount:0,loopTrapCount:0,shape:{kind:'grid-rectangles',rectangles:[...mask.values()].map(p=>({x:p.x-minX,z:p.z-minZ,width:1,height:1,operation:'add' as const}))}});
 Object.assign(maze,{wallHeight:source.wallHeight,wallColor:source.wallColor,translucentFabric:source.translucentFabric,roof:source.roof,...(source.environment?{environment:structuredClone(source.environment)}:{})});
 const width=routingSize(maze).columns,cell=(p:Tile)=>(p.z-minZ)*2*width+(p.x-minX)*2,core=new Set<number>(),reference:number[]=[cell(start)];core.add(cell(start));
 for(let i=1;i<path.length;i++){const a=cell(path[i-1]!),b=cell(path[i]!),mid=(a+b)/2;connect(maze,a,mid);connect(maze,mid,b);core.add(mid);core.add(b);reference.push(mid,b);}
 maze.entrance={cell:cell(start),side:'west'};maze.exit={cell:cell(finish),side:'east'};Object.assign(maze,withPortals(maze,[maze.entrance,maze.exit]));
 const remaining=new Set(domainOf(maze).cells.filter(c=>!core.has(c)));let fillRegions=0;
 while(remaining.size){const first=remaining.values().next().value!,cells=[first],gates:{a:number;b:number}[]=[];remaining.delete(first);for(let i=0;i<cells.length;i++)for(const n of neighbors(maze,cells[i]!)){if(core.has(n))gates.push({a:cells[i]!,b:n});else if(remaining.delete(n))cells.push(n);}if(!gates.length)throw Error('Изолированное заполнение.');shuffle(gates,rng);const gate=gates[0]!;connect(maze,gate.a,gate.b);const allowed=new Set(cells),seen=new Set([gate.a]),stack=[gate.a];while(stack.length){const at=stack.at(-1)!,offers=neighbors(maze,at).filter(n=>allowed.has(n)&&!seen.has(n));shuffle(offers,rng);if(!offers.length){stack.pop();continue;}const n=offers[0]!;connect(maze,at,n);seen.add(n);stack.push(n);}fillRegions++;}
 for(const links of maze.passages)links.sort((a,b)=>a-b);const actual=shortestPath(maze);if(actual.length!==reference.length||actual.some((c,i)=>c!==reference[i]))throw Error('Заполнение изменило маршрут.');const targetRuns=routeRuns(maze);if(targetRuns.length!==runs.length||runs.some((r,i)=>r.dx!==targetRuns[i]!.dx||r.dz!==targetRuns[i]!.dz))throw Error('Изменён порядок поворотов.');
 // These openings remain boundary openings after filling the irregular outline.
 if(!Number.isFinite(portalPoint(maze,maze.exit).x))throw Error('Некорректный выход.');
 return {maze,modulePath:path,runs,fillRegions,addedRouteForks:reference.filter(c=>maze.passages[c]!.length>=3).length,sourceRouteMetres:pathLength(routePoints(source)),targetRouteMetres:pathLength(routePoints(maze))};
}
