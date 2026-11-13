import type {Maze} from '../core/maze';
import type {FreeConnection,FreeDraft,FreeLayout,FreeModule} from './model';
import {mazeDraft} from './json';
import {connectionGeometry,freeMaze,modulePolygon} from './layout';
import {bounds,distance,ends,overlap,segment,segmentDistance} from './geometry';
import {physicallyOpen} from './cavity-maze';

function intersects(a:ReturnType<typeof modulePolygon>,b:ReturnType<typeof modulePolygon>){
 const x=bounds(a),y=bounds(b);
 return x.x1<y.x2&&x.x2>y.x1&&x.z1<y.z2&&x.z2>y.z1&&overlap(a,b);
}
/** Finite native-door fit. The largest feasible side span is preferred; the
 * physical upright clearance is reserved before accepting a real connector. */
export function fitHybridNativeDoor(draft:FreeDraft,aId:string,bId:string,id:string,deferPhysics=false):FreeConnection{
 const l=draft.layout,a=l.modules.find(m=>m.id===aId),b=l.modules.find(m=>m.id===bId);
 if(!a||!b)throw Error('Для глубокого перехода отсутствует настоящая рама.');
 const used=[...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings];
 const offsets=(m:FreeModule,edge:number)=>m.type==='2x6'&&edge%2===0?[0,-1.5,1.5,-2,2]:[0,-.18,.18,-.3,.3];
 const polygons=l.modules.map(modulePolygon),old=l.connections.map(c=>connectionGeometry(l,c).polygon),posts=polygons.flat(),candidates:{c:FreeConnection;span:number}[]=[];
 for(const ea of [0,1,2,3])for(const eb of [0,1,2,3])for(const oa of offsets(a,ea))for(const ob of offsets(b,eb))for(const width of [1.6,1.4,1.8,2].filter(w=>w<=draft.parameters.corridorWidth)){
  const c:FreeConnection={id,a:{room:aId,edge:ea,offset:oa},b:{room:bId,edge:eb,offset:ob},width};
  if([c.a,c.b].some(p=>used.some(u=>u.room===p.room&&u.edge===p.edge&&Math.abs(u.offset-p.offset)<(u.width+width)/2+.08)))continue;
  try{
   const g=connectionGeometry(l,c),span=Math.max(...g.sides.map(w=>distance(...ends(w)))),v={x:g.b.mid.x-g.a.mid.x,z:g.b.mid.z-g.a.mid.z};
   if(span>3+1e-7||span<.01||v.x*g.a.normal.x+v.z*g.a.normal.z<=0||-v.x*g.b.normal.x-v.z*g.b.normal.z<=0)continue;
   if(polygons.some(p=>intersects(g.polygon,p))||old.some(p=>intersects(g.polygon,p)))continue;
   if(Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1)continue;
   const inward=(p:typeof g.a)=>({x:p.mid.x-p.normal.x*.35,z:p.mid.z-p.normal.z*.35}),segments=[segment(inward(g.a),g.a.mid),segment(g.a.mid,g.b.mid),segment(g.b.mid,inward(g.b))];
   if([...posts,g.a.from,g.a.to,g.b.from,g.b.to].some(p=>segments.some(w=>segmentDistance(p,w)<.25+Math.SQRT2*.06+1e-5)))continue;
   candidates.push({c,span});
  }catch{/* An anchor which does not fit its real module side is ineligible. */}
 }
 candidates.sort((a,b)=>b.span-a.span||b.c.width-a.c.width);
 for(const row of candidates.slice(0,8)){
  const trial=structuredClone(draft);trial.layout.connections.push(row.c);trial.layout.moduleConstruction={version:1,spans:structuredClone(trial.layout.connections)};
  if(!deferPhysics&&physicallyOpen(trial))continue;
  return {...row.c,spanAudit:{desired:3,actual:row.span,reason:'Выборочный переход между существующими спиральными рамами; пролёт ограничен их настоящими гранями.'}};
 }
 throw Error(`Не найден физически свободный пролёт до3м: ${aId} / ${bId}.`);
}

/** Reserve deeper return circuits before allocating the negative-space bays.
 * The old hybrid keeps its original recipe. These native frames are obtained
 * from the same seed's uncarved spiral pool, never from a saved external map. */
