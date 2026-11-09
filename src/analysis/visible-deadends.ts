import type {Maze} from '../core/maze';
import {mazePortals} from '../core/portals';
import {domainOf} from '../core/domain';
import {prepareNavigation,type NavigationContext} from './navigation';
import {viewCorridor} from './corridor-view';
export interface VisibleDeadEnd {from:number;to:number;end:number;cells:number[];length:number;area:number}
export interface VisibleDeadEnds {branches:VisibleDeadEnd[];cells:ReadonlySet<number>;area:number;ratio:number}
const cache=new WeakMap<Maze,{openings:Map<string,VisibleDeadEnd|null>;summary?:VisibleDeadEnds}>();
/** Conservative proof of a fully visible straight blind branch: no turn, side exit,
 * portal or unseen continuation before its terminal wall. Nothing behind a corner is inferred.
 */
export function visibleDeadEnd(maze:Maze,from:number,to:number,context:NavigationContext=prepareNavigation(maze)):VisibleDeadEnd|null {
 let data=cache.get(maze);if(!data){data={openings:new Map()};cache.set(maze,data);}
 const key=from+':'+to;if(data.openings.has(key))return data.openings.get(key)!;
 const view=viewCorridor(maze,context,from,to);
 let result:VisibleDeadEnd|null=null;
 if(view.end==='dead-end'&&view.junctions===0){
  const cells:number[]=[];let previous=from,cell=to;
  while(true){cells.push(cell);if(cell===view.endCell)break;const next=maze.passages[cell]!.find(n=>n!==previous);if(next===undefined)break;previous=cell;cell=next;}
  const portals=new Set(mazePortals(maze).map(p=>p.cell));
  if(cells.at(-1)===view.endCell&&!cells.some(c=>portals.has(c))){
   const domain=domainOf(maze),area=cells.reduce((sum,c)=>{const r=domain.rectangles[c]!;return sum+(r.x2-r.x1)*(r.z2-r.z1);},0);
   result={from,to,end:view.endCell,cells,length:view.length,area};
  }
 }
 data.openings.set(key,result);return result;
}
/** Union physical area; overlapping views of one blind tail are never counted twice. */
export function visibleDeadEnds(maze:Maze):VisibleDeadEnds {
 const existing=cache.get(maze)?.summary;if(existing)return existing;
 if(!cache.has(maze))cache.set(maze,{openings:new Map()});
 const context=prepareNavigation(maze),domain=domainOf(maze),ends=new Map<number,VisibleDeadEnd>();
 for(const from of domain.cells)for(const to of maze.passages[from]!){const proof=visibleDeadEnd(maze,from,to,context),old=proof?ends.get(proof.end):null;if(proof&&(!old||proof.area>old.area))ends.set(proof.end,proof);}
 const branches=[...ends.values()].sort((a,b)=>a.from-b.from||a.end-b.end),cells=new Set(branches.flatMap(b=>b.cells));
 const area=[...cells].reduce((s,c)=>{const r=domain.rectangles[c]!;return s+(r.x2-r.x1)*(r.z2-r.z1);},0),summary={branches,cells,area,ratio:area/domain.area};
 cache.get(maze)!.summary=summary;return summary;
}

/** A pocket is obvious at a decision only when its entire blind tail is visible
 * from an actual fork. A final view after a concealed bend is normal discovery. */
export function obviousForkDeadEnds(maze:Maze):VisibleDeadEnds {
 const all=visibleDeadEnds(maze),domain=domainOf(maze);
 const branches=all.branches.filter(b=>maze.passages[b.from]!.length>=3),cells=new Set(branches.flatMap(b=>b.cells));
 const area=[...cells].reduce((sum,c)=>{const r=domain.rectangles[c]!;return sum+(r.x2-r.x1)*(r.z2-r.z1);},0);
 return {branches,cells,area,ratio:area/domain.area};
}
/** Quality-only cold area: exclude terminal space demonstrably recognized from a
 * frequently reached viewpoint. Raw visitation/heat remains completely untouched.
 * A tail whose viewpoint is also cold remains unexplored and counts in full. */
export function recognitionAdjustedColdspots(maze:Maze,probability:Float64Array,threshold:number):{recognizedTerminalArea:number;coldArea:number;coldAreaRatio:number;largestColdArea:number} {
 const domain=domainOf(maze),context=prepareNavigation(maze),recognized=new Set<number>();
 for(const from of domain.cells)if(probability[from]!>=threshold)for(const to of maze.passages[from]!){
  const proof=visibleDeadEnd(maze,from,to,context);if(proof)for(const c of proof.cells)recognized.add(c);
 }
 const seen=new Set<number>();let coldArea=0,largestColdArea=0,recognizedTerminalArea=0;
 for(const c of recognized)if(probability[c]!<threshold){const r=domain.rectangles[c]!;recognizedTerminalArea+=(r.x2-r.x1)*(r.z2-r.z1);}
 for(const start of domain.cells){
  if(seen.has(start)||recognized.has(start)||probability[start]!>=threshold)continue;
  const queue=[start];seen.add(start);let area=0;
  for(let i=0;i<queue.length;i++){const c=queue[i]!,r=domain.rectangles[c]!;area+=(r.x2-r.x1)*(r.z2-r.z1);
   for(const n of maze.passages[c]!)if(!seen.has(n)&&!recognized.has(n)&&probability[n]!<threshold){seen.add(n);queue.push(n);}}
  coldArea+=area;largestColdArea=Math.max(largestColdArea,area);
 }
 return {recognizedTerminalArea,coldArea,coldAreaRatio:coldArea/domain.area,largestColdArea};
}
