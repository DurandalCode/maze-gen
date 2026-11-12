import{DEFAULT_CONSTRUCTION,type Parameters}from'../core/maze';import{shortestPath}from'../core/pathfinding';import{freeMaze,freeRuntime}from'./layout';import type{FreeLayout}from'./model';
/** Deliberately continuous winding passages. False return paths and the real
 * route share the same frame geometry and lack intermediate route choices. */
export function carveContinuousVortex(l:FreeLayout,p:Parameters){
 const m=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:p,construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:l},false),r=freeRuntime(m),path=shortestPath(m).map(i=>r.rooms[i]!.id),e=Number(l.openings.find(o=>o.id===l.entrance)!.room.match(/^spiral(\d)-23$/)![1]),s=(a:number,j:number)=>`spiral${(a+e+3)%4}-${j}`,key=(a:string,b:string)=>[a,b].sort().join('|'),allowed=new Set<string>(),keep=new Set<string>();
 const chain=(ids:string[])=>{ids.forEach(id=>keep.add(id));for(let i=1;i<ids.length;i++)allowed.add(key(ids[i-1]!,ids[i]!));};
 chain(path);
 chain([s(1,16),s(1,15),s(1,14),s(1,13),s(0,19),s(0,20),s(0,21),s(0,22),s(0,23),s(1,16)]);
 chain([s(3,16),s(3,17),s(3,18),s(3,19),s(3,20),s(3,21),s(0,14),s(0,13),s(0,12),s(0,11),s(0,10),s(3,16)]);
 chain([s(3,5),s(3,4),s(3,3),s(3,2)]);chain([s(3,3),s(2,7)]);
 chain([s(0,3),s(0,2),s(0,1),s(0,0)]);chain([s(0,1),'vortex-false-side']);
 chain(['vortex-chaos-entry',s(2,14),s(2,13),s(2,12),s(2,11)]);
 chain(['vortex-central-junction',s(1,0),s(1,1)]);
 for(const edge of allowed)if(!l.connections.some(c=>key(c.a.room,c.b.room)===edge))throw Error('Не найден конструктивный участок непрерывного вортекса '+edge);
 l.modules=l.modules.filter(m=>keep.has(m.id));l.connections=l.connections.filter(c=>allowed.has(key(c.a.room,c.b.room)));
}
