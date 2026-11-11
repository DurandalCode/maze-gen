import {freeSpatialRay} from '../free/spatial-visibility';
import {domainOf} from './domain';
import {walls,type Maze,type Point} from './maze';
import {supportColliders} from './structure';
interface Box {x1:number;x2:number;y1:number;y2:number;z1:number;z2:number;fabric?:boolean;roof?:boolean}
const cache=new WeakMap<Maze,Box[]>();
function boxes(maze:Maze):Box[]{
  const old=cache.get(maze);if(old)return old;const s=maze.storeys!,result:Box[]=[];
  for(const w of [...walls(maze),...supportColliders(maze)]){const h=(w.thickness??.06)/2;result.push({x1:Math.min(w.x1,w.x2)-h,x2:Math.max(w.x1,w.x2)+h,z1:Math.min(w.z1,w.z2)-h,z2:Math.max(w.z1,w.z2)+h,y1:w.y??0,y2:(w.y??0)+(w.height??maze.wallHeight),fabric:w.thickness===undefined});}
  const n=s.floors[0].passages.length;
  for(const [i,node]of s.nodes.entries()){
    if(!node||node.stair!==undefined)continue;const r=node.rect;
    if(node.floor===1)result.push({...r,y1:s.floorHeight-s.slabThickness,y2:s.floorHeight});
    if(maze.roof&&(node.floor===1||!s.nodes[i+n]))result.push({...r,y1:(node.center.y??0)+maze.wallHeight,y2:(node.center.y??0)+maze.wallHeight+.06,fabric:true,roof:true});
  }
  cache.set(maze,result);return result;
}
function intersection(from:Point,direction:Point,b:Box,limit:number):number|null {
  let lo=0,hi=limit;
  for(const [p,d,min,max]of [[from.x,direction.x,b.x1,b.x2],[from.z,direction.z,b.z1,b.z2],[from.y??0,direction.y??0,b.y1,b.y2]]){
    if(Math.abs(d!)<1e-12){if(p!<min!||p!>max!)return null;continue;}
    const a=(min!-p!)/d!,c=(max!-p!)/d!;lo=Math.max(lo,Math.min(a,c));hi=Math.min(hi,Math.max(a,c));if(lo>hi)return null;
  }
  return hi>1e-6?Math.max(0,lo):null;
}
export function spatialRay(maze:Maze,from:Point,direction:Point,limit:number,cue?:'sun'|'forest'):{length:number;strength:number}{
  if(maze.free?.bridges?.length)return freeSpatialRay(maze,from,direction,limit,cue);
  const hits:{t:number;fabric?:boolean;roof?:boolean}[]=[];
  for(const b of boxes(maze)){const t=intersection(from,direction,b,limit);if(t!==null)hits.push({t,fabric:b.fabric,roof:b.roof});}
  // Closed staircase volume beneath the walking surface. Solve ray/ramp intersection inside its shaft.
  for(const st of maze.storeys!.stairs){const a=st.start,b=st.end,dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,slope=st.rise*((direction.x*dx+direction.z*dz)/l2),base=st.rise*((from.x-a.x)*dx+(from.z-a.z)*dz)/l2,t=(base-(from.y??0))/((direction.y??0)-slope);
    if(t>1e-6&&t<limit){const x=from.x+direction.x*t,z=from.z+direction.z*t,u=((x-a.x)*dx+(z-a.z)*dz)/l2,cross=Math.abs((x-a.x)*dz-(z-a.z)*dx)/Math.sqrt(l2);if(u>=0&&u<=1&&cross<=st.width/2)hits.push({t});}
  }
  hits.sort((a,b)=>a.t-b.t);let strength=1;
  for(const hit of hits){if(cue==='sun'&&maze.translucentFabric&&hit.fabric){strength*=hit.roof?.55:.35;if(strength>=.2)continue;}return {length:hit.t,strength:0};}
  return {length:limit,strength};
}
export function spatialLineVisible(maze:Maze,a:Point,b:Point):boolean {
  const dx=b.x-a.x,dz=b.z-a.z,dy=(b.y??0)-(a.y??0),length=Math.hypot(dx,dz,dy);if(length<1e-8)return true;
  return spatialRay(maze,a,{x:dx/length,z:dz/length,y:dy/length},length).length>=length-1e-6;
}
export function spatialVisibleCells(maze:Maze,from:number,angle:number,limit:number):{length:number;point:Point;firstCell:number|null;endCell:number}{
  limit=Math.min(limit,Math.hypot(maze.width,maze.depth)+1);
  const s=maze.storeys!,start=s.nodes[from]!.center;
  const dx=Math.cos(angle),dz=Math.sin(angle);for(const [origin,direction,max]of [[start.x,dx,maze.width],[start.z,dz,maze.depth]])if(Math.abs(direction!)>1e-10)limit=Math.min(limit,((direction!>0?max!:0)-origin!)/direction!);
  const length=spatialRay(maze,{...start,y:(start.y??0)+1.7},{x:Math.cos(angle),z:Math.sin(angle)},limit).length;
  const point={...start,x:start.x+Math.cos(angle)*length,z:start.z+Math.sin(angle)*length};let firstCell:number|null=null,endCell=from;
  for(let d=.05;d<length;d+=.1){const p={x:start.x+Math.cos(angle)*d,z:start.z+Math.sin(angle)*d},cell=domainOf(maze).cells.find(c=>{const n=s.nodes[c]!,r=n.rect;return Math.abs((n.center.y??0)-(start.y??0))<.15&&p.x>=r.x1&&p.x<=r.x2&&p.z>=r.z1&&p.z<=r.z2;});if(cell!==undefined&&cell!==from){firstCell??=cell;endCell=cell;}}
  return {length,point,firstCell,endCell};
}
