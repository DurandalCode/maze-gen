import type {Point} from '../core/maze';
import {polygonUnionBoundary} from './open-pockets';
import {buildNavigation} from './layout';
import {emptyLayout} from './model';
import {CollisionWorld} from '../simulation/collisions';
import {random,shuffle} from '../core/random';
import {area,distance,edges,ends,lerp,pointIn,segmentInside,segmentDistance,simple} from './geometry';
export interface CavityCell{id:string;polygon:Point[];area:number}
export interface CavityDoor{a:number;b:number;edgeA:number;edgeB:number;offsetA:number;offsetB:number;width:number;from:Point;to:Point}
export interface CavityStructure{cells:CavityCell[];adjacency:CavityDoor[];passages:CavityDoor[];closed:CavityDoor[];components:number[][];seed:string;supports:Point[];blockedDoors:number;mergedCells:number}
const signed=(poly:Point[])=>poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length]!;return s+p.x*q.z-q.x*p.z;},0)/2;
/** Add geometric cut sites on existing boundaries, without a spatial grid. */
function sites(poly:Point[],spacing:number){const result:Point[]=[];for(const wall of edges(poly)){const [a,b]=ends(wall),n=Math.ceil(distance(a,b)/spacing);for(let i=0;i<n;i++)result.push(lerp(a,b,i/n));}return result;}
/** Seeded geometric BSP. Every leaf is an exact part of the original irregular
 * cavity; a partition may end only on its existing boundary. */
export function partitionCavity(polygon:Point[],seed:string,targetArea=7):CavityCell[]{
 if(!simple(polygon))throw Error('Некорректная граница полости.');const rng=random(seed),result:CavityCell[]=[];
 const split=(input:Point[],depth:number)=>{
  const surface=area(input);if(surface<=targetArea*1.4||depth>=16||result.length>=100){result.push({id:`chamber-${result.length}`,polygon:sites(input,2.5),area:surface});return;}
  const poly=sites(input,2),n=poly.length,boundary=edges(poly),prefix=[0];for(let i=0;i<n;i++){const a=poly[i]!,b=poly[(i+1)%n]!;prefix.push(prefix.at(-1)!+a.x*b.z-b.x*a.z);}
  let best:{i:number;j:number;score:number}|undefined;
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
   if(i===0&&j===n-1)continue;const a=poly[i]!,b=poly[j]!,length=distance(a,b);if(length<1.25||length>8)continue;
   const first=(prefix[j]!-prefix[i]!+b.x*a.z-a.x*b.z)/2,second=surface-first;if(first<2.8||second<2.8)continue;
   const balance=Math.min(first,second)/surface,score=balance+(.25*rng())-length*.012;if(best&&score<=best.score)continue;
   if(!pointIn(lerp(a,b,.5),poly,false)||!segmentInside(a,b,p=>pointIn(p,poly),boundary))continue;
   // A chord touching another boundary vertex would make a pinched room.
   const wall={x1:a.x,z1:a.z,x2:b.x,z2:b.z};if(poly.some((p,k)=>k!==i&&k!==j&&segmentDistance(p,wall)<1e-7))continue;
   best={i,j,score};
  }
  if(!best){result.push({id:`chamber-${result.length}`,polygon:sites(input,2.5),area:surface});return;}
  const {i,j}=best;split(poly.slice(i,j+1),depth+1);split([...poly.slice(j),...poly.slice(0,i+1)],depth+1);
 };
 split(signed(polygon)>0?polygon:[...polygon].reverse(),0);return result;
}
/** All sufficiently wide shared boundaries are *potential* doorways. */
export function cavityAdjacency(cells:CavityCell[],minimum=1.25):CavityDoor[]{
 const result:CavityDoor[]=[];
 for(let a=0;a<cells.length;a++)for(let b=a+1;b<cells.length;b++){
  let best:CavityDoor|undefined;
  for(const [edgeA,wa]of edges(cells[a]!.polygon).entries())for(const [edgeB,wb]of edges(cells[b]!.polygon).entries()){
   const [p,q]=ends(wa),[r,s]=ends(wb),length=distance(p,q);if(length<minimum)continue;
   const dx=(q.x-p.x)/length,dz=(q.z-p.z)/length;
   if(Math.abs((r.x-p.x)*dz-(r.z-p.z)*dx)>1e-6||Math.abs((s.x-p.x)*dz-(s.z-p.z)*dx)>1e-6)continue;
   const tr=(r.x-p.x)*dx+(r.z-p.z)*dz,ts=(s.x-p.x)*dx+(s.z-p.z)*dz,lo=Math.max(0,Math.min(tr,ts)),hi=Math.min(length,Math.max(tr,ts));if(hi-lo<minimum)continue;
   const from={x:p.x+dx*lo,z:p.z+dz*lo},to={x:p.x+dx*hi,z:p.z+dz*hi},mid=lerp(from,to,.5),lengthB=distance(r,s),width=Math.min(1.4,hi-lo-.12);
   const door={a,b,edgeA,edgeB,offsetA:(lo+hi)/2-length/2,offsetB:((mid.x-r.x)*(s.x-r.x)+(mid.z-r.z)*(s.z-r.z))/lengthB-lengthB/2,width,from,to};
   if(!best||width>best.width)best=door;
  }
  if(best)result.push(best);
 }
 return result;
}
/** The maze is a selected graph, not an all-open hall. Prim supplies the
 * connected tree; optional independent edges add only controlled loops. */
