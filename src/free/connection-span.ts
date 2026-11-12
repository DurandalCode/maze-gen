import type {Point} from '../core/maze';
/** Largest positive shift of the destination gate along the source normal for
 * which BOTH actual connector sides fit the requested construction span. */
export function maximumConnectionGap(source:{mid:Point;from:Point;to:Point;normal:Point},destination:{mid:Point;from:Point;to:Point},span:number):number{
 let gap=Infinity;
 for(const [from,to]of [[source.to,destination.from],[source.from,destination.to]] as const){
  const x=source.mid.x+to.x-destination.mid.x-from.x,z=source.mid.z+to.z-destination.mid.z-from.z;
  const projection=x*source.normal.x+z*source.normal.z,perpendicular=Math.max(0,x*x+z*z-projection*projection),remaining=span*span-perpendicular;
  if(remaining<0)return 0;gap=Math.min(gap,Math.sqrt(remaining)-projection);
 }
 return Math.max(0,gap);
}
