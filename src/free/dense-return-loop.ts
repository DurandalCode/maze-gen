import type {Maze,Point,Parameters} from '../core/maze';
import type {Anchor,FreeDraft} from './model';
import {mazeDraft} from './json';
import {anchorGeometry,connectionGeometry,freeGraphPath,freeMaze,freeRuntime,modulePolygon,validateFree} from './layout';
import {distance,edges,ends,segmentDistance,overlap} from './geometry';
import {growCavityModules} from './cavity-module-growth';
import {branchLongRoute} from './route-branches';
import {loopTraps} from '../analysis/loop-traps';
import {routeTraps} from '../analysis/route-traps';
import {shortestPath,pathLength} from '../core/pathfinding';
import {selectOppositePortals} from './opposite-portals';
import {auditModuleWalls} from './module-origin';
import {physicallyOpen} from './cavity-maze';
import {freeGroundLengths} from './path-limits';

/** Matching world shifts preserve each real span's length. Alternating shifts
 * on consecutive spans force a physical turn within their shared square. */
export function staggerDenseReturnSpans(draft:FreeDraft,ids:readonly string[],across:Point){
 for(const [index,id]of ids.entries()){
  const c=draft.layout.connections.find(c=>c.id===id);if(!c)throw Error('Не найден новый внутренний пролёт кольца.');
  c.width=1;const shift=index%2===0?.45:-.45;
  for(const a of [c.a,c.b]){a.offset=0;const g=anchorGeometry(draft.layout,a,c.width),length=distance(g.from,g.to),dot=((g.to.x-g.from.x)*across.x+(g.to.z-g.from.z)*across.z)/length;if(Math.abs(dot)<.999)throw Error('Ступенчатые проёмы требуют параллельных сторон новых рам.');a.offset=shift*Math.sign(dot);}
 }
}

/** Gate-relative (return-axis, false-entry-axis) centres. Legacy layouts keep
 * their exact recipe; the two-row policy turns the actual frames instead. */
export function denseReturnModulePoints(pattern?:Parameters['freePassagePattern']):ReadonlyArray<readonly[number,number]>{
 const first:readonly[number,number][]=[[0,7],[4.891366458960192,6.2],[9.782732917920384,5.4],[14.674099376880576,4.6]];
 return pattern==='two-row-v1'?[...first,[12.910167354380786,1.4],[8.674099376880576,-.6],[4.438031399380786,1.4]]:[...first,[13.674099376880576,-.22842712474619],[8.674099376880576,-.22842712474619],[3.674099376880576,-.22842712474619]];
}

/** Extend a genuine pendant arm back to its own route fork. A cycle joining
 * two different main-route rooms is deliberately not accepted as a return trap.
 * All placement search remains the bounded native-module search; no seed scan. */
