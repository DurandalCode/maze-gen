import {sideDistricts} from '../analysis/side-districts';
import {corridorSight} from '../analysis/corridor-sight';
import {planCorridorNetwork} from './corridor-network';
import {corridorBoundaryPortals,corridorPortalWall} from '../core/corridor-portals';
import {validateFabricSupports} from '../core/corridor-supports';
import {independentCycles} from '../core/graph';
import {shortestPath} from '../core/pathfinding';
import {corridorNavigation,validateCorridorSpaces,openingMidpoint,roomAnchor} from '../core/corridor-navigation';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS,analyzeColdspots} from '../analysis/coldspots';
import {DEFAULT_CONSTRUCTION,neighbors,routingSize,validateParameters,type Maze,type Parameters} from '../core/maze';
import {domainOf} from '../core/domain';
import {footprintContains,metres,mm,regionOwners,validatePlacement,type PlacedModule,type CorridorSpace} from '../core/corridor-geometry';
import {random,shuffle} from '../core/random';
import {transferPortals} from '../core/portals';
import {routeTraps} from '../analysis/route-traps';
import {loopTraps} from '../analysis/loop-traps';
import {corridorQuality} from '../analysis/corridor-quality';
import {effectiveLimits} from '../core/design-limits';
type RNG=()=>number;
/** Exact millimetre partition: module runs separated by 1..maximum metre gaps. */
function partition(total:number,maximum:number,long:boolean,rng:RNG,margins:{start?:'required';end?:'forbidden'}={}):{start:number;length:number}[]{
 const choices:{n:number;l:number;e:number;leading:boolean;score:number}[]=[];
 for(let n=1;n<=Math.floor((total+1000)/3000)+1;n++)for(let l=0;l<=(long?n:0);l++)for(let mask=0;mask<4;mask++){
  const leading=!!(mask&1),trailing=!!(mask&2),e=Number(leading)+Number(trailing);if(margins.start==='required'&&!leading||margins.end==='forbidden'&&trailing)continue;
  const free=total-n*2000-l*4000,gaps=n-1+e;if(gaps?free<gaps*1000||free>gaps*maximum:free!==0)continue;
  // Prefer the configured passage width over packing more modules into narrow gaps.
  const widthScore=gaps?free/gaps/maximum:1;
  choices.push({n,l,e,leading,score:widthScore*1000+(long&&l>0?100:0)+(long&&l>0&&l<n?50:0)+rng()*4});
 }
 choices.sort((a,b)=>b.score-a.score);const best=choices[0];if(!best)throw Error('Размер площадки не позволяет разместить модули с проходами от 1 м до заданного максимума.');
 const lengths=Array.from({length:best.n},(_,i)=>i<best.l?6000:2000);shuffle(lengths,rng);
 const count=best.n-1+best.e,gaps=Array(count).fill(1000) as number[];let rest=total-lengths.reduce((a,b)=>a+b,0)-count*1000;
 while(rest>0){const free=gaps.map((v,i)=>v<maximum?i:-1).filter(i=>i>=0);const i=free[Math.floor(rng()*free.length)]!;const d=Math.min(100,rest,maximum-gaps[i]!);gaps[i]!+=d;rest-=d;}
 let gi=0,at=best.leading?gaps[gi++]!:0;const result=[];for(let i=0;i<lengths.length;i++){result.push({start:at,length:lengths[i]!});at+=lengths[i]!;if(i<lengths.length-1)at+=gaps[gi++]!;}return result;
}
function placement(p:Parameters,rng:RNG):PlacedModule[]{
 const modules:PlacedModule[]=[],zCuts=[...new Set([0,mm(p.rows),...(p.shape?.rectangles.flatMap(r=>[mm(r.z),mm(r.z+r.height)])??[])])].sort((a,b)=>a-b),xCuts=[...new Set([0,mm(p.columns),...(p.shape?.rectangles.flatMap(r=>[mm(r.x),mm(r.x+r.width)])??[])])].sort((a,b)=>a-b);
 for(let band=0;band<zCuts.length-1;band++){
  const begin=zCuts[band]!,height=zCuts[band+1]!-begin;if(height<2000){if(height>mm(p.corridorWidth))throw Error('Узкая часть формы не поддерживает размещение.');continue;}
  const rows=partition(height,mm(p.corridorWidth),true,rng,{...(band?{start:'required' as const}:{}),...(band<zCuts.length-2?{end:'forbidden' as const}:{})});
  for(const row of rows){const spans:{start:number;length:number}[]=[];let start:number|null=null;const middle=begin+row.start+row.length/2;
   for(let i=0;i<xCuts.length-1;i++){const lo=xCuts[i]!,hi=xCuts[i+1]!,active=footprintContains(p,(lo+hi)/2,middle);if(active&&start===null)start=lo;if(start!==null&&(!active||i===xCuts.length-2)){const end=active&&i===xCuts.length-2?hi:lo;spans.push({start,length:end-start});start=null;}}
   for(const span of spans){if(span.length<2000)continue;const columns=partition(span.length,mm(p.corridorWidth),row.length===2000,rng);
    for(const col of columns){const r={x1:span.start+col.start,z1:begin+row.start,x2:span.start+col.start+col.length,z2:begin+row.start+row.length};let fits=true;
     for(let x=r.x1+50;x<r.x2&&fits;x+=100)for(let z=r.z1+50;z<r.z2;z+=100)if(!footprintContains(p,x,z)){fits=false;break;}
     if(fits)modules.push({id:`m${modules.length}`,type:col.length===6000||row.length===6000?'2x6':'2x2',x:metres(r.x1),z:metres(r.z1),rotation:row.length===6000?90:0});
    }
   }
  }
 }
 return modules;
}
export function corridorShell(p:Parameters,modules:PlacedModule[],spaces?:CorridorSpace[],networkVersion?:2|3|4):Maze{
 const maze:Maze={version:4,parameters:structuredClone(p),layout:{modules:structuredClone(modules),...(spaces?{spaces:structuredClone(spaces)}:{}),...(networkVersion?{networkVersion}:{})},width:p.columns,depth:p.rows,...DEFAULT_CONSTRUCTION,passages:[],entrance:{cell:0,side:'west'},exit:{cell:0,side:'east'}};
 const size=routingSize(maze);maze.passages=Array.from({length:size.columns*size.rows},()=>[]);const boundary=domainOf(maze).boundary;maze.entrance=boundary[0]?.portal??maze.entrance;maze.exit=boundary.at(-1)?.portal??maze.exit;return maze;
}
function build(p:Parameters,rng:RNG,deadline:number):Maze{
 const network=planCorridorNetwork(p,rng),maze=corridorShell(p,network?.modules??placement(p,rng),network?.spaces,network?.networkVersion);validatePlacement(maze);const d=domainOf(maze),owners=regionOwners(maze);
 if(network){
  const contacts=new Map<string,[number,number][]>();
  const join=(a:number,b:number)=>{maze.passages[a]!.push(b);maze.passages[b]!.push(a);};
  for(const a of d.cells)for(const b of neighbors(maze,a))if(b>a){if(owners[a]===owners[b])join(a,b);else{const key=[owners[a],owners[b]].sort((a,b)=>a!-b!).join(':');if(!contacts.has(key))contacts.set(key,[]);contacts.get(key)!.push([a,b]);}}
  // Keep the surrounding modules as enclosed corridors. A wide common side
  // gets a real two-metre doorway, rather than dissolving into the hall.
  const halls=network.spaces!.filter(s=>s.kind==='hall'),hallOwners=halls.map(h=>{const c=d.cells.find(c=>{const r=d.rectangles[c]!;return r.x1>=h.x&&r.x2<=h.x+h.width&&r.z1>=h.z&&r.z2<=h.z+h.height;});return c===undefined?-1:owners[c]!;}),hallContacts=new Map<number,[number,number][][]>();
  const selectedContacts:[number,number][][]=[];
  for(const pairs of contacts.values()){const [a,b]=pairs[0]!,hall=hallOwners.find(o=>o===owners[a]||o===owners[b]);if(hall===undefined)selectedContacts.push(pairs);else{if(!hallContacts.has(hall))hallContacts.set(hall,[]);hallContacts.get(hall)!.push(pairs);}}
  for(let i=0;i<hallOwners.length;i++){
    const choices=[...hallContacts.get(hallOwners[i]!)??[]];shuffle(choices,rng);const count=network.hallDoorCounts?.[i]??1;if(choices.length<count)throw Error('Недостаточно разных входов в зал.');
    const orientation=(pairs:[number,number][])=>{const r=d.rectangles[pairs[0]![0]]!,q=d.rectangles[pairs[0]![1]]!;return r.x2===q.x1||q.x2===r.x1;},chosen:[number,number][][]=[];
    for(let n=0;n<count;n++){const candidate=n?choices.findIndex(c=>chosen.every(p=>orientation(c)!==orientation(p))):0;chosen.push(choices.splice(candidate<0?0:candidate,1)[0]!);}selectedContacts.push(...chosen);
  }
  for(const pairs of selectedContacts){
    const r=d.rectangles[pairs[0]![0]]!,q=d.rectangles[pairs[0]![1]]!,vertical=r.x2===q.x1||q.x2===r.x1,sorted=pairs.sort((a,b)=>{const x=d.rectangles[a[0]]!,y=d.rectangles[b[0]]!;return vertical?x.z1-y.z1:x.x1-y.x1;}),lo=vertical?Math.max(r.z1,q.z1):Math.max(r.x1,q.x1),last=d.rectangles[sorted.at(-1)![0]]!,hi=vertical?last.z2:last.x2,start=lo+Math.max(0,(hi-lo-2)/2);
    for(const [a,b]of sorted){const x=d.rectangles[a]!,y=d.rectangles[b]!,a0=vertical?Math.max(x.z1,y.z1):Math.max(x.x1,y.x1),b0=vertical?Math.min(x.z2,y.z2):Math.min(x.x2,y.x2);if(a0>=start-1e-7&&b0<=start+2+1e-7)join(a,b);}
  }
  const boundary=corridorBoundaryPortals(maze),outer=boundary.filter(p=>{const w=corridorPortalWall(maze,p)!;return p.side==='west'?w.x1===0:p.side==='east'?w.x1===maze.width:p.side==='north'?w.z1===0:w.z1===maze.depth;});
  maze.entrance=outer.find(p=>p.side==='west')??outer[0]!;maze.exit=(p.loopTrapCount??0)>0?[...outer].filter(p=>p.side==='east').sort((a,b)=>Math.abs((corridorPortalWall(maze,a)!.z1+1)-(network.exitTarget?.z??maze.depth*.45))-Math.abs((corridorPortalWall(maze,b)!.z1+1)-(network.exitTarget?.z??maze.depth*.45)))[0]??outer.at(-1)!:[...outer].reverse().find(p=>p.side==='east')??outer.at(-1)!;
  if(!maze.entrance||!maze.exit)throw Error('На границе недостаточно места для входа и выхода.');maze.portals=[maze.entrance,maze.exit];
  if(independentCycles(maze)!==p.extraConnections)throw Error('Сеть создала незапрошенные циклы.');for(const links of maze.passages)links.sort((a,b)=>a-b);return maze;
 }
 const join=(a:number,b:number)=>{maze.passages[a]!.push(b);maze.passages[b]!.push(a);};
 const edges=new Map<string,[number,number][]>();
 for(const a of d.cells)for(const b of neighbors(maze,a))if(b>a){const x=owners[a]!,y=owners[b]!;if(x===y)join(a,b);else{const key=[x,y].sort((a,b)=>a-b).join(':');if(!edges.has(key))edges.set(key,[]);edges.get(key)!.push([a,b]);}}
 const offers=[...edges.values()];shuffle(offers,rng);const potential:[number,number][][]=[];
 for(const list of offers){
  const groups=new Map<string,[number,number][]>();for(const pair of list){const a=d.rectangles[pair[0]]!,b=d.rectangles[pair[1]]!,vertical=a.x2===b.x1||b.x2===a.x1,key=vertical?`x${Math.max(a.x1,b.x1)}`:`z${Math.max(a.z1,b.z1)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(pair);}
  const bundles:[number,number][][]=[];
  for(const group of groups.values()){
   const ar=d.rectangles[group[0]![0]]!,br=d.rectangles[group[0]![1]]!,vertical=ar.x2===br.x1||br.x2===ar.x1;
   group.sort((a,b)=>{const x=d.rectangles[a[0]]!,y=d.rectangles[b[0]]!;return vertical?x.z1-y.z1:x.x1-y.x1;});
   for(let start=0;start<group.length;start++){const bundle:[number,number][]= [];let length=0,end=-Infinity;for(let i=start;i<group.length;i++){const pair=group[i]!,r=d.rectangles[pair[0]]!,q=d.rectangles[pair[1]]!,lo=vertical?Math.max(r.z1,q.z1):Math.max(r.x1,q.x1),hi=vertical?Math.min(r.z2,q.z2):Math.min(r.x2,q.x2);if(i>start&&Math.abs(lo-end)>1e-7||length+hi-lo>p.corridorWidth+1e-7)break;bundle.push(pair);length+=hi-lo;end=hi;}if(length>=1-1e-7)bundles.push(bundle);}
  }
  if(!bundles.length)continue;
  const apertureLength=(bundle:[number,number][])=>bundle.reduce((sum,[a,b])=>{const r=d.rectangles[a]!,q=d.rectangles[b]!;return sum+(r.x2===q.x1||q.x2===r.x1?Math.min(r.z2,q.z2)-Math.max(r.z1,q.z1):Math.min(r.x2,q.x2)-Math.max(r.x1,q.x1));},0);
  const widest=Math.max(...bundles.map(apertureLength)),wide=bundles.filter(b=>Math.abs(apertureLength(b)-widest)<1e-7);shuffle(wide,rng);potential.push(wide[0]!);
 }
 const adjacent=new Map<number,{next:number;index:number}[]>();for(let i=0;i<potential.length;i++){const [a,b]=potential[i]![0]!,x=owners[a]!,y=owners[b]!;if(!adjacent.has(x))adjacent.set(x,[]);if(!adjacent.has(y))adjacent.set(y,[]);adjacent.get(x)!.push({next:y,index:i});adjacent.get(y)!.push({next:x,index:i});}
 const entered=new Set([owners[d.cells[0]!]!]),stack=[owners[d.cells[0]!]!],used=new Set<number>();
 while(stack.length){const at=stack.at(-1)!,choices=(adjacent.get(at)??[]).filter(e=>!entered.has(e.next));if(!choices.length){stack.pop();continue;}const e=choices[Math.floor(rng()*choices.length)]!;entered.add(e.next);stack.push(e.next);used.add(e.index);for(const [a,b]of potential[e.index]!)join(a,b);}
 const closed=potential.filter((_,i)=>!used.has(i));
 const reachable=new Set([d.cells[0]!]),queue=[d.cells[0]!];for(let i=0;i<queue.length;i++)for(const b of maze.passages[queue[i]!]!)if(!reachable.has(b)){reachable.add(b);queue.push(b);}if(reachable.size!==d.cells.length)throw Error('Для этой формы не найдено связное размещение с проходами не уже 1 м.');
 const boundary=corridorBoundaryPortals(maze).map(portal=>({portal,wall:corridorPortalWall(maze,portal)!}));if(boundary.length<2)throw Error('На границе недостаточно места для входа и выхода шириной 2 м.');maze.entrance=boundary.find(e=>e.portal.side==='west')?.portal??boundary[0]!.portal;maze.exit=(p.loopTrapCount??0)>0?[...boundary].filter(e=>e.portal.side==='east').sort((a,b)=>Math.abs((a.wall.z1+a.wall.z2)/2-maze.depth*.45)-Math.abs((b.wall.z1+b.wall.z2)/2-maze.depth*.45))[0]?.portal??boundary.at(-1)!.portal:[...boundary].reverse().find(e=>e.portal.side==='east')?.portal??boundary.at(-1)!.portal;maze.portals=[maze.entrance,maze.exit];
 // Navigation quads entirely inside open rooms do not count as independent loops.
 let cycles=independentCycles(maze),added=0;
 if(cycles!==0)throw Error('Размещение создало незапрошенные кольца.');
 const candidates=[...closed];
 while(added<p.extraConnections&&candidates.length){
  let selected=-1,quality=-Infinity;const tree=corridorNavigation(maze),onRoute=new Set(shortestPath(tree));
  for(let i=0;i<candidates.length;i++){
   if(Date.now()>deadline)throw Error('Исчерпан временной бюджет подбора.');
   const bundle=candidates[i]!;
   if((p.loopTrapCount??0)>added){
    const [a,b]=bundle[0]!,x=tree.navigation!.originalToRegion[a]!,y=tree.navigation!.originalToRegion[b]!,path=shortestPath(tree,x,y);if(path.filter(c=>onRoute.has(c)).length!==1)continue;
    const r=d.rectangles[a]!,q=d.rectangles[b]!,vertical=r.x2===q.x1||q.x2===r.x1,all=bundle.flatMap(([a,b])=>[d.rectangles[a]!,d.rectangles[b]!]),lo=vertical?Math.min(...all.map(r=>r.z1)):Math.min(...all.map(r=>r.x1)),hi=vertical?Math.max(...all.map(r=>r.z2)):Math.max(...all.map(r=>r.x2)),closing=vertical?{x:Math.max(r.x1,q.x1),z:(lo+hi)/2}:{x:(lo+hi)/2,z:Math.max(r.z1,q.z1)},points=path.slice(1).flatMap((c,j)=>{const p=openingMidpoint(tree,path[j]!,c);return [roomAnchor(tree,path[j]!,p),roomAnchor(tree,c,p)];});points.push(roomAnchor(tree,y,closing),roomAnchor(tree,x,closing));points.push(points[0]!);
    const length=points.slice(1).reduce((s,p,j)=>s+Math.hypot(p.x-points[j]!.x,p.z-points[j]!.z),0),width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),depth=Math.max(...points.map(p=>p.z))-Math.min(...points.map(p=>p.z));if(length<40||width<6||depth<6)continue;
   }
   for(const [a,b]of bundle)join(a,b);const next=independentCycles(maze);
   if(next===cycles+1){const loops=(p.loopTrapCount??0)>0?loopTraps(maze):null,[a,b]=bundle[0]!,path=shortestPath(tree,tree.navigation!.originalToRegion[a]!,tree.navigation!.originalToRegion[b]!),gain=path.slice(1).reduce((sum,c,j)=>{const previous=path[j]!;if(!onRoute.has(c)||!onRoute.has(previous))return sum;const p=tree.navigation!.centers[c]!,q=tree.navigation!.centers[previous]!;return sum+Math.hypot(p.x-q.x,p.z-q.z);},0),rank=loops?loops.qualifiedCount*1e6+(loops.candidates[0]?.score??0):gain;if(rank>quality){quality=rank;selected=i;}}
   for(const [a,b]of bundle){maze.passages[a]=maze.passages[a]!.filter(c=>c!==b);maze.passages[b]=maze.passages[b]!.filter(c=>c!==a);}
  }
  if(selected<0)break;const bundle=candidates.splice(selected,1)[0]!;for(const [a,b]of bundle)join(a,b);cycles++;added++;
 }
 if(added!==p.extraConnections)throw Error('Недостаточно места для заданного числа независимых дополнительных соединений.');

 for(const links of maze.passages)links.sort((a,b)=>a-b);return maze;
}
/** One placement/topology candidate, before user quality gates. */
export function corridorCandidate(p:Parameters,attempt=0,deadline=Date.now()+20000):Maze{return build(p,random(`${p.seed}:corridor:${attempt}`),deadline);}
export function generateCorridor(p:Parameters,previous?:Maze,onProgress?:(s:string)=>void,deadline=Date.now()+20000):Maze{
 validateParameters(p);let bestSideCandidate:Maze|undefined,bestSideRisk=Infinity,sideCandidates=0,completedBudget=true;let baselineModules=previous?.version===4?previous.layout!.modules.length:undefined;let reason='Нет подходящего размещения.';const budget=(p.loopTrapCount??0)>0&&Math.max(p.columns,p.rows)>=40?2048:(p.routeTrapCount??0)+(p.loopTrapCount??0)>0||p.design?384:Math.max(p.columns,p.rows)>=40?128:64;
 for(let attempt=0;attempt<budget;attempt++){
  if(Date.now()>deadline){completedBudget=false;break;}
  if(attempt%4===0)onProgress?.(`Коридорный: размещение и проходы ${attempt+1}/${budget}`);
  try{
   let target=p;
   if(p.design?.allowReshape&&attempt>=Math.floor(budget/2)){
    const factor=[.9,1.1,.8,1.2][attempt%4]!,growth=attempt%3===0?Math.min(.1,p.design.maxModuleGrowth):0,width=Math.max(2,Math.min(100,Math.round(p.columns*factor*10)/10)),depth=Math.max(2,Math.min(100,Math.round(p.columns*p.rows*(1+growth)/width*10)/10)),sx=width/p.columns,sz=depth/p.rows;
    target={...p,columns:width,rows:depth,...(p.shape?{shape:{...p.shape,rectangles:p.shape.rectangles.map(r=>({...r,x:Math.round(r.x*sx*10)/10,z:Math.round(r.z*sz*10)/10,width:Math.round(r.width*sx*10)/10,height:Math.round(r.height*sz*10)/10}))}}:{})};validateParameters(target);
   }
   let maze=build(target,random(`${p.seed}:corridor:${attempt}`),deadline);baselineModules??=maze.layout!.modules.length;
   if(target!==p&&maze.layout!.modules.length>baselineModules*(1+(p.design?.maxModuleGrowth??0))+1e-7)throw Error('Превышен разрешённый рост количества модулей.');
   if(previous){maze={...transferPortals(previous,maze),wallHeight:previous.wallHeight,wallColor:previous.wallColor,translucentFabric:previous.translucentFabric,roof:previous.roof,...(previous.environment?{environment:previous.environment}:{})};}
   validateCorridorSpaces(maze);validateFabricSupports(maze);
   if(maze.layout?.networkVersion===4&&Math.max(maze.width,maze.depth)>=40){const limit=Math.min(24,p.design?effectiveLimits(p).maxVisibleStraight:Infinity);if(corridorSight(maze,limit,4).exceeded||corridorSight(maze,limit,1).exceeded)throw Error(`Прямой или диагональный обзор превышает ${limit} м.`);}
   if(routeTraps(maze).qualifiedCount<(p.routeTrapCount??0))throw Error('Не найдено заданное число маршрутных ловушек.');
   if(loopTraps(maze).qualifiedCount<(p.loopTrapCount??0))throw Error('Не найдено заданное число кольцевых ловушек.');
   if(p.design){const q=corridorQuality(corridorNavigation(maze)),limits=effectiveLimits(p);if(q.longestForcedStraight>limits.maxForcedStraight||q.longestForcedRun>limits.maxForcedRun||q.longestVisibleStraight>limits.maxVisibleStraight)throw Error('Не выполнены ограничения длины проходов.');}
   if(p.design){const quality=analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:256},undefined,false);if(!quality.eligible)throw Error(quality.issues.join(' '));const confirmed=analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:2048},undefined,false);if(!confirmed.eligible)throw Error(confirmed.issues.join(' '));}
   if(maze.layout?.networkVersion===4&&Math.max(maze.width,maze.depth)>=40){
    let risk=0;for(const boundaryStrategy of ['adaptive','follow','avoid'] as const){const heat=analyzeColdspots(maze,{...DEFAULT_ANALYSIS,samples:64,boundaryStrategy}),district=sideDistricts(maze,heat.probability,heat.options.threshold);risk=Math.max(risk,heat.coldAreaRatio+.5*heat.largestColdArea/district.area+(1.5*district.largestProblemArea+.5*district.problemArea)/district.area);}
    if((p.loopTrapCount??0)>0){const rings=loopTraps(maze).candidates.filter(t=>t.qualifies);risk+=.15/(1+Math.min(...rings.map(t=>t.credibility.branchingDecisions)));}
    sideCandidates++;if(risk<bestSideRisk){bestSideRisk=risk;bestSideCandidate=maze;}
    if(sideCandidates<3){onProgress?.('Коридорный: сравниваем холодную площадь и боковые районы');continue;}
    return bestSideCandidate!;
   }
   return maze;
  }catch(e){reason=(e as Error).message;}
 }
 if(bestSideCandidate&&completedBudget)return bestSideCandidate;
 throw Error(`Коридорный: подбор исчерпан. ${reason} Попробуйте другую форму, размеры или ограничения.`);
}
