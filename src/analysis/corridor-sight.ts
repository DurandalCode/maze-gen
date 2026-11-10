import {domainOf} from '../core/domain';
import {cellCenter,walls,type Maze,type Point,type Wall} from '../core/maze';
import {mergeWalls} from '../core/corridor-geometry';
import {corridorSupports} from '../core/corridor-supports';
export interface CorridorSight {maximum:number;exceeded:boolean;rays:number;origin:Point;angle:number;angularStep:number}
const cache=new WeakMap<object,Map<string,CorridorSight>>();
/** Deterministic physical visibility probes: fine-cell centres plus room/module
 * corner approaches. Opposite rays measure the complete visible chord, including
 * oblique peeks. This is a sampled geometry check, not a continuous proof. */
export function corridorSight(input:Maze,limit=24,angularStep=2):CorridorSight{
 if(!Number.isFinite(limit)||limit<=0||!Number.isFinite(angularStep)||angularStep<=0||angularStep>180)throw Error('Некорректные параметры проверки обзора.');
 const maze=input.navigation?.source??input,cacheKey=maze.layout??maze,key=`${limit}:${angularStep}:${JSON.stringify([maze.passages,maze.portals??[maze.entrance,maze.exit]])}`,cached=cache.get(cacheKey)?.get(key);if(cached)return cached;
 const domain=domainOf(maze),boxes:{x1:number;x2:number;z1:number;z2:number}[]=[],grid=new Map<string,number[]>(),origins=new Map<string,Point>();
 const add=(w:Wall,h:number)=>{const box={x1:Math.min(w.x1,w.x2)-h,x2:Math.max(w.x1,w.x2)+h,z1:Math.min(w.z1,w.z2)-h,z2:Math.max(w.z1,w.z2)+h},i=boxes.length;boxes.push(box);for(let x=Math.floor(box.x1);x<=Math.floor(box.x2);x++)for(let z=Math.floor(box.z1);z<=Math.floor(box.z2);z++){const key=`${x}:${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key)!.push(i);}};
 for(const w of mergeWalls(walls(maze)))add(w,.003); // Actual rendered fabric.
 for(const w of mergeWalls(domain.boundary.map(e=>e.wall)))add(w,0); // Outdoors is not maze space.
 for(const p of corridorSupports(maze))add({x1:p.x,x2:p.x,z1:p.z,z2:p.z},.06);
 const point=(p:Point)=>{if(domain.contains(p))origins.set(`${p.x.toFixed(3)}:${p.z.toFixed(3)}`,p);};
 for(const c of domain.cells)point(cellCenter(maze,c));
 for(const m of maze.layout!.modules){const width=m.type==='2x6'&&m.rotation===0?6:2,height=m.type==='2x6'&&m.rotation===90?6:2;for(const x of [m.x+.31,m.x+width-.31])for(const z of [m.z+.31,m.z+height-.31])point({x,z});}
 for(const h of maze.layout!.spaces??[])if(h.kind==='hall')for(const x of [h.x+.31,h.x+h.width-.31])for(const z of [h.z+.31,h.z+h.height-.31])point({x,z});
 const trace=(a:Point,dx:number,dz:number)=>{
  const cap=limit+.01,sx=dx>0?1:-1,sz=dz>0?1:-1;let x=Math.floor(a.x),z=Math.floor(a.z),best=cap,t=0;
  for(let step=0;step<2*cap+10&&t<=best;step++){
   for(const i of grid.get(`${x}:${z}`)??[]){const b=boxes[i]!;let lo=0,hi=best;
    for(const [origin,direction,min,max]of [[a.x,dx,b.x1,b.x2],[a.z,dz,b.z1,b.z2]]){if(Math.abs(direction!)<1e-10){if(origin!<min!||origin!>max!){lo=Infinity;break;}}else{const p=(min!-origin!)/direction!,q=(max!-origin!)/direction!;lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));}}
    if(lo>=0&&lo<=hi)best=Math.min(best,lo);
   }
   const tx=Math.abs(dx)<1e-10?Infinity:(x+(sx>0?1:0)-a.x)/dx,tz=Math.abs(dz)<1e-10?Infinity:(z+(sz>0?1:0)-a.z)/dz,next=Math.min(tx,tz);if(best<=next+1e-9)return best;
   if(tx<=tz+1e-9)x+=sx;if(tz<=tx+1e-9)z+=sz;t=next;
  }return best;
 };
 let maximum=0,rays=0,origin:Point={x:0,z:0},angle=0;
 outer:for(const a of origins.values())for(let degrees=0;degrees<180;degrees+=angularStep){const r=degrees*Math.PI/180,dx=Math.cos(r),dz=Math.sin(r),length=trace(a,dx,dz)+trace(a,-dx,-dz);rays+=2;if(length>maximum){maximum=length;origin=a;angle=r;}if(maximum>limit+1e-6)break outer;}
 const result={maximum,exceeded:maximum>limit+1e-6,rays,origin,angle,angularStep};if(!cache.has(cacheKey))cache.set(cacheKey,new Map());cache.get(cacheKey)!.set(key,result);return result;
}
