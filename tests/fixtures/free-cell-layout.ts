import {domainOf} from '../../src/core/domain';
import {cellCenter,walls,portalPoint,DEFAULT_CONSTRUCTION,type Maze} from '../../src/core/maze';
import {mazePortals} from '../../src/core/portals';
import {freeMaze,anchorGeometry} from '../../src/free/layout';
import {emptyLayout} from '../../src/free/model';
/** Fixture adapter only. The product never rasterizes its free layouts. */
export function freeCellLayout(source:Maze,angle=0,scale=1):Maze{
 const l=emptyLayout(),d=domainOf(source),mapping=new Map(d.cells.map((c,i)=>[c,i])),a=angle*Math.PI/180;
 const turn=(p:{x:number;z:number})=>({x:20+scale*(p.x*Math.cos(a)-p.z*Math.sin(a)),z:2+scale*(p.x*Math.sin(a)+p.z*Math.cos(a))});
 l.modules=d.cells.map(c=>({id:`cell-${c}`,type:'custom',width:2*scale,depth:2*scale,...turn(cellCenter(source,c)),angle}));
 const sides={north:0,east:1,south:2,west:3} as const;
 for(const c of d.cells)for(const n of source.passages[c]!)if(n>c){const p=cellCenter(source,c),q=cellCenter(source,n),side=q.x>p.x?1:q.x<p.x?3:q.z>p.z?2:0;l.connections.push({id:`edge-${c}-${n}`,a:{room:`cell-${c}`,edge:side,offset:0},b:{room:`cell-${n}`,edge:(side+2)%4,offset:0},width:2*scale});}
 l.openings=mazePortals(source).map((p,i)=>({id:`opening-${i}`,room:`cell-${p.cell}`,edge:sides[p.side],offset:0,width:2*scale}));l.entrance=l.openings[0]!.id;l.exit=l.openings[1]!.id;
 l.preservedPanels=walls(source).map(w=>{const p=turn({x:w.x1,z:w.z1}),q=turn({x:w.x2,z:w.z2});return {...w,x1:p.x,z1:p.z,x2:q.x,z2:q.z};});
 // Keep source endpoint selection independent of the fixture's enumeration.
 l.entrance=l.openings[mazePortals(source).findIndex(p=>p.cell===source.entrance.cell&&p.side===source.entrance.side)]!.id;l.exit=l.openings[mazePortals(source).findIndex(p=>p.cell===source.exit.cell&&p.side===source.exit.side)]!.id;
 const m=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:80,rows:80,moduleSize:2,corridorWidth:2,algorithm:'prim',seed:'free-cell-fixture',extraConnections:0},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:l});
 if(m.entrance.cell!==mapping.get(source.entrance.cell)||Math.hypot(portalPoint(m,m.entrance).x-anchorGeometry(l,l.openings.find(o=>o.id===l.entrance)!,2*scale).mid.x)>1e-6)throw Error('Fixture mapping failed');return m;
}
