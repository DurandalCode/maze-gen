import type {FreeLayout} from './model';
import {connectionGeometry} from './layout';
import {distance,ends} from './geometry';
export interface OrganicCharacter{modules:number;axisSpan:number;axisDirections:number;connectionBend:{min:number;mean:number;max:number};gap:{min:number;mean:number;max:number;deviation:number};longestSide:number;spanAudit?:{audited:number;atMaximum:number;fallbacks:{connection:string;desired:number;actual:number;reason?:string}[]}}
/** Rotation-invariant measurements of individual module axes and real source
 * connectors, before cavity floors replace them with zero-length door links. */
export function organicCharacter(layout:FreeLayout):OrganicCharacter{
 const axes=layout.modules.filter(m=>!m.frameOnly).map(m=>((m.angle%90)+90)%90).sort((a,b)=>a-b),gaps:number[]=[],bends:number[]=[],sides:number[]=[];
 let largestAxisGap=90;if(axes.length>1)largestAxisGap=Math.max(...axes.map((a,i)=>(i+1<axes.length?axes[i+1]!:axes[0]!+90)-a));
 for(const c of layout.connections){const g=connectionGeometry(layout,c);gaps.push(distance(g.a.mid,g.b.mid));bends.push(Math.acos(Math.max(-1,Math.min(1,-g.a.normal.x*g.b.normal.x-g.a.normal.z*g.b.normal.z)))*180/Math.PI);sides.push(...g.sides.map(w=>distance(...ends(w))));}
 const audits=layout.connections.flatMap(c=>{const record=(c as typeof c&{spanAudit?:{desired:number;actual:number;reason?:string}}).spanAudit;return record?[{connection:c.id,...record}]:[];});
 const summary=(a:number[])=>({min:a.length?Math.min(...a):0,mean:a.length?a.reduce((s,x)=>s+x,0)/a.length:0,max:a.length?Math.max(...a):0}),gap=summary(gaps);
 return {modules:axes.length,axisSpan:Math.max(0,90-largestAxisGap),axisDirections:new Set(axes.map(a=>Math.round(a*2)%180)).size,connectionBend:summary(bends),gap:{...gap,deviation:gaps.length?Math.sqrt(gaps.reduce((s,x)=>s+(x-gap.mean)**2,0)/gaps.length):0},longestSide:sides.length?Math.max(...sides):0,...(audits.length?{spanAudit:{audited:audits.length,atMaximum:audits.filter(a=>Math.abs(a.actual-a.desired)<=1e-6).length,fallbacks:audits.filter(a=>a.actual<a.desired-1e-6)}}:{})};
}
