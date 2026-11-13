import {portalPoint,type Maze} from '../core/maze';
import type {DirectionMarker} from '../simulation/direction-markers';
import {markerDirection,markerBearing} from '../simulation/direction-markers';
import type {Sample} from '../simulation/recorder';
export function directionError(a:{x:number;z:number},b:{x:number;z:number}):number|null{
 const n=Math.hypot(a.x,a.z)*Math.hypot(b.x,b.z);return n<1e-9?null:Math.acos(Math.max(-1,Math.min(1,(a.x*b.x+a.z*b.z)/n)))*180/Math.PI;
}
/** Post-walk comparison only. The exit vector is geometric, NOT a route bearing. */
export function analyseDirectionMarkers(maze:Maze,markers:readonly DirectionMarker[],samples:readonly Sample[]){
 const exit=portalPoint(maze,maze.exit);
 return markers.map((marker,index)=>{
  const direction=markerDirection(marker.yaw);let lo=0,hi=samples.length;while(lo<hi){const mid=(lo+hi)>>>1;if(samples[mid]!.time<=marker.time)lo=mid+1;else hi=mid;}
  let next:Sample|undefined;for(let i=lo;i<samples.length&&samples[i]!.time<=marker.time+5;i++){const p=samples[i]!;if(Math.hypot(p.x-marker.x,p.z-marker.z)>=.75){next=p;break;}}
  return {index,marker,bearing:markerBearing(marker.yaw),exitError:directionError(direction,{x:exit.x-marker.x,z:exit.z-marker.z}),
   movementError:next?directionError(direction,{x:next.x-marker.x,z:next.z-marker.z}):null,movementSeconds:next?next.time-marker.time:null};
 });
}
