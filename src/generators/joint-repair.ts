import {cellCenter,cellSize,routingSize,type Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {shortestPath} from '../core/pathfinding';
import {random} from '../core/random';
import {guardedMaze,edgeKey} from './guarded';
import {routeTraps} from '../analysis/route-traps';
import {corridorQuality} from '../analysis/corridor-quality';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../analysis/coldspots';

/** Edges belonging to a long axial perspective, even when it contains junctions. */
function longEdges(maze:Maze,limit:number):[number,number][]{
  const width=routingSize(maze).columns,keys=new Set<string>(),edges:[number,number][]=[];
  for(const c of domainOf(maze).cells)for(const delta of [1,width]){
    const before=c-delta;
    if(maze.passages[c]!.includes(before))continue;
    const chain=[c];let at=c;
    while(maze.passages[at]!.includes(at+delta)){at+=delta;chain.push(at);}
    const a=cellCenter(maze,c),b=cellCenter(maze,at),s=cellSize(maze,at);
    if(Math.hypot(b.x-a.x,b.z-a.z)+(delta===1?s.width:s.depth)/2<=limit)continue;
    for(let i=1;i<chain.length;i++){const x=chain[i-1]!,y=chain[i]!,key=edgeKey(x,y);if(!keys.has(key)){keys.add(key);edges.push([x,y]);}}
  }
  return edges;
}

/** Cut a long passage and reconnect the two tree components through a different wall.
 * Trap count and portal pockets are retained. Once geometry fits, improve the worst-policy cold areas.
 */
export function jointRepair(base:Maze,seed:string,steps=320,onProgress?:(state:{attempted:number;geometry:number;coldPenalty:number})=>void):Maze[]{
  const limits=base.parameters.design;if(!limits)return [];
  const guard=guardedMaze(base,seed,true).constraints,rng=random(seed+'|joint-repair'),domain=domainOf(base);
  const requested=base.parameters.routeTrapCount??0,area=domain.area;
  const routeArea=(m:Maze)=>shortestPath(m).reduce((sum,n)=>{const s=cellSize(m,n);return sum+s.width*s.depth;},0)/area;
  const initialArea=routeArea(base),retainArea=initialArea>=.35&&initialArea<=.55;
  const geometry=(m:Maze)=>{const c=corridorQuality(m,limits.maxForcedStraight),route=shortestPath(m),ratio=route.reduce((sum,n)=>{const s=cellSize(m,n);return sum+s.width*s.depth;},0)/area;return Math.max(0,c.longestForcedStraight/limits.maxForcedStraight-1)+Math.max(0,c.longestForcedRun/limits.maxForcedRun-1)+2*Math.max(0,c.longestVisibleStraight/limits.maxVisibleStraight-1)+10*Math.max(0,.35-ratio,ratio-.55);};
  const assess=(m:Maze)=>analyzePotential(m,{...DEFAULT_ANALYSIS,samples:32,routeMemory:1},undefined,false);
  const cold=(p:ReturnType<typeof assess>)=>Math.max(0,p.worstColdRatio/Math.max(.001,limits.maxColdRatio)-1)+Math.max(0,p.worstColdRegion/Math.max(.1,limits.maxColdRegion)-1)-.05*p.minOptionalCoverage;
  let current=base,g=geometry(base),p=g<1e-8?assess(base):null,c=p?cold(p):0;
  const archive:{maze:Maze;score:number}[]=[];
  const remember=(maze:Maze,value:ReturnType<typeof assess>)=>{if(value.eligible){archive.push({maze,score:value.score!});archive.sort((a,b)=>b.score-a.score);if(archive.length>5)archive.pop();}};
  if(p)remember(base,p);
  for(let i=0;i<steps;i++){
    if(i%100===0)onProgress?.({attempted:i,geometry:g,coldPenalty:c});
    const bad=longEdges(current,limits.maxVisibleStraight),open:typeof bad=[];
    for(const a of domain.cells)for(const b of current.passages[a]!)if(b>a&&!guard.locked.has(edgeKey(a,b)))open.push([a,b]);
    const cuts=(bad.length?bad:open).filter(([a,b])=>!guard.locked.has(edgeKey(a,b)));
    if(!cuts.length)break;
    const [a,b]=cuts[Math.floor(rng()*cuts.length)]!,component=new Set([a]),queue=[a];
    for(let j=0;j<queue.length;j++)for(const n of current.passages[queue[j]!]!)if(edgeKey(queue[j]!,n)!==edgeKey(a,b)&&!component.has(n)){component.add(n);queue.push(n);}
    const links=guard.allowed.filter(([x,y])=>edgeKey(x,y)!==edgeKey(a,b)&&component.has(x)!==component.has(y));
    if(!links.length)continue;
    const [x,y]=links[Math.floor(rng()*links.length)]!,passages=[...current.passages];
    for(const n of new Set([a,b,x,y]))passages[n]=[...passages[n]!];
    passages[a]=passages[a]!.filter(n=>n!==b);passages[b]=passages[b]!.filter(n=>n!==a);
    passages[x]!.push(y);passages[y]!.push(x);for(const n of new Set([a,b,x,y]))passages[n]!.sort((a,b)=>a-b);
    const candidate={...current,passages},route=shortestPath(candidate),ratio=route.reduce((sum,n)=>{const s=cellSize(candidate,n);return sum+s.width*s.depth;},0)/area;
    if(ratio<(retainArea ? .35 : .2)||ratio>(retainArea ? .55 : .75)||routeTraps(candidate).qualifiedCount<requested)continue;
    const nextG=geometry(candidate);
    if(g<1e-8&&nextG>1e-8)continue;
    const nextP=nextG<1e-8?assess(candidate):null,nextC=nextP?cold(nextP):0;
    if(nextP)remember(candidate,nextP);
    const delta=10*(nextG-g)+(nextG<1e-8?nextC-c:0),temperature=.15*(1-i/steps)+.01;
    if(delta<=0||rng()<Math.exp(-delta/temperature)){current=candidate;g=nextG;p=nextP;c=nextC;}
    if(archive.length>=5&&i>80)break;
  }
  return archive.map(row=>row.maze);
}
