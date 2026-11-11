import {DEFAULT_CONSTRUCTION} from '../../src/core/maze';
import {emptyLayout,type FreeLayout} from '../../src/free/model';
import {physical,freeMaze} from '../../src/free/layout';
/** Explicit v5 rooms/portals; no grid runtime or legacy schema is used. */
export function roomPanels(l:FreeLayout){const key=(w:{x1:number;z1:number;x2:number;z2:number})=>[[w.x1,w.z1].join(':'),[w.x2,w.z2].join(':')].sort().join('|');delete l.preservedPanels;l.preservedPanels=[...new Map(physical(l).panels.filter(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1)>1e-7).map(w=>[key(w),w])).values()];}
export function freeRooms(columns=4,rows=4,missing:number[]=[],pairs?:[number,number][]){
 const l=emptyLayout(),on=new Set(Array.from({length:columns*rows},(_,i)=>i).filter(i=>!missing.includes(i)));l.modules=[...on].map(i=>({id:`room-${i}`,type:'2x2',x:1+2*(i%columns),z:1+2*Math.floor(i/columns),angle:0}));
 const edges=pairs??[...on].flatMap(i=>[...(i%columns+1<columns&&on.has(i+1)?[[i,i+1] as [number,number]]:[]),...(on.has(i+columns)?[[i,i+columns] as [number,number]]:[])]);
 for(const[a,b]of edges){const p=l.modules.find(m=>m.id===`room-${a}`)!,q=l.modules.find(m=>m.id===`room-${b}`)!,side=q.x>p.x?1:q.x<p.x?3:q.z>p.z?2:0;l.connections.push({id:`link-${a}-${b}`,a:{room:p.id,edge:side,offset:0},b:{room:q.id,edge:(side+2)%4,offset:0},width:2});}
 l.openings=[{id:'entrance',room:l.modules[0]!.id,edge:0,offset:0,width:2},{id:'exit',room:l.modules.at(-1)!.id,edge:2,offset:0,width:2}];l.entrance='entrance';l.exit='exit';roomPanels(l);
 return freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:columns*2,rows:rows*2,corridorWidth:2,moduleSize:2,algorithm:'prim',seed:'native-sight',extraConnections:0,...(missing.length?{shape:{kind:'grid-rectangles' as const,rectangles:[{x:0,z:0,width:columns*2,height:rows*2,operation:'add' as const},...missing.map(i=>({x:2*(i%columns),z:2*Math.floor(i/columns),width:2,height:2,operation:'subtract' as const}))]}}:{})},construction:{...DEFAULT_CONSTRUCTION},layout:l});
}
