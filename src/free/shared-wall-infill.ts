import type {Maze,Point,Wall} from '../core/maze';
import type {Anchor,FreeDraft,FreeLayout} from './model';
import {mazeDraft} from './json';
import {anchorGeometry,connectionGeometry,freeMaze,modulePolygon,physical,rooms,validateFree} from './layout';
import {distance,edges,ends,lerp,overlap,quantize} from './geometry';

/** Coincident boundaries are one physical fabric panel. Native v5 authoritative
 * panels retain those boundaries and their real posts without zero-length
 * connector sides. No floor or collision obstacle is approximated by cells. */
export function sharedPanels(d:FreeDraft):FreeDraft{
 const result=structuredClone(d);delete result.layout.preservedPanels;delete result.layout.preservedSupports;
 const p=physical(result.layout),unique=new Map<string,Wall>();
 for(const wall of p.panels){if(distance(...ends(wall))<1e-7)continue;const key=ends(wall).map(p=>`${quantize(p.x)}:${quantize(p.z)}`).sort().join('/');unique.set(key,wall);}
 result.layout.preservedPanels=[...unique.values()];result.layout.preservedSupports=p.posts;return result;
}
function separation(l:FreeLayout,from:string,to:string){const q=[from],d=new Map([[from,0]]);for(const a of q)for(const c of l.connections){const b=c.a.room===a?c.b.room:c.b.room===a?c.a.room:null;if(b&&!d.has(b)){d.set(b,d.get(a)!+1);q.push(b);}}return d.get(to)??0;}
function freeAnchor(l:FreeLayout,a:Anchor,width:number){return ![...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings].some(o=>o.room===a.room&&o.edge===a.edge&&Math.abs(o.offset-a.offset)<(o.width+width)/2+.12);}
export interface SharedWallResult{maze:Maze;addedPassages:number;sharedWallLength:number;sharedModuleIds:string[];attempts:number}
/** Add two-ended passages flush against existing module walls, rather than
 * separate corridor strips. Modules, portal positions and old floors stay put. */
export function sharedWallInfill(base:Maze,maxPassages=8,onProgress?:(s:string)=>void):SharedWallResult{
 if(!base.free||base.free.bridges?.length||base.free.preservedPanels)throw Error('Нужна исходная одноэтажная свободная карта с обычными стенами.');
 let draft=mazeDraft(base),addedPassages=0,sharedWallLength=0,attempts=0;const sharedModuleIds:string[]=[];
 for(let pass=0;pass<maxPassages;pass++){
  const l=draft.layout,occupied=physical(l).polygons,choices:{module:string;edge:number;poly:Point[];target:Anchor;side:number;offset:number;width:number;score:number}[]=[];
  for(const module of l.modules.filter(m=>!m.frameOnly&&!sharedModuleIds.includes(m.id)))for(const [edge,wall]of edges(modulePolygon(module)).entries()){
   const width=1.4,a={room:module.id,edge,offset:0};if(!freeAnchor(l,a,width))continue;
   const g=anchorGeometry(l,a,width),[p,q]=ends(wall),n={x:g.normal.x*1.6,z:g.normal.z*1.6},poly=[q,p,{x:p.x+n.x,z:p.z+n.z},{x:q.x+n.x,z:q.z+n.z}];
   if(occupied.some(r=>overlap(poly,r)))continue;
   const id=`shared-passage-${pass}`,temp={...l,spaces:[...l.spaces,{id,kind:'corridor'as const,polygon:poly}]};
   for(const room of rooms(l)){
    const apart=separation(l,module.id,room.id);if(apart<5)continue;
    for(const [targetEdge,targetWall]of edges(room.polygon).entries()){
     const targetLength=distance(...ends(targetWall));if(targetLength<width+.1)continue;
     for(const targetOffset of targetLength>3?[-(targetLength-width)/2+.1,0,(targetLength-width)/2-.1]:[0]){
      const target={room:room.id,edge:targetEdge,offset:targetOffset};if(!freeAnchor(l,target,width))continue;const end=anchorGeometry(l,target,width);
      for(const side of [1,2,3]){const length=distance(poly[side]!,poly[(side+1)%4]!);if(length<width+.1)continue;
       for(const offset of length>3?[-(length-width)/2+.1,0,(length-width)/2-.1]:[0]){const start=anchorGeometry(temp,{room:id,edge:side,offset},width),gap=distance(start.mid,end.mid);if(gap<.1||gap>2.9)continue;
        const v={x:end.mid.x-start.mid.x,z:end.mid.z-start.mid.z};if((v.x*start.normal.x+v.z*start.normal.z)/gap<.8||-(v.x*end.normal.x+v.z*end.normal.z)/gap<.8)continue;
        const c={id:'probe',a:{room:id,edge:side,offset},b:target,width},cg=connectionGeometry(temp,c);if([...occupied,poly].some(r=>overlap(cg.polygon,r)))continue;
        choices.push({module:module.id,edge,poly,target,side,offset,width,score:apart-gap});
       }
      }
     }
    }
   }
  }
  choices.sort((a,b)=>b.score-a.score);let accepted=false;
  for(const c of choices.slice(0,80)){
   attempts++;const next=structuredClone(draft),id=`shared-passage-${pass}`;delete next.layout.preservedPanels;delete next.layout.preservedSupports;
   next.layout.spaces.push({id,kind:'corridor',polygon:c.poly});next.layout.connections.push({id:id+'-shared-door',a:{room:c.module,edge:c.edge,offset:0},b:{room:id,edge:0,offset:0},width:c.width},{id:id+'-link',a:{room:id,edge:c.side,offset:c.offset},b:c.target,width:c.width});
   next.layout.supports??=[];for(const w of edges(c.poly)){const [a,b]=ends(w),n=Math.ceil(distance(a,b)/2.5);for(let k=0;k<=n;k++)next.layout.supports.push(lerp(a,b,k/n));}
   const normalized=sharedPanels(next);if(validateFree(normalized).length)continue;
   // Keep ordinary geometry while choosing more passages; normalize once all
   // additional doors are present so every panel is cut at every real opening.
   draft=next;addedPassages++;sharedModuleIds.push(c.module);sharedWallLength+=distance(c.poly[0]!,c.poly[1]!)-c.width;accepted=true;onProgress?.(`Проходов вдоль стен модулей: ${addedPassages}`);break;
  }
  if(!accepted)break;
 }
 if(!addedPassages)throw Error('Не найдены проходимые промежутки вдоль модулей с повторным выходом в лабиринт.');
 draft.parameters={...draft.parameters,seed:base.parameters.seed+'-shared-walls'};
 return {maze:freeMaze(sharedPanels(draft)),addedPassages,sharedWallLength,sharedModuleIds,attempts};
}
