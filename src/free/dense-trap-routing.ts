import type {Maze} from '../core/maze';
import {branchLongRoute} from './route-branches';
import type {Anchor,FreeDraft} from './model';
import {mazeDraft} from './json';
import {anchorGeometry,connectionGeometry,freeMaze,freeRuntime,modulePolygon,validateFree} from './layout';
import {distance,edges,ends} from './geometry';
import {routeTraps} from '../analysis/route-traps';
import {prepareNavigation,prepareOutline} from '../analysis/navigation';
import {freeGroundLengths} from './path-limits';
import {physicallyOpen} from './cavity-maze';
import {auditModuleWalls} from './module-origin';
interface Edge {a:number;b:number;weight:number;id:string}
const key=(a:number,b:number)=>a<b?a+':'+b:b+':'+a;
function path(edges:Edge[],n:number,from:number,to:number){const distances=new Float64Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),done=new Set<number>();distances[from]=0;for(let step=0;step<n;step++){let at=-1;for(let i=0;i<n;i++)if(!done.has(i)&&(at<0||distances[i]!<distances[at]!))at=i;if(at<0||!Number.isFinite(distances[at]!))break;done.add(at);if(at===to)break;for(const e of edges){const next=e.a===at?e.b:e.b===at?e.a:-1;if(next>=0&&distances[at]!+e.weight<distances[next]!){distances[next]=distances[at]!+e.weight;parent[next]=at;}}}if(!Number.isFinite(distances[to]!))return [];const result=[to];while(result[0]!==from)result.unshift(parent[result[0]!]!);return result;}
function connected(edges:Edge[],n:number){const seen=new Set([0]),queue=[0];for(const at of queue)for(const e of edges){const next=e.a===at?e.b:e.b===at?e.a:-1;if(next>=0&&!seen.has(next)){seen.add(next);queue.push(next);}}return seen.size===n;}
/** Unit-capacity cut with pinned route spines. The waypoint is left out of
 * the flow graph, so every surviving crossing must pass through that room. */
function waypointCut(edges:Edge[],n:number,waypoint:number,sources:number[],targets:number[]){
 const size=n+2,ss=n,tt=n+1,capacity=Array.from({length:size},()=>new Float64Array(size));
 for(const e of edges)if(e.a!==waypoint&&e.b!==waypoint){capacity[e.a]![e.b]=capacity[e.a]![e.b]!+1;capacity[e.b]![e.a]=capacity[e.b]![e.a]!+1;}
 for(const a of sources)if(a!==waypoint)capacity[ss]![a]=10000;
 for(const a of targets)if(a!==waypoint)capacity[a]![tt]=10000;
 const residual=capacity.map(v=>v.slice());
 for(let step=0;step<edges.length;step++){const parent=new Int32Array(size).fill(-1),q=[ss];parent[ss]=ss;for(const at of q){for(let j=0;j<size;j++)if(parent[j]===-1&&residual[at]![j]!>0){parent[j]=at;q.push(j);}if(parent[tt]!==-1)break;}if(parent[tt]===-1)break;let flow=Infinity;for(let at=tt;at!==ss;at=parent[at]!)flow=Math.min(flow,residual[parent[at]!]![at]!);if(flow>=10000)return null;for(let at=tt;at!==ss;at=parent[at]!){residual[parent[at]!]![at]=residual[parent[at]!]![at]!-flow;residual[at]![parent[at]!]=residual[at]![parent[at]!]!+flow;}}
 const reachable=new Set([ss]),q=[ss];for(const at of q)for(let j=0;j<size;j++)if(!reachable.has(j)&&residual[at]![j]!>0){reachable.add(j);q.push(j);}
 return edges.filter(e=>e.a===waypoint||e.b===waypoint||reachable.has(e.a)===reachable.has(e.b));
}
/** A small deterministic construction pass. A real cross-sector span is added
 * first. Existing supported doors then select a long blind continuation while
 * the correct sector route retreats from the exit landmark. No room/floor is
 * removed, and the ordinary trap qualification remains the final authority. */
