import {anchorGeometry} from './layout';
import type {FreeLayout} from './model';
/** A structural motif in the existing spiral mesh: the entrance braid reaches
 * a four-door return junction, followed by a separate retreat/dead-end fork.
 * Only the remaining main-network crossovers may be carved afterwards. */
export function carveVortexTraps(layout:FreeLayout,width:number):Set<string>{
 const entrance=layout.openings.find(o=>o.id===layout.entrance),match=entrance?.room.match(/^spiral(\d+)-23$/);
 if(layout.modules.length!==96||!match)throw Error('Ловушки вортекса пока рассчитаны на 96 базовых рам; добавляется одна настоящая рама 2×6.');
 const arm=Number(match[1]),room=(a:number,j:number)=>`spiral${(arm+a+4)%4}-${j}`,key=(a:string,b:string)=>[a,b].sort().join('|'),selected=new Set<string>();
 const chain=(ids:string[])=>{for(let j=1;j<ids.length;j++)selected.add(key(ids[j-1]!,ids[j]!));};
 const fork=room(0,16),loop=[fork,room(0,15),room(0,14),room(0,13),room(-1,19),room(-1,20),room(-1,21),room(-1,22),room(-1,23),fork];
 const branches=[[room(0,14),room(1,9),room(1,8)],[room(-1,19),room(-1,18),room(-1,17)]];
 const entry=new Set([...Array.from({length:7},(_,j)=>room(0,17+j)),...Array.from({length:6},(_,j)=>room(1,11+j))]);
 const loopNodes=new Set([...loop.slice(1,-1),...branches.flat().filter(n=>n!==fork)]);
 const dead=[room(2,5),room(2,4),room(2,3),room(2,2)],retreat=[room(2,5),room(2,6),room(2,7),room(2,8)],bridge=[fork,room(1,10),room(2,5)];
 chain(loop);branches.forEach(chain);chain(dead);chain(retreat);chain(bridge);chain([fork,room(0,17)]);
 for(const edge of selected)if(!layout.connections.some(c=>key(c.a.room,c.b.room)===edge))throw Error('Вортекс: для структурной ловушки отсутствует физическое соединение '+edge);
 const reserved=new Set([...entry,...loopNodes,...dead,...retreat.slice(0,-1),...bridge]),main=new Set(layout.modules.map(m=>m.id).filter(id=>!reserved.has(id)));
 const mutable=new Set(layout.connections.filter(c=>main.has(c.a.room)&&main.has(c.b.room)).map(c=>c.id));
 layout.connections=layout.connections.filter(c=>selected.has(key(c.a.room,c.b.room))||entry.has(c.a.room)&&entry.has(c.b.room)||main.has(c.a.room)&&main.has(c.b.room));
 // A real six-metre room provides a meaningful additional decision on the
 // long outer part of the return circuit. No decorative support or tiny bud.
 const source={room:room(-1,21),edge:0,offset:0},g=anchorGeometry(layout,source,width),id='vortex-return-long-room';
 layout.modules.push({id,type:'2x6',x:g.mid.x+g.normal.x*6,z:g.mid.z+g.normal.z*6,angle:Math.atan2(g.normal.z,g.normal.x)*180/Math.PI});
 layout.connections.push({id:'vortex-return-long-span',a:source,b:{room:id,edge:3,offset:0},width,spanAudit:{desired:3,actual:3}});
 return mutable;
}
