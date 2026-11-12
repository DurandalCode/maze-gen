import {anchorGeometry,connectionGeometry,modulePolygon} from './layout';
import {distance,ends,overlap,segment,segmentDistance} from './geometry';
import type {FreeConnection,FreeLayout} from './model';
/** Native upright colliders are square and stay aligned to world axes. Reserve
 * their circumscribed radius before rotating a generated spiral, rather than
 * selecting a lucky global angle or reducing the player's collision radius. */
export function stabilizeVortexConnections(layout:FreeLayout,maximumWidth:number,useDoorRoute=false){
 const roots=(c:FreeConnection)=>layout.modules.filter(m=>m.id===c.a.room||m.id===c.b.room).flatMap(modulePolygon);
 const safe=(c:FreeConnection)=>{
  const g=connectionGeometry(layout,c),a={x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35},b={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35};
  return [...roots(c),g.a.from,g.a.to,g.b.from,g.b.to].every(p=>(useDoorRoute?[segment(a,g.a.mid),segment(g.a.mid,g.b.mid),segment(g.b.mid,b)]:[segment(a,b)]).every(w=>segmentDistance(p,w)>=.25+Math.SQRT2*.06+1e-5));
 };
 for(let i=0;i<layout.connections.length;i++){
  const original=layout.connections[i]!;if(safe(original))continue;
  const candidates:{c:FreeConnection;span:number}[]=[];
  for(const width of [...new Set([original.width,1.7,1.8].filter(w=>w<=maximumWidth))])for(const a of [-.18,-.1,0,.1,.18])for(const b of [-.18,-.1,0,.1,.18])try{
   const c={...original,width,a:{...original.a,offset:a},b:{...original.b,offset:b}},g=connectionGeometry(layout,c),span=Math.max(...g.sides.map(w=>distance(...ends(w))));
   if(span>3+1e-7||!safe(c)||layout.modules.some(m=>overlap(g.polygon,modulePolygon(m)))||layout.connections.some((other,j)=>j!==i&&overlap(g.polygon,connectionGeometry(layout,other).polygon)))continue;
   // Both anchors are checked by connectionGeometry; retained explicitly for
   // clarity when narrower maximum doorway settings make this joint impossible.
   anchorGeometry(layout,c.a,width);anchorGeometry(layout,c.b,width);candidates.push({c,span});
  }catch{/* This pair of offsets does not fit its real module faces. */}
  candidates.sort((a,b)=>b.span-a.span||a.c.width-b.c.width);const best=candidates[0];if(!best)throw Error('Вортекс: не удалось обеспечить проход у стоек для '+original.id);
  layout.connections[i]={...best.c,spanAudit:{desired:3,actual:best.span,reason:'Запас для квадратных стоек при любом общем повороте; пролёт выбран максимально допустимым между реальными рамами.'}};
 }
}
