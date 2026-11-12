import type {Point} from '../core/maze';
import type {Anchor,FreeDraft,FreeLayout,FreeModule} from './model';
import {emptyLayout} from './model';
import {anchorGeometry,freeMaze,freeRuntime,connectionGeometry,modulePolygon,validateFree,physical} from './layout';
import {distance,edges,ends,pointIn,segmentInside,overlap,segmentDistance} from './geometry';
import {maximumConnectionGap} from './connection-span';
import {random,shuffle} from '../core/random';
import {CollisionWorld} from '../simulation/collisions';
import {freeGroundLengths} from './path-limits';
export interface CavityModuleGrowth {draft:FreeDraft;addedModules:number;addedConnections:number;loops:number;reason:string}
export interface CavityGrowthOptions{root?:string;target?:string;deferLengthCheck?:boolean;minimumExitDistance?:number;exitPoint?:Point;minimumNewModules?:number;maxDepth?:number;diverse?:boolean;rootAnchors?:Anchor[];targetAnchors?:Anchor[];lateral?:boolean;maximumSpanFirst?:boolean;retainExcursion?:boolean;targetApproachDistance?:number;physicalExcursion?:boolean;throughRoutes?:boolean;minimumGraphSeparation?:number;limits?:{straight:number;run:number};excludeRooms?:ReadonlySet<string>;maximumSpans?:boolean;doorWidth?:number;acceptCandidate?:(draft:FreeDraft)=>boolean}
interface Slot{anchor:Anchor;point:Point;normal:Point;degree:number}
interface Node{draft:FreeDraft;root:string;last:string;count:number;score:number;peak?:number;centerPeak?:number}
/** Native modules only. A failed search leaves the source draft untouched. */
export function growCavityModules(source:FreeDraft,polygon:Point[],seed:string,budget:number,onProgress?:(s:string)=>void,options?:CavityGrowthOptions):CavityModuleGrowth{
 const fail=(reason:string):CavityModuleGrowth=>({draft:source,addedModules:0,addedConnections:0,loops:0,reason});
 const depthLimit=Math.min(options?.maxDepth??4,Math.max(0,Math.floor(budget)));
 if(!depthLimit||!Number.isFinite(budget))return fail('Нет бюджета на полноценный модуль.');
 const contains=(p:Point)=>pointIn(p,polygon),boundary=edges(polygon),within=(poly:Point[])=>poly.every(contains)&&edges(poly).every(e=>segmentInside(...ends(e),contains,boundary));
 const width=Math.min(source.parameters.corridorWidth,options?.doorWidth??1.4),rng=random(seed),reasons=new Set<string>();
 const focused=!!(options?.root&&options?.target&&options?.deferLengthCheck);
 const focusedFloor=new WeakMap<FreeLayout,Point[][]>();
 let serial=0,rawChecks=0,geometryChecks=0,completeChecks=0,exhausted=false;
 let hash=2166136261;for(const ch of seed)hash=Math.imul(hash^ch.charCodeAt(0),16777619);
 const prefix=`cavity-module-${(hash>>>0).toString(16)}-`,ids=new Set([...source.layout.modules,...source.layout.connections,...source.layout.spaces].map(v=>v.id));
 const id=()=>{let value:string;do{value=prefix+serial++;}while(ids.has(value));ids.add(value);return value;};
 const slots=(layout:FreeLayout,only?:string):Slot[]=>{
  const occupied=[...layout.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...layout.openings,...(layout.bridges??[]).flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}])];
  return layout.modules.filter(m=>!m.frameOnly&&m.type!=='custom'&&(!only||m.id===only)).flatMap(m=>{
   const degree=layout.connections.filter(c=>c.a.room===m.id||c.b.room===m.id).length;
   return edges(modulePolygon(m)).flatMap((wall,edge)=>{
    const length=distance(...ends(wall)),limit=(length-width)/2-.12,offsets=length>3&&limit>0?[-limit,0,limit]:[0];
    return offsets.flatMap(offset=>{
     const anchor={room:m.id,edge,offset};if(occupied.some(o=>o.room===m.id&&o.edge===edge&&Math.abs(o.offset-offset)<(o.width+width)/2+.12))return [];
     const g=anchorGeometry(layout,anchor,width);return [{anchor,point:g.mid,normal:g.normal,degree}];
    });
   });
  });
 };
 const oldSlots=shuffle(slots(source.layout).filter(s=>{
  if(options?.excludeRooms?.has(s.anchor.room))return false;
  const g=anchorGeometry(source.layout,s.anchor,width);
  return segmentInside(g.from,g.to,contains,boundary)&&contains({x:g.mid.x+g.normal.x*.12,z:g.mid.z+g.normal.z*.12});
 }),rng).sort((a,b)=>Number(b.degree>=2)-Number(a.degree>=2));
 if(oldSlots.length<2)return fail('У полости нет двух свободных модульных проёмов шириной '+width.toFixed(1)+' м.');
 const adjacency=new Map<string,string[]>();for(const c of source.layout.connections){adjacency.set(c.a.room,[...adjacency.get(c.a.room)??[],c.b.room]);adjacency.set(c.b.room,[...adjacency.get(c.b.room)??[],c.a.room]);}
 const distances=new Map<string,Map<string,number>>();
 const apart=(a:string,b:string)=>{if(!distances.has(a)){const d=new Map([[a,0]]),q=[a];for(const at of q)for(const next of adjacency.get(at)??[])if(!d.has(next)){d.set(next,d.get(at)!+1);q.push(next);}distances.set(a,d);}return distances.get(a)!.get(b)??0;};
 const targets=(root:string)=>oldSlots.filter(s=>apart(root,s.anchor.room)>=(options?.minimumGraphSeparation??(options?.root&&options.target?(options.minimumNewModules??0)>=6?1:(options.minimumNewModules??0)>=4?2:3:3))&&(!options?.target||s.anchor.room===options.target)&&(!options?.targetAnchors||options.targetAnchors.some(a=>a.room===s.anchor.room&&a.edge===s.anchor.edge&&Math.abs(a.offset-s.anchor.offset)<1e-6)));
 const roots=oldSlots.filter(s=>(!options?.root||s.anchor.room===options.root)&&(!options?.rootAnchors||options.rootAnchors.some(a=>a.room===s.anchor.room&&a.edge===s.anchor.edge&&Math.abs(a.offset-s.anchor.offset)<1e-6))&&targets(s.anchor.room).length).sort((a,b)=>{
  const score=(s:Slot)=>Math.min(...targets(s.anchor.room).map(t=>distance(s.point,t.point)));
  return Number(b.degree>=2)-Number(a.degree>=2)||score(a)-score(b);
 });
 if(!roots.length)return fail('Проёмы относятся к одной короткой ветви; содержательное кольцо не замыкается.');
 const complete=(draft:FreeDraft):{reason:string;length:boolean}=>{
  const issues=validateFree(draft);if(issues.length)return {reason:issues[0]!.message,length:false};
  const maze=freeMaze(draft,false),r=freeRuntime(maze);if(r.paths.some(p=>p===null))return {reason:'Нет прохода с радиусом игрока.',length:false};
  const world=new CollisionWorld(r.obstacles);
  for(const path of [...r.edgePaths.values(),...r.portalPaths.values()])for(let i=1;i<path.length;i++){
   const a=path[i-1]!,b=path[i]!,p=world.move(a,{x:b.x-a.x,z:b.z-a.z});if(distance(p,b)>1e-5)return {reason:'Новый проход задевает стену или стойку.',length:false};
  }
  const lengths=freeGroundLengths(maze),limits=options?.limits??{straight:8,run:16};if(!options?.deferLengthCheck&&(lengths.straight>limits.straight+1e-7||lengths.run>limits.run+1e-7))return {reason:`Замыкание создаёт слишком длинный проход: ${lengths.straight.toFixed(2)}/${lengths.run.toFixed(2)} м при${limits.straight}/${limits.run}.`,length:true};
  return {reason:'',length:false};
 };
 const close=(node:Node):{result?:CavityModuleGrowth;lengthRejected:boolean}=>{
  let lengthRejected=false;
  const endsToUse=shuffle(slots(node.draft.layout,node.last),rng),toOld=targets(node.root);
  for(const a of endsToUse)for(const b of toOld){
   if(exhausted)return {lengthRejected};
   const d=distance(a.point,b.point);if(d<.15||d>3.05)continue;
   const dx=(b.point.x-a.point.x)/d,dz=(b.point.z-a.point.z)/d;
   if(a.normal.x*dx+a.normal.z*dz<.5||-b.normal.x*dx-b.normal.z*dz<.5)continue;
   const connection={id:id(),a:a.anchor,b:b.anchor,width},g=connectionGeometry(node.draft.layout,connection),longest=Math.max(...g.sides.map(w=>distance(...ends(w))));
   if(longest>3+1e-7||!within(g.polygon))continue;
   if(node.count<(options?.minimumNewModules??0))continue;
   if(options?.minimumExitDistance&&options.exitPoint&&(!node.draft.layout.modules.some(m=>!source.layout.modules.some(old=>old.id===m.id)&&distance(m,options.exitPoint!)>=options.minimumExitDistance!)||options.physicalExcursion&&Math.max(node.peak??0,distance(g.a.mid,options.exitPoint),distance(g.b.mid,options.exitPoint))<options.minimumExitDistance))continue;
   if(options?.maximumSpans&&Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1-1e-7)continue;
   const next=structuredClone(node.draft);next.layout.connections.push({...connection,spanAudit:{desired:3,actual:longest,...(longest<3-1e-6?{reason:'Замыкание между фиксированными модульными проёмами полости.'}:{})}});
   if(completeChecks>=12){exhausted=true;return {lengthRejected};}
   completeChecks++;const issue=complete(next);if(issue.reason){reasons.add(issue.reason);lengthRejected ||= issue.length;continue;}
   if(options?.acceptCandidate&&!options.acceptCandidate(next))continue;
   onProgress?.(`В полости замкнута модульная связь: ${node.count} модулей.`);
   return {lengthRejected:false,result:{draft:next,addedModules:node.count,addedConnections:node.count+1,loops:1,reason:`${node.count} настоящих модулей соединяют разные исходные ветви; все панели соединений до 3 м.`}};
  }
  return {lengthRejected};
 };
 let frontier:Node[]=[...new Map(roots.slice(0,32).map(s=>[s.anchor.room,{draft:source,root:s.anchor.room,last:s.anchor.room,count:0,score:0}])).values()];
 for(let depth=0;depth<depthLimit&&!exhausted;depth++){
  const nextFrontier:Node[]=[];let depthChecks=0,depthGeometry=0;
  placements:for(const node of frontier){
   const incomingEdges=options?.throughRoutes&&!source.layout.modules.some(m=>m.id===node.last)?node.draft.layout.connections.flatMap(c=>c.a.room===node.last?[c.a.edge]:c.b.room===node.last?[c.b.edge]:[]):[];
   const from=(depth===0?roots.filter(s=>s.anchor.room===node.root):shuffle(slots(node.draft.layout,node.last),rng)).filter(s=>!incomingEdges.includes(s.anchor.edge));
   starts:for(const start of from){let perStart=0,perStartRaw=0;for(const type of shuffle(['2x2','2x6'] as const,rng))for(const incoming of (type==='2x2'?[Math.floor(rng()*4)]:shuffle([2*Math.floor(rng()*2),1+2*Math.floor(rng()*2)],rng)))for(const bend of shuffle([0,-15,15,-30,30],rng)){
    if(options?.diverse&&perStart>=12)continue starts;
    if(exhausted||depthChecks>=512||depthGeometry>=(focused?96:48))break placements;
    const a=anchorGeometry(node.draft.layout,start.anchor,width),normals=[-90,0,90,180],angle=((Math.atan2(-a.normal.z,-a.normal.x)*180/Math.PI+bend-normals[incoming]!)%360+360)%360;
    const module:FreeModule={id:id(),type,x:0,z:0,angle},anchor={room:module.id,edge:incoming,offset:0},gate=anchorGeometry({...emptyLayout(),modules:[module]},anchor,width);
    const laterals=options?.lateral?[0,-.8,.8,-1.6,1.6,-2.2,2.2]:[0],spans=options?.maximumSpans?[3]:[3,2.5,2,1.5,1],placements=options?.maximumSpanFirst?spans.flatMap(span=>laterals.map(lateral=>({span,lateral}))):laterals.flatMap(lateral=>spans.map(span=>({span,lateral})));
    for(const {span,lateral}of placements){
     if(options?.maximumSpanFirst&&perStartRaw++>=48)continue starts;
     if(exhausted||depthChecks++>=512||depthGeometry>=(focused?96:48))break placements;rawChecks++;
     const tangent={x:-a.normal.z*lateral,z:a.normal.x*lateral},shifted={...gate,from:{x:gate.from.x+tangent.x,z:gate.from.z+tangent.z},to:{x:gate.to.x+tangent.x,z:gate.to.z+tangent.z}},gap=maximumConnectionGap(a,shifted,span);if(gap<.15)continue;
     module.x=a.mid.x+a.normal.x*gap+tangent.x-gate.mid.x;module.z=a.mid.z+a.normal.z*gap+tangent.z-gate.mid.z;
     if(!within(modulePolygon(module)))continue;
     const temporary={...node.draft.layout,modules:[...node.draft.layout.modules,module]},connection={id:id(),a:start.anchor,b:anchor,width},g=connectionGeometry(temporary,connection);
     if(!within(g.polygon))continue;
     if(focused){let floor=focusedFloor.get(node.draft.layout);if(!floor){floor=physical(node.draft.layout).polygons;focusedFloor.set(node.draft.layout,floor);}if(floor.some(p=>overlap(modulePolygon(module),p)||overlap(g.polygon,p)))continue;const widths=[segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!)];if(Math.min(...widths)<1-1e-7)continue;}
     const next=structuredClone(node.draft);next.layout.modules.push(structuredClone(module));next.layout.connections.push({...connection,spanAudit:{desired:3,actual:span,...(span<3?{reason:'Ограничение геометрией полости и модульного замыкания.'}:{})}});
     geometryChecks++;depthGeometry++;perStart++;const issues=focused?[]:validateFree(next,false);if(issues.length){reasons.add(issues[0]!.message);continue;}
     const centerDistance=options?.exitPoint?distance(module,options.exitPoint):0,excursion=options?.exitPoint?(options.physicalExcursion?Math.max(distance(g.a.mid,options.exitPoint),distance(g.b.mid,options.exitPoint)):centerDistance):0,peak=Math.max(node.peak??0,excursion),centerPeak=Math.max(node.centerPeak??0,centerDistance),completedPeak=options?.physicalExcursion?Math.min(peak,centerPeak):peak,targetDistance=Math.min(...targets(node.root).map(t=>distance({x:t.point.x+t.normal.x*(options?.targetApproachDistance??0),z:t.point.z+t.normal.z*(options?.targetApproachDistance??0)},module))),score=options?.retainExcursion&&options.minimumExitDistance&&options.exitPoint?(completedPeak>=options.minimumExitDistance?targetDistance-1000:targetDistance*.25+Math.max(0,peak<options.minimumExitDistance?options.minimumExitDistance-excursion:0,centerPeak<options.minimumExitDistance?options.minimumExitDistance-centerDistance:0)*4):targetDistance-(options?.minimumExitDistance&&options.exitPoint?Math.min(options.minimumExitDistance,distance(module,options.exitPoint))*2:0),candidate:Node={draft:next,root:node.root,last:module.id,count:node.count+1,score,...(options?.retainExcursion?{peak,centerPeak}:{})};
     const closure=close(candidate);if(closure.result)return closure.result;
     // A too-long closure calls for another topological contact, never a
     // smaller spacing of the same candidate.
     if(closure.lengthRejected)break;
     if(options?.diverse){const pose=(v:Node)=>{const m=v.draft.layout.modules.at(-1)!;return Math.round(m.x/2)+':'+Math.round(m.z/2)+':'+m.type;};const same=nextFrontier.findIndex(v=>pose(v)===pose(candidate));if(same>=0){if(nextFrontier[same]!.score<=candidate.score)continue;nextFrontier.splice(same,1);}}
     nextFrontier.push(candidate);nextFrontier.sort((a,b)=>a.score-b.score);nextFrontier.length=Math.min(nextFrontier.length,focused?16:8);
    }
   }
   }
  }
  frontier=nextFrontier;if(!frontier.length)break;
 }
 const reason=reasons.size?[...reasons].slice(0,3).join(' '):'В ограниченном поиске не найдена проходимая модульная цепь с двумя выходами на разные ветви.';
 return fail(`${exhausted?'Исчерпан фиксированный бюджет 12 полных проверок. ':''}${reason} Проверено размещений: ${rawChecks}, геометрически подходящих: ${geometryChecks}, полных проверок: ${completeChecks}.`);
}
