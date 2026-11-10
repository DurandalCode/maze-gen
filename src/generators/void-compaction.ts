import {corridorNavigation} from '../core/corridor-navigation';
import {corridorShell} from './corridor';
import {domainOf} from '../core/domain';
import {axisBounds,connect,neighbors,routingSize,type Maze,type Point} from '../core/maze';
import {validatePlacement,type PlacedModule} from '../core/corridor-geometry';
import {withPortals} from '../core/portals';
import {independentCycles,componentCount} from '../core/graph';
import {routeTraps} from '../analysis/route-traps';
import {loopTraps} from '../analysis/loop-traps';
import {validateCorridorSpaces} from '../core/corridor-navigation';
import {validateFabricSupports} from '../core/corridor-supports';
import {metrics} from '../core/metrics';
export interface VoidCompaction {maze:Maze;removedColumns:number[];removedRows:number[];sourceRouteMetres:number;targetRouteMetres:number;retainedTiles:number;routeFork?:number;loopFork?:number}
/** Delete global 2m strips only where every crossing is a straight degree-two
 * corridor. Corners, junctions, terminals and adjacency are retained. New
 * touching corridors get a closed wall, never an implicit new connection. */
export function compactVoids(source:Maze):VoidCompaction{
 if(source.version!==4||source.navigation||source.parameters.shape||source.layout?.spaces?.some(s=>s.kind==='hall')||source.width%2||source.depth%2)throw Error('Для уплотнения нужна прямоугольная двухметровая сеть без залов.');
 const d=domainOf(source),cols=source.width/2,rows=source.depth/2,blocks=new Map<number,number[]>(),links=Array.from({length:cols*rows},()=>[] as number[]),tile=(c:number)=>{const r=d.rectangles[c]!;return Math.floor(r.z1/2)*cols+Math.floor(r.x1/2);};
 for(const c of d.cells){const t=tile(c);if(!blocks.has(t))blocks.set(t,[]);blocks.get(t)!.push(c);}
 for(const [t,cells]of blocks){if(cells.length!==4)throw Error('Пол не совпадает с сеткой 2 м.');let inside=0;const boundary=new Map<number,number>();for(const c of cells)for(const n of source.passages[c]!){const b=tile(n);if(b===t)inside++;else boundary.set(b,(boundary.get(b)??0)+1);}if(inside!==8)throw Error('Внутри двухметровой клетки есть стена.');for(const [b,n]of boundary){if(n!==2)throw Error('Нужны проёмы шириной 2 м.');links[t]!.push(b);}}
 const graph=corridorNavigation(source),g=graph.navigation!,dead=routeTraps(graph).candidates.find(t=>t.qualifies),ring=loopTraps(graph).candidates.find(t=>t.qualifies),ends=new Set((source.portals??[source.entrance,source.exit]).map(p=>tile(p.cell)));
 const eligibleX=Array.from({length:cols},(_,i)=>i).filter(x=>[...blocks.keys()].every(t=>t%cols!==x||(!ends.has(t)&&links[t]!.length===2&&links[t]!.every(n=>Math.floor(n/cols)===Math.floor(t/cols))))),eligibleZ=Array.from({length:rows},(_,i)=>i).filter(z=>[...blocks.keys()].every(t=>Math.floor(t/cols)!==z||(!ends.has(t)&&links[t]!.length===2&&links[t]!.every(n=>n%cols===t%cols))));
 const candidates:{removedColumns:number[];removedRows:number[]}[]=[],total=eligibleX.length+eligibleZ.length;
 if(total>18)throw Error('Слишком много полос для ограниченного перебора уплотнения.');
 for(let mask=1;mask<2**total;mask++)candidates.push({removedColumns:eligibleX.filter((_,i)=>mask&(1<<i)),removedRows:eligibleZ.filter((_,i)=>mask&(1<<(i+eligibleX.length)))});
 candidates.sort((a,b)=>(cols-a.removedColumns.length)*(rows-a.removedRows.length)-(cols-b.removedColumns.length)*(rows-b.removedRows.length));
 let reason='Нет допустимого сжатия.';const deadline=Date.now()+90000;
 for(const {removedColumns,removedRows}of candidates){
  if(Date.now()>deadline)throw Error('Исчерпан бюджет уплотнения: '+reason);
  const xs=Array.from({length:cols},(_,i)=>i).filter(x=>!removedColumns.includes(x)),zs=Array.from({length:rows},(_,i)=>i).filter(z=>!removedRows.includes(z)),xm=new Map(xs.map((x,i)=>[x,i])),zm=new Map(zs.map((z,i)=>[z,i])),kept=new Set([...blocks.keys()].filter(t=>xm.has(t%cols)&&zm.has(Math.floor(t/cols))));
  const mapAxis=(v:number,kept:number[])=>{let value=0;for(const t of kept)value+=Math.max(0,Math.min(2,v-t*2));return value;},point=(p:Point)=>({x:mapAxis(p.x,xs),z:mapAxis(p.z,zs)}),modules:PlacedModule[]=[];
  for(const m of source.layout!.modules){const a=point(m),width=m.type==='2x6'&&m.rotation===0?6:2,height=m.type==='2x6'&&m.rotation===90?6:2,b=point({x:m.x+width,z:m.z+height}),w=b.x-a.x,h=b.z-a.z;if(!w||!h)continue;if(w===width&&h===height){modules.push({...m,x:a.x,z:a.z});continue;}for(let z=a.z;z<b.z;z+=2)for(let x=a.x;x<b.x;x+=2)modules.push({id:`${m.id}:${x}:${z}`,type:'2x2',x,z,rotation:0});}
  const spaces=[...kept].map(t=>({kind:'corridor' as const,x:xm.get(t%cols)!*2,z:zm.get(Math.floor(t/cols))!*2,width:2,height:2})),maze=corridorShell({...source.parameters,columns:xs.length*2,rows:zs.length*2,seed:source.parameters.seed+'|squeezed-voids',shape:undefined},modules,spaces,4);
  Object.assign(maze,{wallHeight:source.wallHeight,wallColor:source.wallColor,translucentFabric:source.translucentFabric,roof:source.roof,...(source.environment?{environment:structuredClone(source.environment)}:{})});
  const w=routingSize(maze).columns,blockCells=(t:number)=>{const x=xm.get(t%cols)!*2,z=zm.get(Math.floor(t/cols))!*2;return [z*w+x,z*w+x+1,(z+1)*w+x,(z+1)*w+x+1];};
  for(const t of kept){const cells=blockCells(t);for(const c of cells)for(const n of neighbors(maze,c))if(cells.includes(n)&&n>c)connect(maze,c,n);for(const first of links[t]!){let prev=t,b=first;while(!kept.has(b)){const next=links[b]!.find(n=>n!==prev);if(next===undefined)throw Error('Удалён поворот или тупик.');prev=b;b=next;}if(b<t)continue;const other=blockCells(b);let joined=0;for(const c of cells)for(const n of neighbors(maze,c))if(other.includes(n)){connect(maze,c,n);joined++;}if(joined!==2)throw Error('Не сохранилось соседство коридоров.');}}
  const xd=axisBounds(maze,'x'),zd=axisBounds(maze,'z'),cellAt=(p:Point)=>{const x=Math.min(xd.length-2,Math.max(0,Math.floor(p.x))),z=Math.min(zd.length-2,Math.max(0,Math.floor(p.z)));return z*w+x;},portal=(p:Maze['entrance'])=>{const r=d.rectangles[p.cell]!,q=point({x:(r.x1+r.x2)/2,z:(r.z1+r.z2)/2});return {...p,cell:cellAt(q)};};
  maze.entrance=portal(source.entrance);maze.exit=portal(source.exit);Object.assign(maze,withPortals(maze,(source.portals??[source.entrance,source.exit]).map(portal)));for(const p of maze.passages)p.sort((a,b)=>a-b);
  try{validatePlacement(maze);validateCorridorSpaces(maze);validateFabricSupports(maze);if(componentCount(maze)!==1||independentCycles(maze)!==independentCycles(source))throw Error('Изменена топология.');
   const nextGraph=corridorNavigation(maze),ng=nextGraph.navigation!,mappedOwner=(old:number)=>ng.originalToRegion[cellAt(point(g.centers[old]!))]!,newDead=dead?routeTraps(nextGraph).candidates.find(t=>t.qualifies&&t.fork===mappedOwner(dead.fork)):undefined,newRing=ring?loopTraps(nextGraph).candidates.find(t=>t.qualifies&&t.fork===mappedOwner(ring.fork)):undefined;
   if(dead&&!newDead)throw Error('Сжатие ослабило исходную Л1.');if(ring&&!newRing)throw Error('Сжатие ослабило исходную К1.');const sourceRouteMetres=metrics(source).optimalLength,targetRouteMetres=metrics(maze).optimalLength;if(targetRouteMetres>=sourceRouteMetres-1e-6)throw Error('Маршрут не стал короче.');
   return {maze,removedColumns,removedRows,sourceRouteMetres,targetRouteMetres,retainedTiles:kept.size,...(newDead?{routeFork:ng.representatives[newDead.fork]}:{}),...(newRing?{loopFork:ng.representatives[newRing.fork]}:{})};
  }catch(error){reason=(error as Error).message;}
 }
 throw Error(reason);
}
