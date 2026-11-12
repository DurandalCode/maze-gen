import type {Maze,Point} from '../core/maze';
import type {Anchor,FreeDraft,FreeLayout} from './model';
import {buildNavigation,rooms,validateFree} from './layout';
import {distance,edges,ends} from './geometry';
import type {CavityRecord} from './cavity-inventory';
import type {CavityCell} from './cavity-structure';
import {CollisionWorld} from '../simulation/collisions';
export interface Gate{cell:number;anchor:Anchor;parent:Anchor;width:number;from:Point;to:Point}
export interface CavityLedger extends CavityRecord{status:'unprocessed'|'filled'|'partial'|'blocked'|'excluded';filledArea:number;blockedArea:number;cells:number;doors:number;closedWalls:number;loops:number;components:{area:number;state:'filled'|'blocked';reason:string}[]}
export interface CavityMazeResult{maze:Maze;ledger:CavityLedger[];filledArea:number;chambers:number;externalDoors:number;internalDoors:number;closedWalls:number}
export function gatesFor(cells:CavityCell[],layout:FreeLayout):Gate[]{
 const result:Gate[]=[],used=[...layout.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...layout.openings];
 for(let cell=0;cell<cells.length;cell++)for(const [edge,wa]of edges(cells[cell]!.polygon).entries())for(const room of rooms(layout))for(const [parentEdge,wb]of edges(room.polygon).entries()){
  const [a,b]=ends(wa),[p,q]=ends(wb),length=distance(a,b);if(length<1.25)continue;const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;if(Math.abs((p.x-a.x)*dz-(p.z-a.z)*dx)>1e-6||Math.abs((q.x-a.x)*dz-(q.z-a.z)*dx)>1e-6)continue;
  const tp=(p.x-a.x)*dx+(p.z-a.z)*dz,tq=(q.x-a.x)*dx+(q.z-a.z)*dz,lo=Math.max(0,Math.min(tp,tq)),hi=Math.min(length,Math.max(tp,tq));if(hi-lo<1.25)continue;
  const width=Math.min(1.4,hi-lo-.12),mid={x:a.x+dx*(lo+hi)/2,z:a.z+dz*(lo+hi)/2},from={x:mid.x-dx*width/2,z:mid.z-dz*width/2},to={x:mid.x+dx*width/2,z:mid.z+dz*width/2},lengthB=distance(p,q),parent={room:room.id,edge:parentEdge,offset:((mid.x-p.x)*(q.x-p.x)+(mid.z-p.z)*(q.z-p.z))/lengthB-lengthB/2};
  if(used.some(o=>o.room===parent.room&&o.edge===parent.edge&&Math.abs(o.offset-parent.offset)<(o.width+width)/2+.15))continue;
  result.push({cell,anchor:{room:cells[cell]!.id,edge,offset:(lo+hi)/2-length/2},parent,width,from,to});
 }
 return result;
}
export function physicallyOpen(draft:FreeDraft){const issues=validateFree(draft,false);if(issues.length)return issues.map(i=>i.code).join(',');const r=buildNavigation(draft.layout);if(r.paths.some(p=>!p))return 'clearance:'+r.paths.flatMap((p,i)=>!p?[draft.layout.connections[i]?.id??'portal']:[]).join(',');const world=new CollisionWorld([...r.panels,...r.posts.map(p=>({x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:.12}))]);for(const path of r.edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});if(distance(end,b)>1e-5)return 'collision';}return '';}
/** Seeded generation *inside* negative spaces, with selective openings and a
 * complete accounting ledger. The source organic composition remains intact. */
export {generateModuleCavityMaze as generateCavityMaze} from './module-cavity-maze';