export function carveCavity(polygon:Point[],seed:string,options:{targetArea?:number;loops?:number;cells?:CavityCell[];existingSupports?:Point[];maxMergedArea?:number}={}):CavityStructure{
 const cells=options.cells?structuredClone(options.cells):partitionCavity(polygon,seed,options.targetArea??7);let raw=cavityAdjacency(cells),supports:Point[]=[],mergedCells=0;
 const refreshSupports=()=>{supports=[...options.existingSupports??[],...cells.flatMap(c=>c.polygon)];for(const e of raw){const mid=lerp(e.from,e.to,.5),ratio=e.width/distance(e.from,e.to);supports.push(lerp(mid,e.from,ratio),lerp(mid,e.to,ratio));}};
 refreshSupports();
 const qualifying=()=>raw.filter(e=>{const l=emptyLayout();l.spaces=[e.a,e.b].map(i=>({id:cells[i]!.id,kind:'hall',polygon:cells[i]!.polygon}));l.supports=supports;l.connections=[{id:'gate',a:{room:cells[e.a]!.id,edge:e.edgeA,offset:e.offsetA},b:{room:cells[e.b]!.id,edge:e.edgeB,offset:e.offsetB},width:e.width}];const r=buildNavigation(l),path=r.paths[0];if(!path)return false;const world=new CollisionWorld([...r.panels,...r.posts.map(p=>({x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:.12}))]);return path.slice(1).every((b,i)=>{const a=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});return distance(end,b)<1e-5;});});
 let adjacency=qualifying();
 for(let repair=0;repair<12;repair++){const reachable=new Set([0]),q=[0];for(const a of q)for(const e of adjacency){const b=e.a===a?e.b:e.b===a?e.a:-1;if(b>=0&&!reachable.has(b)){reachable.add(b);q.push(b);}}if(reachable.size===cells.length)break;
  const edge=cavityAdjacency(cells,1e-5).find(e=>(reachable.has(e.a)!==reachable.has(e.b))&&cells[e.a]!.area+cells[e.b]!.area<=(options.maxMergedArea??Infinity));if(!edge)break;const union=polygonUnionBoundary([cells[edge.a]!.polygon,cells[edge.b]!.polygon]);if(union.length!==1)break;cells[edge.a]={id:cells[edge.a]!.id,polygon:union[0]!,area:area(union[0]!)};cells.splice(edge.b,1);mergedCells++;raw=cavityAdjacency(cells);refreshSupports();adjacency=qualifying();
 }
 const rng=random(seed+'-passages'),passages:CavityDoor[]=[],components:number[][]=[],visited=new Set<number>();
 for(let start=0;start<cells.length;start++){
  if(visited.has(start))continue;const component=[start];visited.add(start);let frontier=adjacency.filter(e=>e.a===start||e.b===start);
  while(frontier.length){const at=Math.floor(rng()*frontier.length),edge=frontier.splice(at,1)[0]!,a=visited.has(edge.a),b=visited.has(edge.b);if(a===b)continue;const next=a?edge.b:edge.a;visited.add(next);component.push(next);passages.push(edge);frontier.push(...adjacency.filter(e=>e.a===next||e.b===next));}
  components.push(component);
 }
 const selected=new Set(passages),remaining=shuffle(adjacency.filter(e=>!selected.has(e)),rng),loopBudget=Math.min(options.loops??Math.floor(cells.length/18),remaining.length);passages.push(...remaining.slice(0,loopBudget));const open=new Set(passages);
 const constructionSupports=cells.flatMap(c=>c.polygon);for(const e of raw){const mid=lerp(e.from,e.to,.5),ratio=e.width/distance(e.from,e.to);constructionSupports.push(lerp(mid,e.from,ratio),lerp(mid,e.to,ratio));}
 return {cells,adjacency,passages,closed:adjacency.filter(e=>!open.has(e)),components,seed,supports:constructionSupports,blockedDoors:raw.length-adjacency.length,mergedCells};
}
