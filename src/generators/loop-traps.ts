import {neighbors,routingSize,validateParameters,type Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {metrics} from '../core/metrics';
import {shortestPath} from '../core/pathfinding';
import {random,shuffle} from '../core/random';
import {guardedMaze,edgeKey,type GuardConstraints} from './guarded';
import {generateBase} from './generate';
import {loopTraps} from '../analysis/loop-traps';
import {routeTraps} from '../analysis/route-traps';
import {corridorQuality} from '../analysis/corridor-quality';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../analysis/coldspots';
import {addConstrainedConnections} from './constrained-connections';

/** Close two off-route branches around a single route junction, never a shortcut past it. */
export function loopTrapCandidates(tree:Maze,guard:GuardConstraints,limit=8):Maze[]{
 const route=new Set(shortestPath(tree)),archive:{maze:Maze;score:number}[]=[];
 for(const [a,b] of guard.allowed){
  if(tree.passages[a]!.includes(b))continue;
  const path=shortestPath(tree,a,b);
  if(path.length<20||path.filter(c=>route.has(c)).length!==1)continue;
  const passages=[...tree.passages];passages[a]=[...passages[a]!,b].sort((x,y)=>x-y);passages[b]=[...passages[b]!,a].sort((x,y)=>x-y);
  const maze={...tree,parameters:{...tree.parameters,extraConnections:metrics(tree).cycles+1},passages},loops=loopTraps(maze);
  if(!loops.qualifiedCount)continue;
  archive.push({maze,score:loops.candidates[0]!.score});archive.sort((a,b)=>b.score-a.score);if(archive.length>limit)archive.pop();
 }
 return archive.map(r=>r.maze);
}
/** Cyclic wall exchanges can fix long passages/cold spots while retaining a genuine return loop. */
function repair(base:Maze,guard:GuardConstraints,seed:string,steps:number,progress?:(message:string)=>void):Maze|null {
 const limits=base.parameters.design,rng=random(seed+'|loop-repair'),requested=base.parameters.loopTrapCount??0,requestedDead=base.parameters.routeTrapCount??0;
 const protectedCells=new Set(guard.pockets.flat()),pairs=guard.allowed.filter(([a,b])=>!protectedCells.has(a)&&!protectedCells.has(b));
 const geometry=(m:Maze)=>{const c=corridorQuality(m,limits?.maxForcedStraight??12);return Math.max(0,c.longestForcedStraight/(limits?.maxForcedStraight??12)-1)+Math.max(0,c.longestForcedRun/(limits?.maxForcedRun??20)-1)+2*Math.max(0,c.longestVisibleStraight/(limits?.maxVisibleStraight??Infinity)-1);};
 const assess=(m:Maze,samples:number)=>analyzePotential(m,{...DEFAULT_ANALYSIS,samples,routeMemory:1},undefined,false);
 const cold=(p:ReturnType<typeof assess>)=>limits?Math.max(0,p.worstColdRatio/Math.max(.001,limits.maxColdRatio)-1)+Math.max(0,p.worstColdRegion/Math.max(.1,limits.maxColdRegion)-1):0;
 let current=base,g=geometry(current),p=g<1e-8?assess(current,32):null,c=p?cold(p):0;
 if(p?.eligible&&assess(current,128).eligible&&assess(current,2048).eligible)return current;
 for(let i=0;i<steps;i++){
  if(i%100===0)progress?.(`Кольцевая ловушка: проверка проходов и тепла · ${i}/${steps}`);
  const closed=pairs.filter(([a,b])=>!current.passages[a]!.includes(b));if(!closed.length)break;
  const [a,b]=closed[Math.floor(rng()*closed.length)]!,path=shortestPath(current,a,b),cuts=path.slice(1).map((d,j)=>[path[j]!,d] as [number,number]).filter(([x,y])=>!protectedCells.has(x)&&!protectedCells.has(y));
  if(!cuts.length)continue;
  const [x,y]=cuts[Math.floor(rng()*cuts.length)]!,passages=[...current.passages];
  for(const n of new Set([a,b,x,y]))passages[n]=[...passages[n]!];
  passages[a]!.push(b);passages[b]!.push(a);passages[x]=passages[x]!.filter(n=>n!==y);passages[y]=passages[y]!.filter(n=>n!==x);
  for(const n of new Set([a,b,x,y]))passages[n]!.sort((a,b)=>a-b);
  const maze={...current,passages},nextG=geometry(maze);
  if(g<1e-8&&nextG>1e-8)continue;
  const temperature=.12*(1-i/steps)+.01;
  if(nextG>g&&rng()>Math.exp(-10*(nextG-g)/temperature))continue;
  if(loopTraps(maze).qualifiedCount<requested||routeTraps(maze).qualifiedCount<requestedDead)continue;
  const nextP=nextG<1e-8?assess(maze,32):null,nextC=nextP?cold(nextP):0,delta=10*(nextG-g)+(nextG<1e-8?nextC-c:0);
  if(nextP?.eligible&&assess(maze,128).eligible&&assess(maze,2048).eligible)return maze;
  if(delta<=0||rng()<Math.exp(-delta/temperature)){current=maze;g=nextG;p=nextP;c=nextC;}
 }
 return null;
}
/** Ordinary generation; no previous topology is inherited. Search may fail without changing the current maze. */
export function generateLoopTraps(base:Maze,onProgress?:(message:string)=>void):Maze {
 validateParameters(base.parameters);
 const requested=base.parameters.loopTrapCount??0;
 if(!requested)return base;
 if(domainOf(base).cells.length>1200)throw new Error('Подбор кольцевых ловушек пока доступен до 1200 активных клеток графа.');
 for(let attempt=0;attempt<32;attempt++){
  onProgress?.(`Подбор кольцевых ловушек · попытка ${attempt+1}/32`);
  const seed=base.parameters.seed.slice(0,140)+`|return-loop-${attempt}`;
  const treeSource={...base,parameters:{...base.parameters,extraConnections:0,loopTrapCount:0,routeTrapCount:0}};
  treeSource.passages=generateBase(treeSource.parameters).passages;
  const {maze:tree,constraints:guard}=guardedMaze(treeSource,seed);
  const constructed=requested===1?constructedLoopCandidates(tree,guard,seed).filter(m=>loopTraps(m).qualifiedCount).slice(0,4):[];
  let beam=[tree];
  for(let count=1;count<=requested;count++){
   const candidates=beam.flatMap(m=>loopTrapCandidates(m,guard,6)).filter(m=>loopTraps(m).qualifiedCount>=count);
   beam=candidates.sort((a,b)=>loopTraps(b).candidates[0]!.score-loopTraps(a).candidates[0]!.score).slice(0,4);
   if(!beam.length)break;
  }
  for(const candidate of [...constructed,...beam]){
   if(metrics(candidate).cycles!==requested)continue;
   const m={...candidate,parameters:{...base.parameters,extraConnections:requested}},repaired=repair(m,guard,seed,1200,onProgress);
   if(!repaired)continue;
   const result=base.parameters.extraConnections>requested?addConstrainedConnections(repaired,base.parameters.extraConnections,base.parameters.seed,onProgress):repaired;
   if(analyzePotential(result,{...DEFAULT_ANALYSIS,samples:2048,routeMemory:1},undefined,false).eligible)return result;
  }
 }
 throw new Error('Не найдены большие кольцевые ловушки с заданными ограничениями. Измените seed, число ловушек или размер области; текущая карта сохранена.');
}

/** Seed an isolated rectangular circuit, attach it at a route junction, then complete
 * the remaining cells using the selected seeded tree algorithm. No saved maze is reused.
 */
export function constructedLoopCandidates(base:Maze,guard:GuardConstraints,seed:string):Maze[]{
 const {columns,rows}=routingSize(base),domain=domainOf(base),rng=random(seed+'|loop-layout'),layouts:{ring:number[];zone:Set<number>;fork:number;outside:number[]}[]=[];
 const protectedCells=new Set(guard.pockets.flat()),allowed=new Set(guard.allowed.map(([a,b])=>edgeKey(a,b)));
 // 5 routing edges per side: 40 metres for the default 2m graph spacing.
 // Other spacings are judged by the shared geometric analysis rather than assumed valid.
 for(let z=1;z+5<rows-1;z++)for(let x=1;x+5<columns-1;x++){
  const c=(dx:number,dz:number)=>(z+dz)*columns+x+dx,ring:number[]=[];
  for(let dx=0;dx<5;dx++)ring.push(c(dx,0));
  for(let dz=0;dz<5;dz++)ring.push(c(5,dz));
  for(let dx=5;dx>0;dx--)ring.push(c(dx,5));
  for(let dz=5;dz>0;dz--)ring.push(c(0,dz));
  const zone=new Set<number>();for(let dz=0;dz<=5;dz++)for(let dx=0;dx<=5;dx++)zone.add(c(dx,dz));
  if([...zone].some(n=>!domain.active[n]||protectedCells.has(n)))continue;
  for(const fork of [c(0,0),c(5,0),c(5,5),c(0,5)]){
   const outside=neighbors(base,fork).filter(n=>!zone.has(n)&&allowed.has(edgeKey(fork,n)));
   if(outside.length===2)layouts.push({ring,zone,fork,outside});
  }
 }
 shuffle(layouts,rng);
 const result:Maze[]=[];
 for(const layout of layouts.slice(0,48)){
  const {ring,zone,fork,outside}=layout;
  const passages=base.passages.map(()=>[] as number[]),parent=passages.map((_,i)=>i);
  const root=(x:number):number=>{while(parent[x]!==x){parent[x]=parent[parent[x]!]!;x=parent[x]!;}return x;};
  const add=(a:number,b:number,force=false)=>{if(passages[a]!.includes(b))return;if(!force&&root(a)===root(b))return;parent[root(a)]=root(b);passages[a]!.push(b);passages[b]!.push(a);};
  for(let i=0;i<ring.length;i++)add(ring[i]!,ring[(i+1)%ring.length]!,true);
  for(const n of outside)add(fork,n);
  for(const [a,b] of guard.mandatory)add(a,b);
  const links=guard.allowed.filter(([a,b])=>zone.has(a)===zone.has(b)||a===fork||b===fork);
  const generated=generateBase({...base.parameters,extraConnections:0,loopTrapCount:0,routeTrapCount:0,seed});
  for(const [a,b] of links)if(generated.passages[a]!.includes(b))add(a,b);
  shuffle(links,rng);for(const [a,b] of links)add(a,b);
  for(const n of passages)n.sort((a,b)=>a-b);
  const maze={...base,parameters:{...base.parameters,extraConnections:1},passages};
  if(metrics(maze).components!==1||metrics(maze).cycles!==1)continue;
  result.push(maze);
 }
 return result;
}
