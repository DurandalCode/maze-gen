import type {Maze,Point} from '../core/maze';
import {physical} from './layout';
import {area,bounds,distance,edges,ends,lerp,overlap,pointIn,segmentDistance,simple} from './geometry';
const key=(p:Point)=>`${Math.round(p.x*1e6)}:${Math.round(p.z*1e6)}`;
const signed=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0)/2;
/** Union boundary of native adjacent polygons. Splitting coincident partial
 * edges removes only internal floor seams, without rasterising any geometry. */
export function nativeFloorBoundary(maze:Maze):Point[][]{return polygonUnionBoundary(physical(maze.free!).polygons);}
export function polygonUnionBoundary(polygons:Point[][]):Point[][]{
 const polys=polygons.filter(p=>area(p)>1e-6).map(p=>signed(p)>0?p:[...p].reverse()),vertices=polys.flat(),segments=new Map<string,{a:Point;b:Point}>();
 for(const poly of polys)for(const wall of edges(poly)){
  const [a,b]=ends(wall),len=distance(a,b);if(len<1e-6)continue;
  const ts=[0,1,...vertices.filter(p=>segmentDistance(p,wall)<1e-6).map(p=>((p.x-a.x)*(b.x-a.x)+(p.z-a.z)*(b.z-a.z))/(len*len)).filter(t=>t>1e-7&&t<1-1e-7)].sort((a,b)=>a-b);
  for(let i=1;i<ts.length;i++){if(ts[i]!-ts[i-1]!<1e-7)continue;const p=lerp(a,b,ts[i-1]!),q=lerp(a,b,ts[i]!),forward=key(p)+'/'+key(q),reverse=key(q)+'/'+key(p);if(segments.has(reverse))segments.delete(reverse);else segments.set(forward,{a:p,b:q});}
 }
 const outgoing=new Map<string,{a:Point;b:Point}[]>();for(const s of segments.values()){const k=key(s.a);outgoing.set(k,[...outgoing.get(k)??[],s]);}
 const seen=new Set<string>(),loops:Point[][]=[];
 for(const start of segments.values()){
  if(seen.has(key(start.a)+'/'+key(start.b)))continue;const loop:Point[]=[];let current=start;
  while(!seen.has(key(current.a)+'/'+key(current.b))){seen.add(key(current.a)+'/'+key(current.b));loop.push(current.a);if(key(current.b)===key(start.a))break;const options=(outgoing.get(key(current.b))??[]).filter(s=>!seen.has(key(s.a)+'/'+key(s.b)));if(options.length!==1){loop.length=0;break;}current=options[0]!;}
  if(loop.length>=3&&simple(loop))loops.push(loop);
 }
 return loops.sort((a,b)=>area(b)-area(a));
}
export function pocketOverlap(a:Point[],b:Point[]){const x=bounds(a),y=bounds(b);if(x.x2<=y.x1+1e-7||y.x2<=x.x1+1e-7||x.z2<=y.z1+1e-7||y.z2<=x.z1+1e-7)return false;return overlap(a,b)||[.25,.5,.75].some(t=>edges(a).some(w=>pointIn(lerp(...ends(w),t),b,false))||edges(b).some(w=>pointIn(lerp(...ends(w),t),a,false)))||[a,b].some(poly=>edges(poly).some(w=>{const [p,q]=ends(w),length=distance(p,q);if(length<1e-7)return false;const m=lerp(p,q,.5);return [-1,1].some(sign=>{const v={x:m.x-(q.z-p.z)/length*1e-4*sign,z:m.z+(q.x-p.x)/length*1e-4*sign};return pointIn(v,a,false)&&pointIn(v,b,false);});}));}
export interface OpenPocket{polygon:Point[];area:number;mouth:number;boundaryLength:number;center:Point}
/** Negative-space bays bounded mainly by existing organic walls. The only new
 * outer boundary is a short cap across a real mouth, inside the existing hull. */
export function organicOpenPockets(maze:Maze,maxMouth=6):OpenPocket[]{
 const outer=nativeFloorBoundary(maze).find(p=>signed(p)>0);if(!outer)throw Error('Не удалось выделить внешний контур пола.');
 const occupied=physical(maze.free!).polygons,candidates:OpenPocket[]=[];
 for(let i=0;i<outer.length;i++){
  let boundaryLength=0;const chain=[outer[i]!];
  for(let step=1;step<Math.min(100,outer.length/2);step++){
   const next=outer[(i+step)%outer.length]!;boundaryLength+=distance(chain.at(-1)!,next);chain.push(next);if(step<4)continue;
   const mouth=distance(chain[0]!,next);if(mouth<.5||mouth>maxMouth||boundaryLength<mouth*2.5)continue;
   const signedArea=signed(chain);if(signedArea> -6||signedArea< -180)continue;
   const polygon=[...chain].reverse();if(!simple(polygon)||occupied.some(p=>pocketOverlap(polygon,p)))continue;
   candidates.push({polygon,area:-signedArea,mouth,boundaryLength,center:{x:polygon.reduce((s,p)=>s+p.x,0)/polygon.length,z:polygon.reduce((s,p)=>s+p.z,0)/polygon.length}});
  }
 }
 candidates.sort((a,b)=>b.area-a.area||a.mouth-b.mouth);const selected:OpenPocket[]=[];for(const c of candidates)if(!selected.some(p=>pocketOverlap(c.polygon,p.polygon)))selected.push(c);
 return selected;
}
