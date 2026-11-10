import {domainOf} from './domain';
import {axisCuts,footprintContains,footprintSummary,mm} from './corridor-geometry';
import type {Maze} from './maze';
export function corridorSpaceSummary(maze:Maze){
 const domain=domainOf(maze),siteArea=footprintSummary(maze.parameters).area,halls=maze.layout?.spaces?.filter(r=>r.kind==='hall')??[],xs=axisCuts(maze,'x'),zs=axisCuts(maze,'z'),width=xs.length-1,height=zs.length-1,voids=new Set<number>();
 for(let z=0;z<height;z++)for(let x=0;x<width;x++){const c=z*width+x;if(!domain.active[c]&&footprintContains(maze.parameters,mm((xs[x]!+xs[x+1]!)/2),mm((zs[z]!+zs[z+1]!)/2)))voids.add(c);}
 let islands=0,islandArea=0;while(voids.size){const first=voids.values().next().value!,queue=[first];voids.delete(first);let closed=true,area=0;
 for(let j=0;j<queue.length;j++){const c=queue[j]!,x=c%width,z=Math.floor(c/width);area+=(xs[x+1]!-xs[x]!)*(zs[z+1]!-zs[z]!);for(const [a,b]of [[x-1,z],[x+1,z],[x,z-1],[x,z+1]]){if(a!<0||a!>=width||b!<0||b!>=height){closed=false;continue;}const n=b!*width+a!;if(voids.delete(n))queue.push(n);else if(!domain.active[n]&&!footprintContains(maze.parameters,mm((xs[a!]!+xs[a!+1]!)/2),mm((zs[b!]!+zs[b!+1]!)/2)))closed=false;}}
 if(closed){islands++;islandArea+=area;}}
 return {siteArea,walkableArea:domain.area,inaccessibleArea:siteArea-domain.area,halls:halls.length,hallArea:halls.reduce((s,r)=>s+r.width*r.height,0),islands,islandArea};
}
