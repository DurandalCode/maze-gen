import {anchorGeometry,connectionGeometry,modulePolygon} from './layout';
import {area,bounds,distance,ends,overlap,segment,segmentDistance} from './geometry';
import type {Anchor,FreeConnection,FreeLayout,FreeModule} from './model';
/** A native six-metre interchange replaces two adjacent square frames. All
 * surviving neighbours must retain an actual, capsule-clear physical doorway. */
function mergeJunction(l:FreeLayout,aId:string,bId:string,id:string,maximumWidth:number,minimumDoors=3,preference=1,fixedPose?:FreeModule):boolean{
 const a=l.modules.find(m=>m.id===aId),b=l.modules.find(m=>m.id===bId);if(!a||!b)return false;
 const removed=new Set([aId,bId]),old=l.connections.filter(c=>removed.has(c.a.room)||removed.has(c.b.room));
 const neighbours=old.filter(c=>!(removed.has(c.a.room)&&removed.has(c.b.room))).map(c=>({original:c,anchor:removed.has(c.a.room)?c.b:c.a}));
 if(new Set(neighbours.map(n=>n.anchor.room)).size!==neighbours.length||neighbours.length<minimumDoors)return false;
 const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1,baseAngle=Math.atan2(dz,dx)*180/Math.PI;
 const survivors=l.modules.filter(m=>!removed.has(m.id)),by=new Map(survivors.map(m=>[m.id,m])),fixed=l.connections.filter(c=>!removed.has(c.a.room)&&!removed.has(c.b.room));
 const roomShapes=survivors.map(modulePolygon),fixedShapes=fixed.map(c=>connectionGeometry(l,c).polygon),portals=l.openings.map(o=>anchorGeometry(l,o,o.width));
 const intersects=(p:ReturnType<typeof modulePolygon>,q:ReturnType<typeof modulePolygon>)=>{const a=bounds(p),b=bounds(q);return a.x1<b.x2&&a.x2>b.x1&&a.z1<b.z2&&a.z2>b.z1&&overlap(p,q);};
 const turns=minimumDoors===2?[0,7,-7,14,-14]:id==='vortex-knot-winding'?[-22*preference,-15*preference,0,7,-7,14,-14]:[22*preference,15*preference,0,7,-7,14,-14];
 const poses=fixedPose?[fixedPose]:[0,.3,-.3].flatMap(along=>[0,.3,-.3].flatMap(shift=>turns.map(turn=>({id,type:'2x6' as const,x:(a.x+b.x)/2-shift*dz/len+along*dx/len,z:(a.z+b.z)/2+shift*dx/len+along*dz/len,angle:baseAngle+turn}))));
 for(const hub of poses){
  const trial:FreeLayout={...l,modules:[...survivors,hub],connections:[...fixed]},polygon=modulePolygon(hub);
  if(roomShapes.some(p=>intersects(polygon,p))||fixedShapes.some(p=>intersects(polygon,p))||portals.some(g=>polygon.some(p=>(p.x-g.mid.x)*g.normal.x+(p.z-g.mid.z)*g.normal.z>1e-7)))continue;
  const accepted=[...fixedShapes],ordered=[...neighbours].sort((a,b)=>{const p=by.get(a.anchor.room)!,q=by.get(b.anchor.room)!;return Math.round(Math.hypot(q.x-hub.x,q.z-hub.z)*1e8)-Math.round(Math.hypot(p.x-hub.x,p.z-hub.z)*1e8)||(a.anchor.room<b.anchor.room?-1:a.anchor.room>b.anchor.room?1:0);});let ok=true;
  for(const [n,neighbour]of ordered.entries()){
   const target=by.get(neighbour.anchor.room)!,gates={...trial,modules:[hub,target]},cornerPosts=[...polygon,...modulePolygon(target)];
   const candidates:{c:FreeConnection;span:number;alignment:number;polygon:ReturnType<typeof modulePolygon>}[]=[];
   for(const edge of [0,1,2,3])for(const offset of (hub.type==='2x2'?[0,-.1,.1,-.2,.2,-.3,.3]:[0,-.1,.1,-.2,.2,-.3,.3,-.5,.5,-1,1,-1.5,1.5,-2,2,-2.2,2.2,-2.3,2.3]))for(const otherOffset of [...new Set([neighbour.anchor.offset,0,-.1,.1,-.3,.3])])for(const width of [1.2,1.4,1.6,1.8,2].filter(w=>w<=maximumWidth))try{
    const c:FreeConnection={id:id+'-door-'+n,a:{room:id,edge,offset},b:{...neighbour.anchor,offset:otherOffset},width};
    if(trial.connections.some(c2=>[c2.a,c2.b].some(p=>(p.room===id&&p.edge===edge&&Math.abs(p.offset-offset)<(c2.width+width)/2+.08)||(p.room===target.id&&p.edge===c.b.edge&&Math.abs(p.offset-otherOffset)<(c2.width+width)/2+.08))))continue;
    const g=connectionGeometry(gates,c),span=Math.max(...g.sides.map(w=>distance(...ends(w))));if(span>3+1e-7||area(g.polygon)<.01)continue;
    const v={x:g.b.mid.x-g.a.mid.x,z:g.b.mid.z-g.a.mid.z},length=Math.hypot(v.x,v.z),alignment=Math.min((v.x*g.a.normal.x+v.z*g.a.normal.z)/length,(-v.x*g.b.normal.x-v.z*g.b.normal.z)/length);if(alignment<=0)continue;
    if(roomShapes.some(p=>intersects(g.polygon,p))||intersects(g.polygon,polygon)||accepted.some(p=>intersects(g.polygon,p)))continue;
    if(Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1)continue;
    const pa={x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35},pb={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35};
    if([...cornerPosts,g.a.from,g.a.to,g.b.from,g.b.to].some(p=>[segment(pa,g.a.mid),segment(g.a.mid,g.b.mid),segment(g.b.mid,pb)].some(w=>segmentDistance(p,w)<.25+Math.SQRT2*.06+1e-5)))continue;
    candidates.push({c,span,alignment,polygon:g.polygon});
   }catch{/* This opening does not fit the actual frame. */}
   candidates.sort((a,b)=>Math.round(b.alignment*20)-Math.round(a.alignment*20)||b.c.width-a.c.width||Math.round(b.span*1e8)-Math.round(a.span*1e8));const chosen=candidates[0];if(!chosen){ok=false;break;}
   trial.connections.push({...chosen.c,spanAudit:{desired:3,actual:chosen.span,reason:hub.type==='2x6'?'Косой шестиметровый перекрёсток между двумя спиральными ветвями.':'Индивидуальная ориентация реальной квадратной рамы.'}});accepted.push(chosen.polygon);
  }
  if(ok){l.modules=trial.modules;l.connections=trial.connections;return true;}
 }
 return false;
}
function connectFrames(l:FreeLayout,a:string,b:string,id:string,maximumWidth:number):boolean{
 const by=new Map(l.modules.map(m=>[m.id,m])),gates={...l,modules:[by.get(a)!,by.get(b)!]},shapes=l.modules.map(modulePolygon),fixed=l.connections.map(c=>connectionGeometry(l,c).polygon),corners=gates.modules.flatMap(modulePolygon),candidates:{c:FreeConnection;span:number;alignment:number}[]=[];
 for(const edgeA of [0,1,2,3])for(const edgeB of [0,1,2,3])for(const offsetA of [0,-.1,.1,-.3,.3])for(const offsetB of [0,-.1,.1,-.3,.3])for(const width of [1.2,1.4,1.6,1.8,2].filter(w=>w<=maximumWidth))try{
  const c:FreeConnection={id,a:{room:a,edge:edgeA,offset:offsetA},b:{room:b,edge:edgeB,offset:offsetB},width};if(l.connections.some(q=>[q.a,q.b].some(p=>(p.room===a&&p.edge===edgeA&&Math.abs(p.offset-offsetA)<(q.width+width)/2+.08)||(p.room===b&&p.edge===edgeB&&Math.abs(p.offset-offsetB)<(q.width+width)/2+.08))))continue;
  const g=connectionGeometry(gates,c),span=Math.max(...g.sides.map(w=>distance(...ends(w))));if(span>3+1e-7||area(g.polygon)<.01)continue;const v={x:g.b.mid.x-g.a.mid.x,z:g.b.mid.z-g.a.mid.z},length=Math.hypot(v.x,v.z),alignment=Math.min((v.x*g.a.normal.x+v.z*g.a.normal.z)/length,(-v.x*g.b.normal.x-v.z*g.b.normal.z)/length);if(alignment<=0||shapes.some(p=>overlap(g.polygon,p))||fixed.some(p=>overlap(g.polygon,p)))continue;
  const pa={x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35},pb={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35};if([...corners,g.a.from,g.a.to,g.b.from,g.b.to].some(p=>[segment(pa,g.a.mid),segment(g.a.mid,g.b.mid),segment(g.b.mid,pb)].some(w=>segmentDistance(p,w)<.25+Math.SQRT2*.06+1e-5)))continue;candidates.push({c,span,alignment});
 }catch{/* An anchor must remain on a real frame. */}
 candidates.sort((a,b)=>Math.round(b.alignment*20)-Math.round(a.alignment*20)||b.c.width-a.c.width||Math.round(b.span*1e8)-Math.round(a.span*1e8));const best=candidates[0];if(!best)return false;l.connections.push({...best.c,spanAudit:{desired:3,actual:best.span,reason:'Косой внутренний возврат между соседними рамами.'}});return true;
}
/** Different regional returns replace exposed radial dead ends. No saved map
 * is edited: the ordinary generator applies this to its fresh central scaffold. */
