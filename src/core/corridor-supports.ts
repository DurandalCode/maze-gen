import {corridorPortalWall} from './corridor-portals';
import {walls,type Maze,type Point} from './maze';
import {footprint,mergeWalls,metres,mm} from './corridor-geometry';
/** Module corners plus physical wall ends/jambs. Collinear raster subdivisions
 * are merged first: they must not turn into extra construction uprights. */
export function corridorSupports(maze:Maze):Point[]{
 const source=maze.navigation?.source??maze,points=new Map<string,Point>();
 const add=(x:number,z:number)=>{const a=mm(x),b=mm(z);points.set(`${a}:${b}`,{x:metres(a),z:metres(b)});};
 for(const m of source.layout!.modules){const r=footprint(m);for(const x of [r.x1,r.x2])for(const z of [r.z1,r.z2])add(metres(x),metres(z));}
 for(const portal of source.portals??[source.entrance,source.exit]){if(portal.width===undefined)continue;const w=corridorPortalWall(source,portal);if(w){add(w.x1,w.z1);add(w.x2,w.z2);}}
 const panels=mergeWalls(walls(source));for(const w of panels){add(w.x1,w.z1);add(w.x2,w.z2);}
 for(const a of panels)if(a.x1===a.x2)for(const b of panels)if(b.z1===b.z2&&a.x1>=Math.min(b.x1,b.x2)&&a.x1<=Math.max(b.x1,b.x2)&&b.z1>=Math.min(a.z1,a.z2)&&b.z1<=Math.max(a.z1,a.z2))add(a.x1,b.z1);
 // Explicit perimeter/standalone supports are part of the visible construction
 // and bill of materials. Never subdivide a rail-supported long module side.
 const modules=source.layout!.modules.map(footprint);
 for(const wall of panels){const vertical=wall.x1===wall.x2,lo=mm(vertical?wall.z1:wall.x1),hi=mm(vertical?wall.z2:wall.x2),fixed=mm(vertical?wall.x1:wall.z1),positions=[...points.values()].filter(p=>vertical?mm(p.x)===fixed&&mm(p.z)>=lo&&mm(p.z)<=hi:mm(p.z)===fixed&&mm(p.x)>=lo&&mm(p.x)<=hi).map(p=>mm(vertical?p.z:p.x)).sort((a,b)=>a-b);
  for(let i=1;i<positions.length;i++){const a=positions[i-1]!,b=positions[i]!,carried=modules.some(r=>vertical?(fixed===r.x1||fixed===r.x2)&&a>=r.z1&&b<=r.z2:(fixed===r.z1||fixed===r.z2)&&a>=r.x1&&b<=r.x2);if(b-a<=3000||carried)continue;const spans=Math.ceil((b-a)/3000);for(let j=1;j<spans;j++){const v=Math.round(a+(b-a)*j/spans);if(vertical)add(metres(fixed),metres(v));else add(metres(v),metres(fixed));}}
 }
 return [...points.values()].sort((a,b)=>a.x-b.x||a.z-b.z);
}
/** A free fabric span is measured between actual uprights. A long module's
 * own rail can carry its six-metre side; free corridor fabric cannot. */
export function validateFabricSupports(maze:Maze):void{
 const points=corridorSupports(maze),modules=maze.layout!.modules.map(footprint);
 for(const wall of mergeWalls(walls(maze))){const vertical=wall.x1===wall.x2,lo=vertical?wall.z1:wall.x1,hi=vertical?wall.z2:wall.x2,positions=points.filter(p=>vertical?p.x===wall.x1&&p.z>=lo&&p.z<=hi:p.z===wall.z1&&p.x>=lo&&p.x<=hi).map(p=>vertical?p.z:p.x).sort((a,b)=>a-b);
  for(let i=1;i<positions.length;i++){const a=positions[i-1]!,b=positions[i]!;if(b-a<=3+1e-7)continue;const carried=modules.some(r=>vertical?(mm(wall.x1)===r.x1||mm(wall.x1)===r.x2)&&mm(a)>=r.z1&&mm(b)<=r.z2:(mm(wall.z1)===r.z1||mm(wall.z1)===r.z2)&&mm(a)>=r.x1&&mm(b)<=r.x2);if(!carried)throw Error(`Unsupported fabric span: ${JSON.stringify(wall)} from ${a} to ${b}`);}
 }
}