export function reserveHybridVortex(base:Maze,pool:Pick<FreeLayout,'modules'|'connections'>,atomicTurns=false):Maze{
 const draft=mazeDraft(base),l=draft.layout,e=Number(l.openings.find(o=>o.id===l.entrance)!.room.match(/^spiral(\d)-23$/)![1]);
 const s=(arm:number,n:number)=>`spiral${(arm+e+3)%4}-${n}`,key=(a:string,b:string)=>[a,b].sort().join('|');
 const restore=[[2,8],[2,9],[1,6],[1,7],[1,12],[2,2],[2,3]]as const;
 for(const [arm,n] of [...restore].sort((a,b)=>pool.modules.findIndex(m=>m.id===s(a[0],a[1]))-pool.modules.findIndex(m=>m.id===s(b[0],b[1])))){const id=s(arm,n),module=pool.modules.find(m=>m.id===id);if(!module)throw Error('В исходной спирали отсутствует резервируемый модуль.');if(!l.modules.some(m=>m.id===id))l.modules.push(structuredClone(module));}
 const remove=new Set([[s(1,13),s(1,14)],[s(0,11),s(0,12)],[s(3,4),s(3,5)],[s(3,3),s(3,2)]].map(([a,b])=>key(a!,b!)));
 l.connections=l.connections.filter(c=>!remove.has(key(c.a.room,c.b.room)));
 const superseded=new Set(atomicTurns?[s(1,12),s(2,2),s(2,3)]:[]);
 const links=[
  [s(1,14),s(2,9)],[s(2,9),s(2,8)],[s(2,8),s(3,4)],
  [s(3,3),s(2,7)],[s(2,7),s(1,12)],[s(1,12),s(1,13)],
  [s(0,11),s(1,6)],[s(1,6),s(2,2)],[s(2,2),s(2,3)],
  [s(2,3),s(1,7)],[s(1,7),s(0,12)],[s(3,1),s(3,2)],
 ];
 for(const [a,b] of links)if(!superseded.has(a!)&&!superseded.has(b!)&&!l.connections.some(c=>key(c.a.room,c.b.room)===key(a!,b!))){
  const original=pool.connections.find(c=>key(c.a.room,c.b.room)===key(a!,b!));
  if(original)l.connections.push(structuredClone(original));
 }
 for(const [a,b] of links)if(!superseded.has(a!)&&!superseded.has(b!)&&!l.connections.some(c=>key(c.a.room,c.b.room)===key(a!,b!))){
  l.connections.push(fitHybridNativeDoor(draft,a!,b!,`hybrid-reserve-${a}-${b}`,atomicTurns));
 }
 if(atomicTurns)return fitHybridTurningFrames(freeMaze(draft,false),pool);
 l.moduleConstruction={version:1,spans:structuredClone(l.connections)};
 const issue=physicallyOpen(draft);if(issue)throw Error('Зарезервированные межвитковые переходы: '+issue);
 return freeMaze(draft,false);
}

/** A complete square-frame boundary separates the two-room blind end from
 * the main junction. It is not a narrow panel inside an open long room. */