export function carveVortexKnots(l:FreeLayout,full:FreeLayout,maximumWidth:number,progress?:(message:string)=>void,rng:()=>number=()=>1){
 const e=Number(l.openings.find(o=>o.id===l.entrance)!.room.match(/^spiral(\d)-23$/)![1]),s=(a:number,j:number)=>`spiral${(a+e+3)%4}-${j}`,key=(a:string,b:string)=>[a,b].sort().join('|');
 const remove=new Set(['vortex-k1-long','vortex-k2-long19','vortex-sector-long19','vortex-sector-long21',s(3,15),s(3,2)]);
 l.modules=l.modules.filter(m=>!remove.has(m.id));l.connections=l.connections.filter(c=>!remove.has(c.a.room)&&!remove.has(c.b.room));
 const restore=(a:string,b:string)=>{if(l.connections.some(c=>key(c.a.room,c.b.room)===key(a,b)))return;const c=full.connections.find(c=>key(c.a.room,c.b.room)===key(a,b));if(c){l.connections.push(structuredClone(c));return;}const connected=connectFrames(l,a,b,'vortex-diagonal-return',maximumWidth);if(!connected)throw Error('Нет реального стыка узлов '+a+' / '+b);};
 l.modules.push(structuredClone(full.modules.find(m=>m.id===s(1,5))!));
 for(const [a,b]of [[s(1,4),s(1,5)],[s(1,5),s(1,6)],[s(0,10),s(1,5)],[s(0,21),s(1,14)],[s(3,19),s(0,13)],[s(3,18),s(0,12)],[s(3,4),s(0,1)],[s(2,19),s(3,13)],[s(3,12),s(3,13)],[s(2,21),s(3,14)]])restore(a!,b!);
 if(!mergeJunction(l,s(3,3),s(0,0),'vortex-reversal-room',maximumWidth,2))throw Error('Не помещается внутренняя разворотная комната.');
 const closed=new Set([[s(1,18),s(2,12)],[s(0,8),s(1,4)],[s(3,12),s(2,18)]].map(([a,b])=>key(a!,b!)));l.connections=l.connections.filter(c=>!closed.has(key(c.a.room,c.b.room)));
 const plans=[[s(1,22),s(2,15),'vortex-knot-entry'],[s(2,10),s(3,5),'vortex-knot-winding'],[s(2,19),s(3,13),'vortex-knot-braid'],[s(3,16),s(2,23),'vortex-knot-return'],[s(3,18),s(0,12),'vortex-knot-offset']];let knots=0;
 for(const [a,b,id]of plans){const merged=mergeJunction(l,a!,b!,id!,maximumWidth,3,rng()<.5?-1:1);progress?.(`${id}: ${merged?'построен реальный перекрёсток':'пара рам сохранена — перекрёсток не поместился'}`);if(merged){knots++;if(id==='vortex-knot-entry')l.connections=l.connections.filter(c=>key(c.a.room,c.b.room)!==key(s(1,21),s(2,14)));}}
 if(knots<3||!l.modules.some(m=>m.id==='vortex-knot-entry'))throw Error(`Поместилось только ${knots} распределённых узлов; входной перекрёсток обязателен.`);
 return new Set<string>();
}

