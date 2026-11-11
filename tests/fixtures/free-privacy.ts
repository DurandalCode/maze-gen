import {DEFAULT_CONSTRUCTION} from '../../src/core/maze';
import {emptyLayout} from '../../src/free/model';
import {physical,freeMaze} from '../../src/free/layout';
/** Native free geometry. No legacy Maze, routing grid or legacy decoder. */
export function freePrivacyFixture(angle=0){
 const l=emptyLayout(),r=angle*Math.PI/180,turn=(x:number,z:number)=>({x:10+x*Math.cos(r)-z*Math.sin(r),z:10+x*Math.sin(r)+z*Math.cos(r)});
 l.modules=Array.from({length:12},(_,i)=>({id:`room-${i}`,type:'2x2',...turn(1+2*(i%4),1+2*Math.floor(i/4)),angle}));
 for(const [a,b]of [[8,4],[4,5],[5,9],[0,1],[1,2],[2,3],[3,7],[7,6],[6,10],[10,11],[10,9] ] as [number,number][]){const side=b===a+1?1:b===a-1?3:b>a?2:0;l.connections.push({id:`link-${a}-${b}`,a:{room:`room-${a}`,edge:side,offset:0},b:{room:`room-${b}`,edge:(side+2)%4,offset:0},width:2});}
 l.openings=[{id:'entrance',room:'room-8',edge:2,offset:0,width:2},{id:'exit',room:'room-3',edge:0,offset:0,width:2}];l.entrance='entrance';l.exit='exit';
 const key=(w:{x1:number;z1:number;x2:number;z2:number})=>[[w.x1,w.z1].map(v=>v.toFixed(7)).join(':'),[w.x2,w.z2].map(v=>v.toFixed(7)).join(':')].sort().join('|');
 l.preservedPanels=[...new Map(physical(l).panels.filter(w=>Math.hypot(w.x1-w.x2,w.z1-w.z2)>1e-7).map(w=>[key(w),w])).values()];
 return freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:30,rows:30,corridorWidth:2,moduleSize:2,seed:'native-free-privacy',algorithm:'prim',extraConnections:0},construction:{...DEFAULT_CONSTRUCTION},layout:l});
}
