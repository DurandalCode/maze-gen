import {anchorGeometry,connectionGeometry,modulePolygon} from './layout';
import {area,bounds,distance,ends,overlap,segment,segmentDistance} from './geometry';
import type {FreeConnection,FreeLayout,FreeModule} from './model';
import {insertEarlyVortexJunction,insertVortexChamber,replaceVortexTerminal,replaceVortexFrame} from './vortex-knots';

/** Topology remains the proven pair of route trees and return traps. Geometry
 * is fitted as one assembly, rather than rotating frames against stale gates. */
export function carveChaoticVortex(l:FreeLayout,full:FreeLayout,maxWidth:number,rng:()=>number,progress?:(s:string)=>void){
 const e=Number(l.openings.find(o=>o.id===l.entrance)!.room.match(/^spiral(\d)-23$/)![1]),s=(a:number,j:number)=>`spiral${(a+e+3)%4}-${j}`,by=()=>new Map(l.modules.map(m=>[m.id,m])),key=(a:string,b:string)=>[a,b].sort().join('|');
 const center={x:30,z:30};
 for(const [id,a,b]of [['vortex-k1-long',s(0,21),s(0,20)],['vortex-k2-long19',s(3,19),s(3,18)],['vortex-sector-long19',s(2,19),s(2,18)],['vortex-sector-long21',s(2,21),s(2,22)]]){
  const x=by().get(a!)!,y=by().get(b!)!,dx=y.x-x.x,dz=y.z-x.z,len=Math.hypot(dx,dz),mid={x:(x.x+y.x)/2,z:(x.z+y.z)/2},rad=Math.hypot(mid.x-center.x,mid.z-center.z);let success=false;
  for(const offset of [3.4,3.1,3.7,2.8,4]){const pose:FreeModule={id:id!+'-return',type:'2x6',x:mid.x+(mid.x-center.x)/rad*offset,z:mid.z+(mid.z-center.z)/rad*offset,angle:Math.atan2(dz/len,dx/len)*180/Math.PI};if(replaceVortexTerminal(l,id!,pose,{room:b!,edge:0,offset:0},maxWidth)){success=true;break;}}
  if(!success)throw Error('Не поместилась касательная возвратная комната '+id);
 }
 const remove=new Set([s(2,7),s(2,6)]);l.connections=l.connections.filter(c=>!remove.has(c.a.room)&&!remove.has(c.b.room));l.modules=l.modules.filter(m=>m.id!==s(2,6));
 const branch=full.connections.find(c=>key(c.a.room,c.b.room)===key(s(3,3),s(2,7)));if(!branch)throw Error('Нет физической ветви ложного выбора.');l.connections.push(structuredClone(branch));
 if(!insertVortexChamber(l,{id:'vortex-false-side',type:'2x2',x:32.55,z:32.63,angle:0},{room:s(0,1),edge:2,offset:0},maxWidth))throw Error('Не поместилась разветвлённая ложная камера.');
 if(!insertEarlyVortexJunction(l,s(1,22),s(2,15),maxWidth))throw Error('Не поместился ранний перекрёсток.');l.connections=l.connections.filter(c=>key(c.a.room,c.b.room)!==key(s(1,21),s(2,14)));
 const fork=by().get(s(1,16))!;if(!replaceVortexFrame(l,fork.id,{...fork,type:'2x6',angle:fork.angle},maxWidth))throw Error('Не помещается реальный зал выбора возвратного кольца.');
 const turn=l.connections.find(c=>key(c.a.room,c.b.room)===key(s(1,16),s(2,10)))!;turn.id='vortex-chaos-correct-turn';turn.width=1.2;
 progress?.('Возвратные комнаты и разветвлённые ложные выборы построены.');
 const base=structuredClone(l),protectedIds=new Set([s(3,5),s(0,3),s(1,16),s(3,16),s(0,22),...l.openings.map(o=>o.room)]);
 const roots=new Set(protectedIds);for(const c of l.connections)if(roots.has(c.a.room)||roots.has(c.b.room)){protectedIds.add(c.a.room);protectedIds.add(c.b.room);}
 const phase=rng()*Math.PI*2,changes=new Map(base.modules.map(m=>{const r=Math.hypot(m.x-30,m.z-30),theta=Math.atan2(m.z-30,m.x-30),f=m.type==='2x2'&&r>8&&!protectedIds.has(m.id)?1:0;return[m.id,{pos:protectedIds.has(m.id)||m.type==='2x6'?0:1,turn:f*(32*Math.tanh(3*Math.sin(2*theta+phase))+(rng()-.5)*4),dx:f*(rng()-.5)*.25,dz:f*(rng()-.5)*.25}];}));
 changes.get(s(2,10))!.turn=-20;
 let last:string[]=[];
 for(let pass=0;pass<16;pass++){
  const trial=structuredClone(base);for(const m of trial.modules){const d=changes.get(m.id)!,r=Math.hypot(m.x-30,m.z-30),scale=1-d.pos*.06*Math.max(0,Math.min(1,(r-8)/8));m.x=30+(m.x-30)*scale+d.dx;m.z=30+(m.z-30)*scale+d.dz;m.angle+=d.turn;}
  const fitted=fitConnections(trial,maxWidth);if(fitted.length===0){if([...changes.values()].filter(d=>Math.abs(d.turn)>=20).length<25)throw Error('Индивидуальный разброс не достигнут: слишком много рам вернулись к исходной ориентации.');l.modules=trial.modules;l.connections=trial.connections;progress?.(`Индивидуальные рамы: ${[...changes.values()].filter(d=>Math.abs(d.turn)>=20).length}/${l.modules.length} отклонены минимум на 20°. `);return;}
  progress?.(`Стыковка индивидуальных рам: шаг ${pass+1}, отказов ${fitted.length}.`);last=fitted;for(const id of new Set(fitted.flatMap(id=>{const c=base.connections.find(c=>c.id===id);return c?[c.a.room,c.b.room]:[id];}))){const d=changes.get(id);if(d){d.turn*=.85;d.dx*=.5;d.dz*=.5;if(pass>=2)d.pos*=.5;}}
 }
 throw Error('Не состыкованы индивидуальные рамы: '+last.join(', '));
}
function fitConnections(l:FreeLayout,maxWidth:number):string[]{
 const shapes=l.modules.map(modulePolygon),failed:string[]=[],accepted:FreeConnection[]=[],posts=shapes.flat();
 for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++)if(overlap(shapes[i]!,shapes[j]!))return[l.modules[i]!.id,l.modules[j]!.id];
 const originals=l.connections;l.connections=[];const acceptedShapes:ReturnType<typeof modulePolygon>[]=[];
 const intersects=(a:ReturnType<typeof modulePolygon>,b:ReturnType<typeof modulePolygon>)=>{const x=bounds(a),y=bounds(b);return x.x1<y.x2&&x.x2>y.x1&&x.z1<y.z2&&x.z2>y.z1&&overlap(a,b);};
 for(const old of originals){let chosen:FreeConnection|undefined;const candidates:{c:FreeConnection;score:number}[]=[];
  for(const oa of [...new Set([old.a.offset,0,-.15,.15,-.3,.3,-.4,.4])])for(const ob of [...new Set([old.b.offset,0,-.15,.15,-.3,.3,-.4,.4])])for(const width of (old.id==='vortex-chaos-correct-turn'?[1.2]:[old.width,1.4,1.2]).filter(w=>w<=maxWidth))try{
   const c={...old,a:{...old.a,offset:oa},b:{...old.b,offset:ob},width},g=connectionGeometry(l,c),span=Math.max(...g.sides.map(w=>distance(...ends(w))));if(span>3+1e-7||area(g.polygon)<.01)continue;
   if(accepted.some(q=>[q.a,q.b].some(p=>(p.room===c.a.room&&p.edge===c.a.edge&&Math.abs(p.offset-oa)<(q.width+width)/2+.08)||(p.room===c.b.room&&p.edge===c.b.edge&&Math.abs(p.offset-ob)<(q.width+width)/2+.08))))continue;
   if(shapes.some(p=>intersects(g.polygon,p))||acceptedShapes.some(p=>intersects(g.polygon,p)))continue;
   if(Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1)continue;
   const pa={x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35},pb={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35};if([...posts,g.a.from,g.a.to,g.b.from,g.b.to].some(p=>[segment(pa,g.a.mid),segment(g.a.mid,g.b.mid),segment(g.b.mid,pb)].some(w=>segmentDistance(p,w)<.25+Math.SQRT2*.06+1e-5)))continue;
   const v={x:g.b.mid.x-g.a.mid.x,z:g.b.mid.z-g.a.mid.z};if(v.x*g.a.normal.x+v.z*g.a.normal.z<=0||-v.x*g.b.normal.x-v.z*g.b.normal.z<=0)continue;
   candidates.push({c:{...c,spanAudit:{desired:3,actual:span,reason:'Индивидуальная рама в локальной спиральной группе.'}},score:Math.round((width*10-Math.abs(oa-old.a.offset)-Math.abs(ob-old.b.offset))*1e7)});
  }catch{/* A door must fit its actual frame. */}
  candidates.sort((a,b)=>b.score-a.score);chosen=candidates[0]?.c;if(chosen){accepted.push(chosen);l.connections.push(chosen);acceptedShapes.push(connectionGeometry(l,chosen).polygon);}else failed.push(old.id);
 }
 // Actual exterior portal support planes remain physical, not just graph ends.
 for(const o of l.openings){const g=anchorGeometry(l,o,o.width);if(shapes.some(p=>p.some(p=>(p.x-g.mid.x)*g.normal.x+(p.z-g.mid.z)*g.normal.z>1e-7)))failed.push(o.room);}
 return failed;
}
