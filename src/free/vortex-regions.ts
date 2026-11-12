import{connectionGeometry}from'./layout';import{segmentDistance}from'./geometry';
import type {FreeLayout} from './model';
import{connectVortexFrames,insertVortexReturnFrame}from'./vortex-knots';
/** Each district keeps exactly its two doors at the original route fork.
 * Cross-links lead through the former side branches, not out to another route
 * sector. Thus exploration gains nested returns without turning K into a bypass. */
export function deepenVortexRegions(l:FreeLayout,maxWidth:number,progress?:(s:string)=>void){
 const e=Number(l.openings.find(o=>o.id===l.entrance)!.room.match(/^spiral(\d)-23$/)![1]),s=(a:number,j:number)=>`spiral${(a+e+3)%4}-${j}`;
 const plans=[[s(1,13),s(2,8),'k1-inner-return'],[s(0,11),s(1,6),'k2-inner-return'],[s(0,13),s(3,20),'k2-cross-return']];
 if(!insertVortexReturnFrame(l,s(0,18),s(1,13),'vortex-district-k1-pocket',maxWidth))throw Error('Не помещается глубокий модульный карман К1.');
 for(const[a,b,id]of plans){if(!connectVortexFrames(l,a!,b!,'vortex-district-'+id,maxWidth))throw Error('Не помещается внутренний возвратный район: '+id);progress?.('Внутренний выбор возвратного района: '+id);}
 for(const c of l.connections.filter(c=>c.id.startsWith('vortex-district-'))){const g=connectionGeometry(l,c);if(Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1)throw Error('Внутренний переход района уже метра.');}
}
