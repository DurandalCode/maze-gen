export interface OptionalDistrict {cells:number[];gates:number[];entries:{gate:number;cell:number}[]}
/** Remove only the selected reference route, then keep each remaining connected
 * component whole. A loop with two doors at one route junction still has one
 * attachment; an alternative joining distinct route junctions has two. */
export function optionalDistricts(passages:readonly (readonly number[])[],active:readonly number[],route:readonly number[]):OptionalDistrict[]{
 const allowed=new Set(active),onRoute=new Set(route),seen=new Set(route),result:OptionalDistrict[]=[];
 for(const first of active){if(seen.has(first))continue;const cells=[first],entries:OptionalDistrict['entries']=[];seen.add(first);
 for(let i=0;i<cells.length;i++)for(const n of passages[cells[i]!]??[]){if(!allowed.has(n))continue;if(onRoute.has(n))entries.push({gate:n,cell:cells[i]!});else if(!seen.has(n)){seen.add(n);cells.push(n);}}
 if(entries.length)result.push({cells,gates:[...new Set(entries.map(e=>e.gate))].sort((a,b)=>a-b),entries});
 }return result;
}

export interface DistrictAttachment {extent:number;gateSpread:number;routeSpan:number;localized:boolean}
/** A district with two nearby approaches can still be a side excursion. Both
 * spatial separation and the reference-route section it bypasses must be small
 * relative to the district extent before grouping them as one local attachment. */
export function districtAttachment(bounds:{x1:number;x2:number;z1:number;z2:number},gates:{x:number;z:number;routeDistance:number}[]):DistrictAttachment{
 const extent=Math.hypot(bounds.x2-bounds.x1,bounds.z2-bounds.z1);let gateSpread=0;
 for(const a of gates)for(const b of gates)gateSpread=Math.max(gateSpread,Math.hypot(a.x-b.x,a.z-b.z));
 const routeSpan=gates.length?Math.max(...gates.map(p=>p.routeDistance))-Math.min(...gates.map(p=>p.routeDistance)):0;
 return {extent,gateSpread,routeSpan,localized:gates.length===1||gates.length>0&&gateSpread<=Math.max(6,extent*.4)&&routeSpan<=Math.max(8,extent*.7)};
}