export function routeDenseTraps(source:Maze,requested:number,onProgress?:(s:string)=>void):Maze{
 const original=mazeDraft(source),runtime=freeRuntime(source),context=prepareNavigation(source);prepareOutline(source,context);const outline=context.outlineDistances!,n=runtime.rooms.length,index=new Map(runtime.rooms.map((r,i)=>[r.id,i])),width=Math.min(1.2,source.parameters.corridorWidth);
 const baseEdges:Edge[]=original.layout.connections.map(c=>{const a=index.get(c.a.room)!,b=index.get(c.b.room)!,points=runtime.edgePaths.get(a+':'+b)!;return {a,b,id:c.id,weight:points.slice(1).reduce((s,p,i)=>s+distance(p,points[i]!),0)};});
 const used=[...original.layout.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...original.layout.openings],slots:Anchor[]=[];
 for(const m of original.layout.modules.filter(m=>!m.frameOnly&&m.type!=='custom'))for(const [edge,w]of edges(modulePolygon(m)).entries()){const length=distance(...ends(w)),offsets=length>3?[-(length-width)/2+.15,0,(length-width)/2-.15]:[0];for(const offset of offsets)if(!used.some(o=>o.room===m.id&&o.edge===edge&&Math.abs(o.offset-offset)<(o.width+width)/2+.12))slots.push({room:m.id,edge,offset});}
 const candidates:{a:Anchor;b:Anchor;length:number;separation:number}[]=[];
 for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){const a=slots[i]!,b=slots[j]!;if(a.room===b.room)continue;const ga=anchorGeometry(original.layout,a,width),gb=anchorGeometry(original.layout,b,width),length=distance(ga.mid,gb.mid);if(length<.15||length>3.2)continue;const dx=(gb.mid.x-ga.mid.x)/length,dz=(gb.mid.z-ga.mid.z)/length;if(ga.normal.x*dx+ga.normal.z*dz<=0||-gb.normal.x*dx-gb.normal.z*dz<=0)continue;const g=connectionGeometry(original.layout,{id:'probe',a,b,width});if(g.sides.some(w=>distance(...ends(w))>3+1e-7))continue;const between=path(baseEdges,n,index.get(a.room)!,index.get(b.room)!);if(between.length<8)continue;candidates.push({a,b,length,separation:between.length});}
 candidates.sort((a,b)=>b.separation-a.separation||a.length-b.length);
 let fullChecks=0,geometryChecks=0,repairs=0,best=source,bestCount=routeTraps(source).qualifiedCount;const failures=new Set<string>();
 for(const candidate of [undefined,...candidates.slice(0,16)]){
  const draft=structuredClone(original),link=candidate?{id:'dense-trap-sector-span',a:candidate.a,b:candidate.b,width}:undefined;if(link){draft.layout.connections.push(link);draft.layout.moduleConstruction!.spans.push(structuredClone(link));}geometryChecks++;
  if(validateFree(draft,false).length)continue;
  const added:Edge|undefined=link?{id:link.id,a:index.get(link.a.room)!,b:index.get(link.b.room)!,weight:candidate!.length+2}:undefined,all=added?[...baseEdges,added]:baseEdges;
  const forks=Array.from({length:n},(_,i)=>i).filter(i=>all.filter(e=>e.a===i||e.b===i).length>=3);
  let branchVisits=0;const branches:{fork:number;nodes:number[];length:number;approach:number}[]=[];
  for(const fork of forks){
   if(outline[fork]!<10)continue;
   const visit=(nodes:number[],length:number)=>{if(branchVisits++>=2048)return;const last=nodes.at(-1)!,approach=outline[fork]!-outline[last]!;if(length>=10&&approach>=6){branches.push({fork,nodes,length,approach});return;}if(nodes.length>=12||length>24)return;for(const e of all){const next=e.a===last?e.b:e.b===last?e.a:-1;if(next<0||nodes.includes(next)||next===source.exit.cell||next===source.entrance.cell||outline[next]!>outline[last]!+.2)continue;visit([...nodes,next],length+e.weight);}};
   visit([fork],0);
  }
  branches.sort((a,b)=>b.approach-a.approach||b.length-a.length);
  for(const branch of branches.slice(0,96)){
   const inside=new Set(branch.nodes.slice(1)),keep=new Set(branch.nodes.slice(1).map((v,i)=>key(v,branch.nodes[i]!)));
   let remaining=all.filter(e=>!inside.has(e.a)&&!inside.has(e.b)||inside.has(e.a)&&inside.has(e.b)||keep.has(key(e.a,e.b)));
   // A side pocket whose only contacts were with the chosen false branch
   // remains accessible through one of those contacts. Never discard its rooms.
   let invalid=false;
   for(let absorb=0;absorb<8&&!connected(remaining,n);absorb++){
    const seen=new Set([branch.fork]),queue=[branch.fork];for(const at of queue)for(const e of remaining){const next=e.a===at?e.b:e.b===at?e.a:-1;if(next>=0&&!seen.has(next)){seen.add(next);queue.push(next);}}
    if(!seen.has(source.entrance.cell)||!seen.has(source.exit.cell)){invalid=true;break;}
    const missing=Array.from({length:n},(_,i)=>i).find(i=>!seen.has(i))!,component=new Set([missing]),q=[missing];for(const at of q)for(const e of remaining){const next=e.a===at?e.b:e.b===at?e.a:-1;if(next>=0&&!component.has(next)){component.add(next);q.push(next);}}
    const restored=all.find(e=>component.has(e.a)&&inside.has(e.b)||component.has(e.b)&&inside.has(e.a));if(!restored){invalid=true;break;}remaining.push(restored);for(const node of component)inside.add(node);
   }
   if(invalid||!connected(remaining,n))continue;
   const prefixes:number[][]=[];let uphillVisits=0;
   const uphill=(nodes:number[])=>{if(uphillVisits++>=256)return;const last=nodes.at(-1)!;if(outline[last]!-outline[branch.fork]!>=8){prefixes.push(nodes);return;}if(nodes.length>=12||prefixes.length>=4)return;for(const e of remaining){const next=e.a===last?e.b:e.b===last?e.a:-1;if(next<0||inside.has(next)||nodes.includes(next)||outline[next]!<outline[last]!-1e-7)continue;uphill([...nodes,next]);}};
   uphill([branch.fork]);let selected:Edge[]|undefined;
   for(const prefix of prefixes){const peak=prefix.at(-1)!,prefixSet=new Set(prefix.slice(0,-1)),tail=path(remaining.filter(e=>!prefixSet.has(e.a)&&!prefixSet.has(e.b)),n,peak,source.exit.cell);if(!tail.length)continue;const correct=[...prefix,...tail.slice(1)],avoid=new Set([...inside,...correct.slice(1)]),entry=path(remaining.filter(e=>!avoid.has(e.a)&&!avoid.has(e.b)),n,source.entrance.cell,branch.fork);if(!entry.length)continue;
    let chosen=waypointCut(remaining,n,branch.fork,entry.slice(0,-1),correct.slice(1));if(!chosen)continue;
    chosen=waypointCut(chosen,n,peak,[...entry,...prefix.slice(0,-1),...inside],tail.slice(1));if(!chosen||!connected(chosen,n))continue;selected=chosen;break;
   }
   if(!selected)continue;remaining=selected;
   const removed=new Set(all.filter(e=>!remaining.includes(e)).map(e=>e.id));if(removed.size>16)continue;
   if(fullChecks++>=12)break;
   const trial:FreeDraft=structuredClone(draft);trial.layout.connections=trial.layout.connections.filter(c=>!removed.has(c.id));
   if(physicallyOpen(trial)){failures.add('Физическая дверь или стойка.');continue;}
   let maze=freeMaze(trial,false),analysis=routeTraps(maze);if(analysis.qualifiedCount<=bestCount){failures.add('Полная квалификация Л не подтверждена.');continue;}
   let lengths=freeGroundLengths(maze);
   if(lengths.straight>8+1e-7||lengths.run>16+1e-7){
    if(repairs++>=2){failures.add('Исчерпан бюджет двух конструктивных исправлений длинного обхода.');continue;}
    try{maze=branchLongRoute(maze,source.parameters.seed+'-route-arms-v1',onProgress);analysis=routeTraps(maze);lengths=freeGroundLengths(maze);}catch(error){failures.add(String((error as Error).message));continue;}
    if(analysis.qualifiedCount<=bestCount||lengths.straight>8+1e-7||lengths.run>16+1e-7)continue;
   }
   if(auditModuleWalls(maze.free!).issues.length)continue;
   best=maze;bestCount=analysis.qualifiedCount;onProgress?.(`Плотная маршрутизация: Л${bestCount}, выбранных закрытых дверей${removed.size}, новая межсекторная связь.`);
   if(bestCount>=requested)return best;
  }
  if(fullChecks>=12)break;
 }
 if(bestCount>=requested)return best;
 throw Error(`Плотная маршрутизация: подтверждено Л${bestCount}/${requested}; новых пролётов проверено${geometryChecks}, полных вариантов${Math.min(fullChecks,12)}. ${[...failures].join(' ')}`);
}
