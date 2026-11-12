import {anchorGeometry,connectionGeometry,modulePolygon} from './layout';
import {area,distance,ends,overlap,segment,segmentDistance} from './geometry';
import type {FreeConnection,FreeLayout} from './model';
/** Connected regional braids, two pendant return circuits and two genuine
 * directional retreats. The centre is a real three-door six-metre frame.
 * This is a separate persisted pattern; 01/02 keep their original topology. */
export function carveCentralVortex(l:FreeLayout,width:number,maximumWidth:number):Set<string>{
 const entrance=l.openings.find(o=>o.id===l.entrance),e=Number(entrance?.room.match(/^spiral(\d)-23$/)?.[1]);
 if(l.modules.length!==96||!Number.isInteger(e))throw Error('Центральный вортекс требует 96 исходных рам.');
 const s=(a:number,j:number)=>`spiral${(a+e+3)%4}-${j}`,range=(a:number,lo:number,hi:number)=>Array.from({length:hi-lo+1},(_,i)=>s(a,lo+i));
 const key=(a:string,b:string)=>[a,b].sort().join('|'),forced=new Set<string>(),chain=(ids:string[])=>{for(let i=1;i<ids.length;i++)forced.add(key(ids[i-1]!,ids[i]!));};
 const entry=new Set([...range(1,17,23),...range(2,11,15)]);
 const outerBraid=new Set([...range(0,4,7),...range(3,8,12),...range(2,16,23)]);
 const approach=new Set([...range(3,13,15),...range(0,8,9),...range(1,0,2),s(1,4),...range(2,0,1)]);
 const finishBraid=new Set([...range(3,0,1),...range(2,2,7),...range(1,8,12),s(0,16),s(3,23)]);
 chain([s(1,16),s(1,15),s(1,14),s(1,13),s(0,19),s(0,20),s(0,21),s(0,22),s(0,23),s(1,16)]);
 chain([s(1,14),s(2,9),s(2,8)]);chain([s(0,19),s(0,18),s(0,17)]);
 chain([s(1,17),s(1,16),s(2,10),s(3,5),s(3,6),s(3,7),s(0,3),s(0,4)]);
 chain([s(3,5),s(3,4),s(3,3),s(3,2)]);chain([s(0,3),s(0,2),s(0,1),s(0,0)]);
 chain([s(3,16),...range(3,17,21),s(0,14),...range(0,10,13).reverse(),s(3,16)]);
 chain([s(0,12),s(1,7),s(1,6)]);chain([s(3,21),s(3,22)]);chain([s(2,23),s(3,16),s(3,15)]);
 for(const edge of forced)if(!l.connections.some(c=>key(c.a.room,c.b.room)===edge))throw Error('Для центрального вортекса отсутствует физическое соединение '+edge);
 const groups=[entry,outerBraid,approach,finishBraid],kept=new Set([...forced].flatMap(k=>k.split('|')).concat(groups.flatMap(g=>[...g])));
 const mutable=new Set(l.connections.filter(c=>groups.some(g=>g.has(c.a.room)&&g.has(c.b.room))).map(c=>c.id));
 l.modules=l.modules.filter(m=>kept.has(m.id));l.connections=l.connections.filter(c=>forced.has(key(c.a.room,c.b.room))||groups.some(g=>g.has(c.a.room)&&g.has(c.b.room)));
 // The centre has a long false arm and two distinct spiral approaches. A
 // six-metre terminal is a real room, not a shallow square alcove.
 l.connections=l.connections.filter(c=>key(c.a.room,c.b.room)!==key(s(1,1),s(1,2)));l.modules.find(m=>m.id===s(1,2))!.type='2x6';const returnTerminal=l.modules.find(m=>m.id===s(3,22))!;returnTerminal.type='2x6';returnTerminal.angle=l.modules.find(m=>m.id===s(3,23))!.angle;
 const longBranch=(room:string,id:string)=>{const a={room,edge:0,offset:0},g=anchorGeometry(l,a,width);l.modules.push({id,type:'2x6',x:g.mid.x+g.normal.x*6,z:g.mid.z+g.normal.z*6,angle:Math.atan2(g.normal.z,g.normal.x)*180/Math.PI});l.connections.push({id:id+'-span',a,b:{room:id,edge:3,offset:0},width,spanAudit:{desired:3,actual:3}});};
 longBranch(s(0,21),'vortex-k1-long');longBranch(s(3,19),'vortex-k2-long19');longBranch(s(2,19),'vortex-sector-long19');longBranch(s(2,21),'vortex-sector-long21');
 const starts=[0,1,2,3].map(a=>l.modules.find(m=>m.id===s(a,0))!),cx=starts.reduce((sum,m)=>sum+m.x,0)/4,cz=starts.reduce((sum,m)=>sum+m.z,0)/4;
 const angle=l.modules.find(m=>m.id===s(1,0))!.angle-Math.atan2(5,16/(2*Math.PI))*180/Math.PI;
 const hub={id:'vortex-central-junction',type:'2x6' as const,x:cx+.7*Math.cos((angle+90)*Math.PI/180),z:cz+.7*Math.sin((angle+90)*Math.PI/180),angle};
 if(l.modules.some(m=>overlap(modulePolygon(hub),modulePolygon(m))))throw Error('Центральная рама пересекает спирали.');l.modules.push(hub);
 for(const arm of [1,2,3]){
  const room=s(arm,0),candidates:{c:FreeConnection;span:number}[]=[];
  for(const edge of [0,1,2,3])for(const offset of [0,-.1,.1,-.2,.2,-.5,.5,-1,1,-1.5,1.5,-2,2])for(const toEdge of [2,3])for(const toOffset of [0,-.1,.1,-.18,.18])for(const doorway of [...new Set([width,1.8,2].filter(w=>w<=maximumWidth))])try{
   const c={id:'vortex-hub-'+arm,a:{room:hub.id,edge,offset},b:{room,edge:toEdge,offset:toOffset},width:doorway},g=connectionGeometry(l,c),span=Math.max(...g.sides.map(w=>distance(...ends(w))));
   if(span>3+1e-7||area(g.polygon)<.1||l.modules.some(m=>overlap(g.polygon,modulePolygon(m)))||l.connections.some(q=>overlap(g.polygon,connectionGeometry(l,q).polygon)))continue;
   const v={x:g.b.mid.x-g.a.mid.x,z:g.b.mid.z-g.a.mid.z};if(v.x*g.a.normal.x+v.z*g.a.normal.z<=0||-v.x*g.b.normal.x-v.z*g.b.normal.z<=0)continue;
   if(Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1)continue;
   const pa={x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35},pb={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35},posts=[...l.modules.filter(m=>m.id===c.a.room||m.id===c.b.room).flatMap(modulePolygon),g.a.from,g.a.to,g.b.from,g.b.to];
   if(posts.some(p=>[segment(pa,g.a.mid),segment(g.a.mid,g.b.mid),segment(g.b.mid,pb)].some(w=>segmentDistance(p,w)<.25+Math.SQRT2*.06+1e-5)))continue;
   candidates.push({c,span});
  }catch{/* An anchor outside its real frame is not a usable doorway. */}
  candidates.sort((a,b)=>Math.round(b.span*1e9)-Math.round(a.span*1e9)||b.c.width-a.c.width);const best=candidates[0];if(!best)throw Error('Не помещается центральный проход к '+room);l.connections.push({...best.c,spanAudit:{desired:3,actual:best.span,reason:'Соединение центральной шестиметровой рамы с существующей спиралью.'}});
 }
 for(const c of l.connections)if([s(1,2),s(3,22)].includes(c.a.room)||[s(1,2),s(3,22)].includes(c.b.room)){const g=connectionGeometry(l,c);c.spanAudit={desired:3,actual:Math.max(...g.sides.map(w=>distance(...ends(w)))),reason:'Реальная шестиметровая концевая рама; проём и пролёт пересчитаны по её граням.'};}
 return mutable;
}
