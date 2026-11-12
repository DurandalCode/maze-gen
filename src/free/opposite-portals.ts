import {anchorGeometry,connectionGeometry,rooms} from './layout';
import {bridgeGeometry} from './bridges';
import {EPS} from './geometry';
import type {Anchor,FreeLayout} from './model';

/** Exterior support planes, rather than different edge numbers or nearby corners.
 * Uses the physical floor footprints without building walls/posts in physical(). */
export function selectOppositePortals(layout:FreeLayout,candidates:readonly Anchor[],width:number):{a:Anchor;b:Anchor;length:number}[]{
  const polygons=rooms(layout).map(r=>r.polygon);
  for(const c of layout.connections)polygons.push(connectionGeometry(layout,c).polygon);
  for(const b of layout.bridges??[])polygons.push(bridgeGeometry(layout,b).polygon);
  const points=polygons.flat();
  if(!points.length)return [];
  const seen=new Set<string>();
  const exterior=candidates.flatMap(a=>{
    const key=JSON.stringify([a.room,a.edge,a.offset]);
    if(seen.has(key))return [];
    seen.add(key);
    try{
      const g=anchorGeometry(layout,a,width);
      return points.every(p=>(p.x-g.mid.x)*g.normal.x+(p.z-g.mid.z)*g.normal.z<=EPS)?[{a,...g}]:[];
    }catch{return [];}
  });
  const result:{a:Anchor;b:Anchor;length:number}[]=[];
  for(let i=0;i<exterior.length;i++)for(let j=i+1;j<exterior.length;j++){
    const a=exterior[i]!,b=exterior[j]!;
    if(a.normal.x*b.normal.x+a.normal.z*b.normal.z>-.75+EPS)continue;
    const dx=b.mid.x-a.mid.x,dz=b.mid.z-a.mid.z,length=Math.hypot(dx,dz);
    if(length<=EPS)continue;
    const ux=dx/length,uz=dz/length;
    let lo=Infinity,hi=-Infinity;
    for(const p of points){const t=p.x*ux+p.z*uz;lo=Math.min(lo,t);hi=Math.max(hi,t);}
    if(length+EPS<.85*(hi-lo))continue;
    result.push({a:a.a,b:b.a,length});
  }
  return result.sort((a,b)=>b.length-a.length).slice(0,16);
}
