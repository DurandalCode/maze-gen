import {spatialEdgeLength} from '../core/two-storey';
import {freeAreaWeights} from '../free/analysis-geometry';
import {optionalDistricts,districtAttachment,type DistrictAttachment} from '../core/optional-districts';
import {corridorNavigation} from '../core/corridor-navigation';
import {domainOf} from '../core/domain';
import {cellCenter,portalPoint,type Maze} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
export interface SideDistrict extends DistrictAttachment {
 cells:number[];gates:number[];entryCount:number;area:number;coldArea:number;coldRatio:number;meanProbability:number;
 singleEntry:boolean;sideward:boolean;entryAlignment:number;progressAreaRatio:number;large:boolean;problematic:boolean;
}
export interface SideDistricts {districts:SideDistrict[];assessed:boolean;area:number;largeAreaThreshold:number;singleEntryArea:number;largestSingleEntryArea:number;problemArea:number;problemColdArea:number;largestProblemArea:number;problemCount:number}
/** Design assessment only. The reference route and hidden district geometry are
 * never passed to the simulated player's choice policy. */
export function sideDistricts(input:Maze,probability?:ArrayLike<number>,threshold=.2):SideDistricts{
 const maze=input.version===4&&!input.navigation?corridorNavigation(input):input,d=domainOf(maze),g=maze.navigation,source=g?.source??maze,sourceDomain=domainOf(source),area=d.area,largeAreaThreshold=Math.max(36,area*.08),goal=portalPoint(maze,maze.exit);
 const weights=new Float64Array(maze.passages.length),cold=new Float64Array(weights.length),visits=new Float64Array(weights.length);
 // Source heat has fine-cell indices; semantic assessment already has room indices.
 if(input===maze){const freeWeights=(maze.version===5||maze.version===7)?freeAreaWeights(maze):null;for(const c of d.cells){const r=d.rectangles[c]!,a=freeWeights?.[c]??((r.x2-r.x1)*(r.z2-r.z1)),p=probability?.[c]??0;weights[c]=a;visits[c]=a*p;if(probability&&p<threshold)cold[c]=a;}}
 else for(const c of sourceDomain.cells){const room=g!.originalToRegion[c]!,r=sourceDomain.rectangles[c]!,a=(r.x2-r.x1)*(r.z2-r.z1),p=probability?.[c]??0;weights[room]!+=a;visits[room]!+=a*p;if(probability&&p<threshold)cold[room]!+=a;}
 const route=shortestPath(maze),routeDistances=new Map<number,number>();let length=0;
 for(let i=0;i<route.length;i++){if(i){const a=cellCenter(maze,route[i-1]!),b=cellCenter(maze,route[i]!);length+=maze.storeys?spatialEdgeLength(maze,route[i-1]!,route[i]!):Math.hypot(a.x-b.x,a.z-b.z);}routeDistances.set(route[i]!,length);}
 const districts=optionalDistricts(maze.passages,d.cells,route).map(region=>{
  const a=region.cells.reduce((s,c)=>s+weights[c]!,0),coldArea=region.cells.reduce((s,c)=>s+cold[c]!,0),meanProbability=a?region.cells.reduce((s,c)=>s+visits[c]!,0)/a:0;
  const entryAlignment=Math.max(...region.entries.map(e=>{const p=cellCenter(maze,e.gate),q=cellCenter(maze,e.cell),x=q.x-p.x,z=q.z-p.z,dx=goal.x-p.x,dz=goal.z-p.z,n=Math.hypot(x,z)*Math.hypot(dx,dz);return n?(x*dx+z*dz)/n:1;}));
  const rects=region.cells.map(c=>d.rectangles[c]!),attachment=districtAttachment({x1:Math.min(...rects.map(r=>r.x1)),x2:Math.max(...rects.map(r=>r.x2)),z1:Math.min(...rects.map(r=>r.z1)),z2:Math.max(...rects.map(r=>r.z2))},region.gates.map(c=>({...cellCenter(maze,c),routeDistance:routeDistances.get(c)!}))),gateDistance=Math.min(...region.gates.map(c=>{const p=cellCenter(maze,c);return Math.hypot(p.x-goal.x,p.z-goal.z);}));
  const progressAreaRatio=a?region.cells.reduce((sum,c)=>{const p=cellCenter(maze,c);return sum+(Math.hypot(p.x-goal.x,p.z-goal.z)<gateDistance-2?weights[c]!:0);},0)/a:0;
  const singleEntry=region.gates.length===1,sideward=entryAlignment<=.25||progressAreaRatio<.25,large=a>=largeAreaThreshold,coldRatio=a?coldArea/a:0;
  return {...attachment,cells:region.cells,gates:region.gates,entryCount:region.entries.length,area:a,coldArea,coldRatio,meanProbability,singleEntry,sideward,entryAlignment,progressAreaRatio,large,problematic:!!probability&&attachment.localized&&large&&coldRatio>=.6};
 });
 const problems=districts.filter(d=>d.problematic),single=districts.filter(d=>d.singleEntry),result:SideDistricts={districts,assessed:!!probability,area,largeAreaThreshold,singleEntryArea:single.reduce((s,d)=>s+d.area,0),largestSingleEntryArea:Math.max(0,...single.map(d=>d.area)),problemArea:problems.reduce((s,d)=>s+d.area,0),problemColdArea:problems.reduce((s,d)=>s+d.coldArea,0),largestProblemArea:Math.max(0,...problems.map(d=>d.area)),problemCount:problems.length};
 if(input!==maze){const members=new Map<number,number[]>();for(const c of sourceDomain.cells){const room=g!.originalToRegion[c]!;if(!members.has(room))members.set(room,[]);members.get(room)!.push(c);}return {...result,districts:districts.map(r=>({...r,cells:r.cells.flatMap(c=>members.get(c)??[]),gates:r.gates.map(c=>g!.representatives[c]!)}))};}
 return result;
}
