import type {Maze,Point} from '../core/maze';
import {nativeFloorBoundary} from './open-pockets';
import {area,distance,edges,ends} from './geometry';
export interface CavityRecord{id:string;kind:'closed'|'bay';polygon:Point[];area:number;mouth:number;existingBoundary:number;state:'candidate'|'outside'|'too-small';reason:string}
const signed=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0)/2;
const key=(p:Point)=>`${Math.round(p.x*1e6)}:${Math.round(p.z*1e6)}`;
function hull(points:Point[]){const sorted=[...new Map(points.map(p=>[key(p),p])).values()].sort((a,b)=>a.x-b.x||a.z-b.z),cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);const low:Point[]=[],high:Point[]=[];for(const p of sorted){while(low.length>1&&cross(low.at(-2)!,low.at(-1)!,p)<=1e-8)low.pop();low.push(p);}for(const p of [...sorted].reverse()){while(high.length>1&&cross(high.at(-2)!,high.at(-1)!,p)<=1e-8)high.pop();high.push(p);}return [...low.slice(0,-1),...high.slice(0,-1)];}
/** Exhaustive ledger within the organic hull: every closed hole and every
 * outer concavity is represented, including external/shallow and tiny parts.
 * Eligibility is explicit; it is never the count of a greedy selected subset. */
export function cavityInventory(maze:Maze):{records:CavityRecord[];hullArea:number;floorArea:number;negativeArea:number}{
 const contours=nativeFloorBoundary(maze),outer=contours.find(p=>signed(p)>0);if(!outer)throw Error('Нет единого внешнего контура органического пола.');
 const envelope=hull(outer),corners=new Set(envelope.map(key)),indices=outer.flatMap((p,i)=>corners.has(key(p))?[i]:[]),records:CavityRecord[]=[];
 const add=(kind:'closed'|'bay',polygon:Point[],mouth:number)=>{const surface=area(polygon);if(surface<1e-7)return;const perimeter=edges(polygon).reduce((s,w)=>s+distance(...ends(w)),0),existingBoundary=perimeter-mouth;
  const small=surface<2.8,outside=kind==='bay'&&existingBoundary<3*mouth;
  records.push({id:`${kind}-${records.length}`,kind,polygon:signed(polygon)>0?polygon:[...polygon].reverse(),area:surface,mouth,existingBoundary,state:small?'too-small':outside?'outside':'candidate',reason:small?'Площадь меньше минимальной камеры2.8м².':outside?`Открытый внешний скос: существующая граница${existingBoundary.toFixed(1)}м, устье${mouth.toFixed(1)}м; не окружённая ветвями внутренняя полость.`:'Окружённая ветвями область: требуется разбиение на камеры и физическая квалификация.'});};
 for(const p of contours.filter(p=>signed(p)<0))add('closed',p,0);
 for(let k=0;k<indices.length;k++){const first=indices[k]!,last=indices[(k+1)%indices.length]!,chain=[outer[first]!];for(let step=1;step<=outer.length;step++){const i=(first+step)%outer.length;chain.push(outer[i]!);if(i===last)break;}if(chain.length>2&&signed(chain)<-1e-7)add('bay',chain,distance(chain[0]!,chain.at(-1)!));}
 const hullArea=area(envelope),floorArea=contours.reduce((s,p)=>s+signed(p),0),negativeArea=records.reduce((s,r)=>s+r.area,0);if(Math.abs(hullArea-floorArea-negativeArea)>1e-4)throw Error('Учёт отрицательных областей не сходится с геометрической оболочкой.');
 return {records,hullArea,floorArea,negativeArea};
}
