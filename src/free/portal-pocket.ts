import type {Anchor,FreeLayout,FreeOpening} from './model';
import {anchorGeometry} from './layout';
import {edges,ends,distance,lerp} from './geometry';
/** A real offset vestibule outside an exposed boundary door. Its inner wall
 * screens the full useful portal width while leaving a continuous 2 m floor. */
export function addPortalPocket(layout:FreeLayout,anchor:Anchor,id:string,width:number,side=1):FreeOpening{
 const g=anchorGeometry(layout,anchor,width),n=g.normal,t={x:-n.z*side,z:n.x*side};
 const poly=[[1.2,-1],[5.2,-1],[5.2,3],[6,3],[6,5],[3.2,5],[3.2,1],[1.2,1]].map(([x,z])=>({x:g.mid.x+n.x*x!+t.x*z!,z:g.mid.z+n.z*x!+t.z*z!}));
 if(side<0)poly.reverse();
 layout.spaces.push({id,kind:'corridor',polygon:poly});
 layout.supports??=[];
 for(const wall of edges(poly)){const [a,b]=ends(wall),pieces=Math.ceil(distance(a,b)/2.5);for(let i=0;i<=pieces;i++)layout.supports.push(lerp(a,b,i/pieces));}
 layout.connections.push({id:id+'-link',a:{...anchor},b:{room:id,edge:7,offset:0},width});
 return {id:id+'-opening',room:id,edge:3,offset:0,width:1};
}
