import {walls,type Maze,type Point,type Wall} from '../core/maze';
import {domainOf} from '../core/domain';
import {supportColliders} from '../core/structure';
import {rayWall} from '../free/geometry';
import {freeRay} from '../free/layout';
/** Geometry broad phase in metres. Buckets are unrelated to maze cells/adjacency. */
export function physicalRaycaster(input:Maze){
 const maze=input.navigation?.source??input;if(maze.free)return (from:Point,angle:number,limit:number)=>freeRay(maze,from,angle,limit);
 const size=2,buckets=new Map<string,Wall[]>(),solids=[...walls(maze),...supportColliders(maze),...domainOf(maze).boundary.map(e=>({...e.wall,thickness:0}))];
 for(const w of solids){const h=(w.thickness??.06)/2*Math.SQRT2;for(let x=Math.floor((Math.min(w.x1,w.x2)-h)/size);x<=Math.floor((Math.max(w.x1,w.x2)+h)/size);x++)for(let z=Math.floor((Math.min(w.z1,w.z2)-h)/size);z<=Math.floor((Math.max(w.z1,w.z2)+h)/size);z++){const key=`${x}:${z}`,bucket=buckets.get(key)??[];bucket.push(w);buckets.set(key,bucket);}}
 return (from:Point,angle:number,limit:number)=>{
  const dx=Math.cos(angle),dz=Math.sin(angle),sx=Math.sign(dx),sz=Math.sign(dz),tx=Math.abs(dx)>1e-12?size/Math.abs(dx):Infinity,tz=Math.abs(dz)>1e-12?size/Math.abs(dz):Infinity;
  let x=Math.floor(from.x/size),z=Math.floor(from.z/size),nextX=Math.abs(dx)>1e-12?((x+(sx>0?1:0))*size-from.x)/dx:Infinity,nextZ=Math.abs(dz)>1e-12?((z+(sz>0?1:0))*size-from.z)/dz:Infinity,best=limit,at=0;const seen=new Set<Wall>();
  while(at<=best){for(const w of buckets.get(`${x}:${z}`)??[])if(!seen.has(w)){seen.add(w);best=Math.min(best,rayWall(from,angle,w,best));}if(best<Math.min(nextX,nextZ))break;if(nextX<nextZ){at=nextX;nextX+=tx;x+=sx;}else if(nextZ<nextX){at=nextZ;nextZ+=tz;z+=sz;}else{at=nextX;nextX+=tx;nextZ+=tz;x+=sx;z+=sz;}}
  return best;
 };
}