/** Atomically replace a terminal with a two-door native return room. */
export function replaceVortexTerminal(l:FreeLayout,terminal:string,pose:FreeModule,second:Anchor,maximumWidth:number):boolean{
 const previous=l.connections;l.connections=[...previous,{id:pose.id+'-planned-return',a:{room:terminal,edge:0,offset:0},b:second,width:1.6}];
 const ok=mergeJunction(l,terminal,terminal,pose.id,maximumWidth,2,1,pose);if(!ok)l.connections=previous;return ok;
}
/** Insert a genuine framed side chamber with one physical attachment. */
export function insertVortexChamber(l:FreeLayout,pose:FreeModule,parent:Anchor,maximumWidth:number):boolean{
 const previousModules=l.modules,previousConnections=l.connections;l.modules=[...l.modules,pose];l.connections=[...l.connections,{id:pose.id+'-planned',a:{room:pose.id,edge:0,offset:0},b:parent,width:1.6}];
 const ok=mergeJunction(l,pose.id,pose.id,pose.id,maximumWidth,1,1,pose);if(!ok){l.modules=previousModules;l.connections=previousConnections;}return ok;
}
export function insertEarlyVortexJunction(l:FreeLayout,a:string,b:string,maximumWidth:number):boolean{return mergeJunction(l,a,b,'vortex-chaos-entry',maximumWidth,3);}
export function replaceVortexFrame(l:FreeLayout,id:string,pose:FreeModule,maxWidth:number):boolean{return mergeJunction(l,id,id,id,maxWidth,3,1,pose);}
/** Fit a genuine cross-link against the already assembled native geometry. */
export function connectVortexFrames(l:FreeLayout,a:string,b:string,id:string,maxWidth:number):boolean{return connectFrames(l,a,b,id,maxWidth);}
/** One native room closes a deeper pocket between two district branches. */
export function insertVortexReturnFrame(l:FreeLayout,aId:string,bId:string,id:string,maxWidth:number):boolean{
 const a=l.modules.find(m=>m.id===aId)!,b=l.modules.find(m=>m.id===bId)!,dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz),angle=Math.atan2(dz,dx)*180/Math.PI;
 const previousModules=l.modules,previousConnections=l.connections;
 for(const shift of [0,.3,-.3,.6,-.6])for(const turn of [0,15,-15,30,-30]){
  const pose:FreeModule={id,type:'2x2',x:(a.x+b.x)/2-shift*dz/d,z:(a.z+b.z)/2+shift*dx/d,angle:angle+turn};
  if(l.modules.some(m=>overlap(modulePolygon(pose),modulePolygon(m))))continue;
  for(const ea of [0,1,2,3])for(const eb of [0,1,2,3]){
   const aa={room:aId,edge:ea,offset:0},bb={room:bId,edge:eb,offset:0},ga=anchorGeometry(l,aa,1.2),gb=anchorGeometry(l,bb,1.2);if(ga.normal.x*(pose.x-ga.mid.x)+ga.normal.z*(pose.z-ga.mid.z)<=0||gb.normal.x*(pose.x-gb.mid.x)+gb.normal.z*(pose.z-gb.mid.z)<=0)continue;
   if(l.connections.some(c=>[c.a,c.b].some(p=>(p.room===aId&&p.edge===ea)||(p.room===bId&&p.edge===eb))))continue;
   l.modules=[...previousModules,pose];l.connections=[...previousConnections,{id:id+'-plan-a',a:{room:id,edge:0,offset:0},b:aa,width:1.2},{id:id+'-plan-b',a:{room:id,edge:2,offset:0},b:bb,width:1.2}];
   if(mergeJunction(l,id,id,id,maxWidth,2,1,pose))return true;l.modules=previousModules;l.connections=previousConnections;
  }
 }
 return false;
}