export function separateHybridBlindBranch(base:Maze):Maze{
 const draft=mazeDraft(base),l=draft.layout,old=l.modules.find(m=>m.id==='vortex-central-junction');
 if(!old||old.type!=='2x6')throw Error('Отсутствует исходный шестиметровый перекрёсток.');
 const theta=old.angle*Math.PI/180,parts=[-1.5,.5,2.5].map((v,i):FreeModule=>({id:'vortex-deep-hub-'+i,type:'2x2',x:old.x+v*Math.cos(theta),z:old.z+v*Math.sin(theta),angle:old.angle}));
 l.modules=l.modules.filter(m=>m.id!==old.id);l.modules.push(...parts);
 for(const c of l.connections)for(const side of ['a','b']as const)if(c[side].room===old.id){
  const a=c[side],piece=a.edge===1?2:a.edge===3?0:Math.max(0,Math.min(2,Math.floor(((a.edge===0?a.offset:-a.offset)+3)/2))),center=(piece-1)*2+.5;
  c[side]={room:parts[piece]!.id,edge:a.edge,offset:a.edge===0?a.offset-center:a.edge===2?a.offset+center:a.offset};
  const g=connectionGeometry(l,c);c.spanAudit={desired:3,actual:Math.max(...g.sides.map(w=>distance(...ends(w)))),reason:'Проём настоящего квадратного каркаса на месте исходного длинного узла.'};
 }
 l.connections.push({id:'vortex-deep-false-internal',a:{room:parts[1]!.id,edge:1,offset:0},b:{room:parts[2]!.id,edge:3,offset:0},width:2});
 const e=Number(l.openings.find(o=>o.id===l.entrance)!.room.match(/^spiral(\d)-23$/)![1]),s=(a:number,n:number)=>`spiral${(a+e+3)%4}-${n}`;
 l.connections.push(fitHybridNativeDoor(draft,s(0,4),s(1,1),'vortex-deep-blind-entry'));
 l.moduleConstruction={version:1,spans:structuredClone(l.connections)};
 const issue=physicallyOpen(draft);if(issue)throw Error('Разделение настоящего перекрёстка: '+issue);
 return freeMaze(draft,false);
}

/** Two local six-metre turning-frame profiles. Positions are expressed in
 * their seed's own spiral frame, so no world coordinate or saved map is used. */
export function fitHybridTurningFrames(base:Maze,pool:Pick<FreeLayout,'modules'|'connections'>):Maze{
 const draft=mazeDraft(base),l=draft.layout,e=Number(l.openings.find(o=>o.id===l.entrance)!.room.match(/^spiral(\d)-23$/)![1]),s=(a:number,n:number)=>`spiral${(a+e+3)%4}-${n}`;
 const profiles=[
  {reference:s(1,12),removed:[s(1,12)],u:-.203037,v:.076094,turn:49.598889,
   doors:[{edge:1,offset:-.2,to:s(1,13),toEdge:3,toOffset:0,width:1.6},{edge:2,offset:-1.2,to:s(2,7),toEdge:0,toOffset:.3,width:1.4}]},
  {reference:s(2,2),removed:[s(2,2),s(2,3)],u:2.308105,v:-.879085,turn:211.557004,
   doors:[{edge:2,offset:-.4,to:s(1,7),toEdge:2,toOffset:.3,width:1.4},{edge:2,offset:-2,to:s(1,6),toEdge:2,toOffset:-.3,width:1.4}]},
 ];
 for(const profile of profiles){
  const ref=pool.modules.find(m=>m.id===profile.reference);if(!ref)throw Error('Нет исходной спиральной рамы для шестиметрового поворота.');
  const theta=ref.angle*Math.PI/180,module:FreeModule={id:profile.reference,type:'2x6',x:ref.x+profile.u*Math.cos(theta)-profile.v*Math.sin(theta),z:ref.z+profile.u*Math.sin(theta)+profile.v*Math.cos(theta),angle:ref.angle+profile.turn};
  l.modules=l.modules.filter(m=>!profile.removed.includes(m.id));l.modules.push(module);
  l.connections=l.connections.filter(c=>!profile.removed.includes(c.a.room)&&!profile.removed.includes(c.b.room));
  profile.doors.forEach((door,i)=>{
   const c:FreeConnection={id:'hybrid-turn-'+profile.reference+'-'+i,a:{room:module.id,edge:door.edge,offset:door.offset},b:{room:door.to,edge:door.toEdge,offset:door.toOffset},width:door.width};
   const g=connectionGeometry(l,c),actual=Math.max(...g.sides.map(w=>distance(...ends(w))));
   if(actual>3+1e-7)throw Error('Шестиметровая поворотная рама требует пролёт длиннее3м.');
   c.spanAudit={desired:3,actual,reason:'Поворотная рама2×6 между заранее зарезервированными спиральными витками.'};l.connections.push(c);
  });
 }
 l.moduleConstruction={version:1,spans:structuredClone(l.connections)};
 const issue=physicallyOpen(draft);if(issue)throw Object.assign(Error('Поворотные шестиметровые рамы: '+issue),{diagnosticDraft:draft});
 return freeMaze(draft,false);
}
