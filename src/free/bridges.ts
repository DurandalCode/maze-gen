import type {Point,Wall} from '../core/maze';
import type {FreeBridge,FreeLayout} from './model';
import {anchorGeometry,connectionGeometry} from './layout';
import {distance,lerp,pointIn,segment,edges,overlap,wallDistance,segmentInside,centroid,ends} from './geometry';

/** A covered bridge is one reversible graph edge; its projected crossing is
 * never a connection to the ground route. Stair flights have reserved ground. */
export function bridgeGeometry(layout:FreeLayout,bridge:FreeBridge){
  const g=connectionGeometry(layout,bridge),a=g.a.mid,b=g.b.mid,length=distance(a,b);
  if(![bridge.rise,bridge.stairRun].every(Number.isFinite)||bridge.rise<2.2||bridge.rise>12||bridge.stairRun<Math.ceil(bridge.rise/.18)*.28-1e-8)throw Error('Некорректные высота или длина лестниц моста.');
  if(length-2*bridge.stairRun>6+1e-7)throw Error('Верхний пролёт моста не должен превышать 6 м.');
  if(length<2*bridge.stairRun+2)throw Error('Для моста нужны две лестницы и верхний проход не короче 2 м.');
  const ux=(b.x-a.x)/length,uz=(b.z-a.z)/length;
  if(g.a.normal.x*ux+g.a.normal.z*uz<1-1e-6||-(g.b.normal.x*ux+g.b.normal.z*uz)<1-1e-6)throw Error('Проёмы должны быть перпендикулярны оси прямого моста.');
  const t=bridge.stairRun/length,at=(s:number):Point=>({...lerp(a,b,s),y:height(s),floor:1,bridge:bridge.id});
  const height=(s:number)=>bridge.rise*Math.max(0,Math.min(1,s/t,(1-s)/t));
  const strip=(lo:number,hi:number)=>{
    const p=lerp(a,b,lo),q=lerp(a,b,hi),h=bridge.width/2;
    return [{x:p.x-uz*h,z:p.z+ux*h},{x:q.x-uz*h,z:q.z+ux*h},{x:q.x+uz*h,z:q.z-ux*h},{x:p.x+uz*h,z:p.z-ux*h}];
  };
  const polygon=strip(0,1),stairs=[strip(.35/length,t),strip(1-t,1-.35/length)],deck=strip(t,1-t),path=[at(0),at(t),at(1-t),at(1)];
  const progress=(p:Point)=>((p.x-a.x)*ux+(p.z-a.z)*uz)/length;
  const contains=(p:Point)=>pointIn(p,polygon);
  const walls=(wallHeight:number):Wall[]=>{
    const out:Wall[]=[];
    for(let i=1;i<path.length;i++){
      const p=path[i-1]!,q=path[i]!;
      for(const sign of [-1,1])out.push({bridge:bridge.id,x1:p.x-uz*bridge.width/2*sign,z1:p.z+ux*bridge.width/2*sign,x2:q.x-uz*bridge.width/2*sign,z2:q.z+ux*bridge.width/2*sign,y:Math.min(p.y!,q.y!),height:wallHeight+Math.abs(p.y!-q.y!)});
    }
    return out;
  };
  return {...g,bridge,length,ux,uz,polygon,stairs,deck,path,height,at,progress,contains,walls};
}
export function bridgeSurface(layout:FreeLayout,p:Point):Point|null{
  const bridge=layout.bridges?.find(b=>b.id===p.bridge);
  if(!bridge)return null;
  try{const g=bridgeGeometry(layout,bridge),t=g.progress(p);if(!g.contains(p)||t<0||t>1)return null;return {...p,y:g.height(t),floor:1,bridge:bridge.id};}catch{return null;}
}
/** Ground obstacles for the columns carrying each end of the upper deck. */
export function bridgeColumns(layout:FreeLayout):Point[]{
  return (layout.bridges??[]).flatMap(b=>{try{return bridgeGeometry(layout,b).deck;}catch{return [];}});
}
export function bridgeIssues(layout:FreeLayout,wallHeight:number,site:{contains:(p:Point)=>boolean;boundaries:Wall[];holes:Point[][]},ground:Point[][]):{id:string;message:string}[]{
  const out:{id:string;message:string}[]=[];
  for(const b of layout.bridges??[])try{
    const g=bridgeGeometry(layout,b);
    if(layout.preservedPanels)throw Error('Перед добавлением мостов перестройте сохранённые панели по проёмам.');
    for(const p of bridgeSamples(layout,b,.1))if(layout.walls.some(w=>(w.y??0)<p.y!+1.7&&(w.y??0)+(w.height??wallHeight)>p.y!+.05&&wallDistance(p,w)<.25))throw Error('Лестница или верхний проход моста перекрыты стеной.');
    if(b.rise-.2<wallHeight+.05)throw Error('Под мостом недостаточно высоты над стенами и крышей нижнего прохода.');
    if(!g.polygon.every(site.contains)||!edges(g.polygon).every(w=>segmentInside(...ends(w),site.contains,site.boundaries))||site.holes.some(h=>pointIn(centroid(h),g.polygon)))throw Error('Мост выходит за площадку или пересекает отверстие формы.');
    if(g.stairs.some(st=>ground.some(poly=>overlap(st,poly))))throw Error('Лестница моста пересекает нижнее пространство или проход.');
    for(const other of layout.bridges??[])if(other.id<b.id&&overlap(g.polygon,bridgeGeometry(layout,other).polygon))throw Error('Мосты пересекаются: нужны раздельные лестницы и верхние проходы.');
    // Columns must leave a player-width opening on the lower route. Navigation
    // independently rechecks the actual column solids with the ground walls.
    const a=anchorGeometry(layout,b.a,b.width),z=anchorGeometry(layout,b.b,b.width);
    if(a.room.id===z.room.id||layout.connections.some(c=>c.a.room===b.a.room&&c.b.room===b.b.room||c.b.room===b.a.room&&c.a.room===b.b.room))throw Error('Мост должен связывать разные пространства без параллельного прямого соединения.');
  }catch(e){out.push({id:b.id,message:(e as Error).message});}
  return out;
}
export const bridgeSteps=(b:FreeBridge)=>Math.ceil(b.rise/.18);
/** Keep a stable sequence for checkpoint/route validation. */
export function bridgeSamples(layout:FreeLayout,b:FreeBridge,step=.04):Point[]{
  const g=bridgeGeometry(layout,b),n=Math.ceil(g.length/step);
  return Array.from({length:n+1},(_,i)=>g.at(i/n));
}
export const bridgeBoundary=(layout:FreeLayout)=> (layout.bridges??[]).flatMap(b=>{try{return edges(bridgeGeometry(layout,b).polygon);}catch{return [];}});
export const bridgeLine=(layout:FreeLayout,b:FreeBridge)=>{const g=bridgeGeometry(layout,b);return segment(g.a.mid,g.b.mid);};