export function attachDenseReturnLoop(source:Maze,forkId:string,seed:string,onProgress?:(s:string)=>void):Maze{
 if(!source.free||source.free.bridges?.length||source.free.preservedPanels)throw Error('Возвратное кольцо требует нативной одноэтажной свободной модульной карты.');
 const layout=source.free,r=freeRuntime(source),fork=r.rooms.findIndex(room=>room.id===forkId),module=layout.modules.find(m=>m.id===forkId);
 if(fork<0||!module||module.frameOnly||module.type==='custom')throw Error('Развилка кольца должна быть настоящим модулем2×2/2×6.');
 const route=new Set(shortestPath(source));if(!route.has(fork))throw Error('Развилка кольца не лежит на текущем маршруте к выходу.');
 if(fork===source.entrance.cell||fork===source.exit.cell)throw Error('Для возвратного кольца нужна промежуточная развилка, а не сам проём.');
 const width=Math.min(source.parameters.corridorWidth,1.4),portals=new Set(layout.openings.map(o=>o.room));
 const removedRepairs=new Set<string>(),oldConnections=new Set(layout.connections.map(c=>c.id));
 const components:number[][]=[],component=new Map<number,number>();
 for(const neighbor of r.passages[fork]!)if(!component.has(neighbor)){
  const group=[neighbor],index=components.length;component.set(neighbor,index);
  for(const at of group)for(const next of r.passages[at]!)if(next!==fork&&!component.has(next)){component.set(next,index);group.push(next);}
  components.push(group);
 }
 const sourceTraps=routeTraps(source).candidates.filter(t=>t.qualifies),protectedArms=new Set(sourceTraps.filter(t=>t.fork===fork).map(t=>t.falsePath[1]));
 const arm=components.flatMap((cells,index)=>{
  if(cells.some(c=>route.has(c)||portals.has(r.rooms[c]!.id)))return [];
  const doors=r.passages[fork]!.filter(n=>component.get(n)===index);
  if(doors.length!==1||protectedArms.has(doors[0])||cells.reduce((n,c)=>n+r.passages[c]!.filter(v=>v!==fork).length,0)/2!==cells.length-1)return [];
  const parent=new Map<number,number>([[doors[0]!,fork]]),lengths=new Map<number,number>([[fork,0]]),queue=[doors[0]!];
  for(const at of queue){const p=parent.get(at)!;lengths.set(at,lengths.get(p)!+pathLength(r.edgePaths.get(`${p}:${at}`)!));for(const next of r.passages[at]!)if(next!==fork&&!parent.has(next)){parent.set(next,at);queue.push(next);}}
  return cells.filter(c=>r.passages[c]!.length===1&&layout.modules.some(m=>m.id===r.rooms[c]!.id&&!m.frameOnly&&m.type!=='custom')).map(tail=>({tail,neighbor:doors[0]!,length:lengths.get(tail)!}));
 }).sort((a,b)=>b.length-a.length)[0];
 if(!arm)throw Error('У развилки нет настоящей тупиковой ветви с доступным модульным хвостом.');
 const ownConnection=layout.connections.find(c=>c.a.room===forkId&&c.b.room===r.rooms[arm.neighbor]!.id||c.b.room===forkId&&c.a.room===r.rooms[arm.neighbor]!.id);
 if(!ownConnection)throw Error('Не найден физический проём выбранной тупиковой ветви.');
 const falseDoor=ownConnection.a.room===forkId?ownConnection.a:ownConnection.b;
 const occupied=[...layout.connections.flatMap(c=>[{anchor:c.a,width:c.width,other:c.b.room},{anchor:c.b,width:c.width,other:c.a.room}]).filter(c=>c.anchor.room===forkId),...layout.openings.filter(o=>o.room===forkId).map(o=>({anchor:o,width:o.width,other:''}))];
 const available:Anchor[]=[];
 for(const [edge,wall]of edges(modulePolygon(module)).entries()){
  const length=distance(...ends(wall)),offsets=length>3?[-(length-width)/2+.12,0,(length-width)/2-.12]:[0];
  for(const offset of offsets)if(!occupied.some(o=>o.anchor.edge===edge&&Math.abs(o.anchor.offset-offset)<(o.width+width)/2+.12))available.push({room:forkId,edge,offset});
 }
 // For a connected outside component, alternating its doors with the two
 // return doors would require a ground crossing. Reject that embedding early.
 const planar=available.filter(anchor=>{
  const cuts=[...occupied.map(o=>({anchor:o.anchor,other:o.other,kind:o.anchor===falseDoor?'false':'outside'})),{anchor,other:'',kind:'new'}].sort((a,b)=>a.anchor.edge-b.anchor.edge||a.anchor.offset-b.anchor.offset);
  const first=cuts.findIndex(c=>c.anchor===falseDoor),last=cuts.findIndex(c=>c.kind==='new');
  if(first<0)return false;const sides=new Map<number,Set<boolean>>();
  cuts.forEach((cut,i)=>{if(cut.kind!=='outside'||!cut.other)return;const cell=r.rooms.findIndex(room=>room.id===cut.other),group=component.get(cell);if(group===undefined)return;const side=first<last?i>first&&i<last:i>first||i<last;const set=sides.get(group)??new Set<boolean>();set.add(side);sides.set(group,set);});
  return [...sides.values()].every(s=>s.size===1);
 });
 if(!planar.length)throw Error('Нет свободной двери для планарного возврата: основную сеть сначала нужно подключить к соседним сторонам развилки.');
 const originalTraps=sourceTraps.map(t=>r.rooms[t.fork]!.id);
 const originalLoops=loopTraps(source).candidates.filter(t=>t.qualifies).map(t=>r.rooms[t.fork]!.id);
 let accepted:Maze|undefined,diagnosticDraft:FreeDraft|undefined,repairedCandidates=0,reusedSectors=0,firstBridges=0,secondBridges=0,rejection='Ни один физический кандидат не прошёл квалификацию возвратного кольца.';
 const acceptClosed=(candidate:FreeDraft)=>{
  const added=candidate.layout.connections.filter(c=>!oldConnections.has(c.id)),closing=added.find(c=>c.a.room===forkId||c.b.room===forkId),gate=closing&&(closing.a.room===forkId?closing.a:closing.b);
  if(!gate||!planar.some(a=>a.edge===gate.edge&&Math.abs(a.offset-gate.offset)<1e-6))return false;
  const maze=freeMaze(candidate,false),runtime=freeRuntime(maze),at=runtime.rooms.findIndex(room=>room.id===forkId),first=runtime.rooms.findIndex(room=>room.id===r.rooms[arm.neighbor]!.id);
  const parent=new Map([[first,-1]]),queue=[first];for(const cell of queue)for(const next of runtime.passages[cell]!)if(next!==at&&!parent.has(next)){parent.set(next,cell);queue.push(next);}
  const doors=runtime.passages[at]!.filter(n=>parent.has(n));if(doors.length!==2)return false;
  const last=doors.find(n=>n!==first)!;if(last===undefined)return false;const cells=[last];while(cells.at(-1)!==first){const previous=parent.get(cells.at(-1)!);if(previous===undefined||previous<0)return false;cells.push(previous);}cells.reverse();
  const points=freeGraphPath(maze,[at,...cells,at]),length=pathLength(points),w=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),h=Math.max(...points.map(p=>p.z))-Math.min(...points.map(p=>p.z));
  if(length<40-1e-7||w<6-1e-7||h<6-1e-7){rejection=`Замыкание короткое/узкое: ${length.toFixed(2)}м, ${w.toFixed(2)}×${h.toFixed(2)}м.`;return false;}
  onProgress?.('Геометрия возвратного кольца: '+length.toFixed(2)+' м; проверяются две ложные двери.');
  const loopReport=loopTraps(maze),loop=loopReport.candidates.find(t=>t.fork===at&&t.qualifies);
  if(!loop){const t=loopReport.candidates.find(t=>t.fork===at);rejection=t?`Кольцо ${t.length.toFixed(2)}м/${t.width.toFixed(2)}×${t.depth.toFixed(2)}м не квалифицируется: входы ${t.entryProbabilities.map(p=>p.toFixed(3)).join('/')}, правильный ${t.correctProbability.toFixed(3)}.`:'Нет двухдверной возвратной компоненты у выбранной развилки.';return false;}
  onProgress?.('Возвратное кольцо К подтверждено; проверяются реальные8/16 и существующие ловушки.');
  if(repairedCandidates++>=2){rejection='Исчерпан фиксированный бюджет двух полных ремонтов длинного кольца.';return false;}
  try{
   const returnGuards=source.parameters.freePassagePattern==='two-row-v1'?[{fork:forkId,doors:[runtime.rooms[loop.loop[1]!]!.id,runtime.rooms[loop.loop.at(-2)!]!.id]as[string,string]}]:[];
   const fixed=branchLongRoute(maze,seed+'-return-branches',onProgress,false,6,[forkId,...originalTraps],returnGuards),draft=mazeDraft(fixed),runtimeAfter=freeRuntime(fixed);diagnosticDraft=draft;
   if(layout.modules.filter(m=>!removedRepairs.has(m.id)).some(m=>JSON.stringify(draft.layout.modules.find(n=>n.id===m.id))!==JSON.stringify(m)))throw Error('Исходные модули изменились.');
   const current=new Set(draft.layout.moduleConstruction?.spans.map(c=>c.id)??[]),ids=new Set(draft.layout.modules.filter(m=>!m.frameOnly&&m.type!=='custom').map(m=>m.id));
   if(draft.layout.moduleConstruction)for(const c of draft.layout.connections)if(ids.has(c.a.room)&&ids.has(c.b.room)&&!current.has(c.id)){draft.layout.moduleConstruction.spans.push(structuredClone(c));current.add(c.id);}
   const issues=validateFree(draft);if(issues.length)throw Error(issues[0]!.message);
   if(auditModuleWalls(draft.layout).issues.length||physicallyOpen(draft))throw Error('Кольцо нарушает модульные опоры или физический проход.');
   const result=freeMaze(draft,false),gates=draft.layout.openings.filter(o=>o.id===draft.layout.entrance||o.id===draft.layout.exit);
   if(!selectOppositePortals(draft.layout,gates,Math.min(...gates.map(o=>o.width))).length)throw Error('Новые рамы вышли за противоположные внешние границы проёмов.');
   const lengths=freeGroundLengths(result);if(lengths.straight>8+1e-7||lengths.run>16+1e-7)throw Error('Кольцо не выдержало физических8/16после полноценных боковых ветвей.');
   const loopForks=new Set(loopTraps(result).candidates.filter(t=>t.qualifies).map(t=>runtimeAfter.rooms[t.fork]!.id));if(!loopForks.has(forkId)||originalLoops.some(id=>!loopForks.has(id)))throw Error('После боковых ветвей возвратная ловушка перестала квалифицироваться.');
   const preserved=new Set(routeTraps(result).candidates.filter(t=>t.qualifies).map(t=>runtimeAfter.rooms[t.fork]!.id));if(originalTraps.some(id=>!preserved.has(id)))throw Error('Кольцо разрушило существующую отдельную тупиковую ловушку.');
   accepted=result;return true;
  }catch(e){diagnosticDraft=(e as {diagnosticDraft?:FreeDraft})?.diagnosticDraft??diagnosticDraft;rejection=e instanceof Error?e.message:String(e);return false;}
 };
 const draft=mazeDraft(source);let polygon=[{x:0,z:0},{x:source.parameters.columns,z:0},{x:source.parameters.columns,z:source.parameters.rows},{x:0,z:source.parameters.rows}];
 // Preserve the actual exterior support planes during search, rather than
 // spending all complete-candidate slots on loops beyond the saved portals.
 for(const gate of layout.openings.filter(o=>o.id===layout.entrance||o.id===layout.exit)){
  const g=anchorGeometry(layout,gate,gate.width),side=(p:{x:number;z:number})=>(p.x-g.mid.x)*g.normal.x+(p.z-g.mid.z)*g.normal.z,out:typeof polygon=[];
  for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,da=side(a),db=side(b);if(da<=1e-7)out.push(a);if((da<=1e-7)!==(db<=1e-7)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}}
  polygon=out;
 }
 // A small gate-relative return feature, never a replacement of the dense core.
 // Actual separate square corner frames provide physical turns, rather
 // than a bent centre line through a long straight corridor.
 let triedFeature=false;
 for(const gate of planar){
  if(accepted)break;
  const outward=anchorGeometry(layout,gate,width).normal,falseAxis=anchorGeometry(layout,falseDoor,ownConnection.width).normal;
  if(Math.abs(outward.x*falseAxis.x+outward.z*falseAxis.z)>.1)continue;
  const origin={x:module.x,z:module.z},tail=r.centers[arm.tail]!,tailU=(tail.x-origin.x)*outward.x+(tail.z-origin.z)*outward.z,tailV=(tail.x-origin.x)*falseAxis.x+(tail.z-origin.z)*falseAxis.z;
  if(Math.abs(tailU)>.1||tailV<1.9||tailV>3)continue;
  triedFeature=true;
  const feature=structuredClone(draft),points=denseReturnModulePoints(source.parameters.freePassagePattern),rooms=[r.rooms[arm.tail]!.id];
  const entry=feature.layout.connections.find(c=>c.id===ownConnection.id)!;entry.width=source.parameters.freePassagePattern==='two-row-v1'?2:1.8;entry.a.offset=0;entry.b.offset=0;
  let serial=0;const prefix=`dense-return-${seed.replace(/[^a-zA-Z0-9]/g,'').slice(-32)}-`;
  for(const [u,v]of points){const id=prefix+serial++;if(feature.layout.modules.some(m=>m.id===id))throw Error('Повторный идентификатор кольца.');feature.layout.modules.push({id,type:'2x2',x:origin.x+outward.x*u!+falseAxis.x*v!,z:origin.z+outward.z*u!+falseAxis.z*v!,angle:module.angle});rooms.push(id);}
  rooms.push(forkId);let valid=true;
  for(let k=1;k<rooms.length;k++){
   const a=feature.layout.modules.find(m=>m.id===rooms[k-1])!,b=feature.layout.modules.find(m=>m.id===rooms[k])!,dx=b.x-a.x,dz=b.z-a.z;

   const from=[0,1,2,3].map(edge=>({room:a.id,edge,offset:0})),to=k===rooms.length-1?[gate]:[0,1,2,3].map(edge=>({room:b.id,edge,offset:0}));
   const choices=from.flatMap(aa=>to.map(bb=>{
    const c={id:prefix+'span-'+k,a:aa,b:bb,width:source.parameters.freePassagePattern==='two-row-v1'?2:k===rooms.length-1?1.4:1.8},g=connectionGeometry(feature.layout,c),pa=anchorGeometry(feature.layout,aa,c.width),pb=anchorGeometry(feature.layout,bb,c.width);
    const usable=pa.normal.x*dx+pa.normal.z*dz>.1&&pb.normal.x*dx+pb.normal.z*dz<-.1;
    const widest=Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!)),longest=Math.max(...g.sides.map(w=>distance(...ends(w))));
    return {c,widest,longest,usable};
   })).filter(c=>c.usable&&c.widest>=1-1e-7&&c.longest<=3+1e-7).sort((a,b)=>b.widest-a.widest||a.longest-b.longest);
   const connection=choices[0]?.c;
   if(!connection){rejection='Нет поддержанного пролёта до3м у рам возвратного кольца '+k;valid=false;break;}

   feature.layout.connections.push(connection);
  }
  if(valid&&source.parameters.freePassagePattern!=='two-row-v1')staggerDenseReturnSpans(feature,[prefix+'span-6',prefix+'span-7'],falseAxis);
  if(valid){
   const protectedRooms=new Set(sourceTraps.flatMap(t=>t.falsePath).map(c=>r.rooms[c]!.id)),seen=new Set<number>();
   const newFloor=[...feature.layout.modules.filter(m=>!layout.modules.some(old=>old.id===m.id)).map(modulePolygon),...feature.layout.connections.filter(c=>!oldConnections.has(c.id)).map(c=>connectionGeometry(feature.layout,c).polygon)];
   let removedComponents=0;
   for(let start=0;start<r.rooms.length;start++)if(!route.has(start)&&!seen.has(start)){
    const cells=[start];seen.add(start);for(const at of cells)for(const next of r.passages[at]!)if(!route.has(next)&&!seen.has(next)){seen.add(next);cells.push(next);}
    const names=new Set(cells.map(c=>r.rooms[c]!.id)),frames=layout.modules.filter(m=>names.has(m.id)),attachments=layout.connections.filter(c=>names.has(c.a.room)!==names.has(c.b.room));
    if(frames.length!==2||!frames.every(m=>m.id.startsWith('route-arm-')&&(m.type==='2x2'||m.type==='2x6'))||!frames.some(m=>m.type==='2x2')||!frames.some(m=>m.type==='2x6')||cells.some(c=>protectedRooms.has(r.rooms[c]!.id))||attachments.length!==1)continue;
    const componentFloor=[...frames.map(modulePolygon),...layout.connections.filter(c=>names.has(c.a.room)||names.has(c.b.room)).map(c=>connectionGeometry(layout,c).polygon)];
    if(!componentFloor.some(p=>newFloor.some(q=>overlap(p,q))))continue;
    if(removedComponents++>=2){valid=false;rejection='Кольцо потребовало бы переместить больше двух новых вспомогательных ветвей.';break;}
    frames.forEach(m=>removedRepairs.add(m.id));const cuts=new Set(feature.layout.connections.filter(c=>names.has(c.a.room)||names.has(c.b.room)).map(c=>c.id));
    feature.layout.modules=feature.layout.modules.filter(m=>!names.has(m.id));feature.layout.spaces=feature.layout.spaces.filter(s=>!names.has(s.id));feature.layout.connections=feature.layout.connections.filter(c=>!cuts.has(c.id));
    if(feature.layout.moduleConstruction)feature.layout.moduleConstruction.spans=feature.layout.moduleConstruction.spans.filter(c=>!cuts.has(c.id)&&!names.has(c.a.room)&&!names.has(c.b.room));
    onProgress?.('Конфликтующая новая двухкомнатная ветвь переносится; финальные8/16 и Л2 обязательны.');
   }
  }
  const issues=valid?validateFree(feature):[];if(issues.length){rejection=JSON.stringify(issues[0]);if(issues[0]!.code==='clearance'){const rr=freeRuntime(freeMaze(feature,false));rejection+=' '+feature.layout.connections.filter(c=>{const a=rr.rooms.findIndex(r=>r.id===c.a.room),b=rr.rooms.findIndex(r=>r.id===c.b.room);return !rr.edgePaths.has(`${a}:${b}`);}).map(c=>c.id).join(',');}valid=false;}
  if(valid)acceptClosed(feature);
 }
 const options={root:r.rooms[arm.tail]!.id,target:forkId,deferLengthCheck:true,minimumNewModules:6,maxDepth:7,diverse:true,lateral:true,targetAnchors:planar,acceptCandidate:acceptClosed};
 const growth=accepted||triedFeature?{reason:'Модульная возвратная фигура.'}:growCavityModules(draft,polygon,seed,8,onProgress,options);
 if(!accepted){
  // Reuse a pre-existing off-route component when a completely new
  // external circuit cannot fit. Only zero-length endpoint doors may close;
  // their corridor floors and all source frames remain in place.
  const sameSide=planar.filter(a=>a.edge===falseDoor.edge),moduleIds=new Set(layout.modules.filter(m=>!m.frameOnly&&m.type!=='custom').map(m=>m.id));
  const sectors:{first:string;last:string;cuts:string[];score:number}[]=[],seen=new Set<number>(),origins=auditModuleWalls(layout).origins;
  const supportedCut=(c:typeof layout.connections[number])=>{const a=anchorGeometry(layout,c.a,c.width),b=anchorGeometry(layout,c.b,c.width);return distance(a.mid,b.mid)<=1e-6&&origins.some(o=>segmentDistance(a.from,o.wall)<1e-6&&segmentDistance(a.to,o.wall)<1e-6);};
  for(let start=0;start<r.rooms.length;start++)if(!route.has(start)&&!seen.has(start)){
   const cells=[start];seen.add(start);for(const at of cells)for(const next of r.passages[at]!)if(!route.has(next)&&!seen.has(next)){seen.add(next);cells.push(next);}
   if(cells.some(c=>portals.has(r.rooms[c]!.id)||component.get(c)===component.get(arm.neighbor)))continue;
   const modules=cells.filter(c=>moduleIds.has(r.rooms[c]!.id));if(modules.length<2||modules.length>5)continue;
   const names=new Set(cells.map(c=>r.rooms[c]!.id)),cuts=layout.connections.filter(c=>names.has(c.a.room)!==names.has(c.b.room));if(cuts.length<2||cuts.length>3||cuts.some(c=>!supportedCut(c)))continue;
   const excluded=new Set(cells),connected=new Set([source.entrance.cell]),queue=[source.entrance.cell];for(const c of queue)for(const n of r.passages[c]!)if(!excluded.has(n)&&!connected.has(n)){connected.add(n);queue.push(n);}
   if(connected.size!==r.rooms.length-cells.length)continue;
   const pairs:{a:number;b:number;length:number}[]=[];
   for(const a of modules){const distances=new Map([[a,0]]),todo=new Set(cells);while(todo.size){let at=-1,best=Infinity;for(const c of todo)if((distances.get(c)??Infinity)<best){at=c;best=distances.get(c)!;}if(at<0)break;todo.delete(at);for(const next of r.passages[at]!)if(excluded.has(next)){const value=best+pathLength(r.edgePaths.get(`${at}:${next}`)!);if(value<(distances.get(next)??Infinity))distances.set(next,value);}}for(const b of modules)if(a!==b)pairs.push({a,b,length:distances.get(b)??0});}
   const diameter=Math.max(...pairs.map(p=>p.length));
   for(const pair of pairs.filter(p=>p.length>=diameter-1e-6)){
    sectors.push({first:r.rooms[pair.a]!.id,last:r.rooms[pair.b]!.id,cuts:cuts.map(c=>c.id),score:distance(r.centers[arm.tail]!,r.centers[pair.a]!)+distance(r.centers[pair.b]!,r.centers[fork]!)});
   }
  }
  sectors.sort((a,b)=>a.score-b.score);
  for(const [index,sector]of sectors.slice(0,sameSide.length?3:0).entries()){
   reusedSectors++;let secondSearches=0;
   const firstOptions={root:r.rooms[arm.tail]!.id,target:sector.first,deferLengthCheck:true,diverse:true,lateral:true,maxDepth:3,acceptCandidate:(firstDraft:FreeDraft)=>{
    firstBridges++;
    if(secondSearches++>=2)return false;
    const secondOptions={root:sector.last,target:forkId,targetAnchors:sameSide,deferLengthCheck:true,diverse:true,lateral:true,minimumNewModules:2,maxDepth:4,acceptCandidate:(secondDraft:FreeDraft)=>{
     const closing=secondDraft.layout.connections.find(c=>!oldConnections.has(c.id)&&(c.a.room===forkId||c.b.room===forkId)),gate=closing&&(closing.a.room===forkId?closing.a:closing.b);
     if(!gate||!sameSide.some(a=>a.edge===gate.edge&&Math.abs(a.offset-gate.offset)<1e-6))return false;secondBridges++;
     const closed=structuredClone(secondDraft);closed.layout.connections=closed.layout.connections.filter(c=>!sector.cuts.includes(c.id));return acceptClosed(closed);
    }};
    growCavityModules(firstDraft,polygon,`${seed}-sector-${index}-return`,4,onProgress,secondOptions);return !!accepted;
   }};
   growCavityModules(draft,polygon,`${seed}-sector-${index}-out`,3,onProgress,firstOptions);
   if(accepted)break;
  }
 }
 if(!accepted)throw Object.assign(Error(`Возвратное кольцо не построено: ${rejection} ${growth.reason} Секторов: ${reusedSectors}, первых мостиков: ${firstBridges}, возвратных мостиков: ${secondBridges}.`),{diagnosticDraft});
 return accepted;
}