/** Roof uprights stand on the stair/deck, leaving the lower crossing open. */
export function bridgeUprights(layout:FreeLayout,wallHeight:number):Wall[]{
 const result:Wall[]=[];
 for(const b of layout.bridges??[]){const g=bridgeGeometry(layout,b);for(let i=1;i<g.path.length;i++){
  const a=g.path[i-1]!,z=g.path[i]!,pieces=Math.ceil(Math.hypot(z.x-a.x,z.z-a.z,z.y!-a.y!)/3);
  for(let k=0;k<=pieces;k++)for(const side of [-b.width/2,b.width/2]){
   const t=k/pieces,p={x:a.x+(z.x-a.x)*t-g.uz*side,z:a.z+(z.z-a.z)*t+g.ux*side,y:a.y!+(z.y!-a.y!)*t};
   if(p.y<1e-7||g.deck.some(q=>distance(p,q)<1e-7))continue;
   result.push({...segment(p,p),y:p.y,height:wallHeight,thickness:.12,bridge:b.id});
  }
 }}return result;
}

/** Ground-only external inspection must respect solid stair bodies and deck
 * slabs. Grounded bridge walking uses its explicit stair surface instead. */
export function bridgeInspectionSolids(layout:FreeLayout):Wall[]{
 const out:Wall[]=[];
 for(const b of layout.bridges??[]){const g=bridgeGeometry(layout,b),steps=bridgeSteps(b),depth=b.stairRun/steps;
  const solid=(p:Point,along:number,across:number,y:number,height:number)=>{
   const axis=along>=across?{x:g.ux,z:g.uz}:{x:-g.uz,z:g.ux},thickness=Math.min(along,across),half=Math.abs(along-across)/2;
   out.push({x1:p.x-axis.x*half,z1:p.z-axis.z*half,x2:p.x+axis.x*half,z2:p.z+axis.z*half,thickness,y,height,bridge:b.id});
  };
  for(const end of [0,1])for(let i=0;i<steps;i++){
   const t=end===0?b.stairRun/g.length*(i+.5)/steps:1-b.stairRun/g.length*(i+.5)/steps;
   solid(g.at(t),depth,b.width,0,b.rise*(i+1)/steps);
  }
  solid(g.at(.5),g.length-2*b.stairRun,b.width,b.rise-.2,.2);
 }return out;
}
