import type {Parameters} from '../core/maze';
import {footprintContains,mm,type CorridorSpace} from '../core/corridor-geometry';
import {shuffle} from '../core/random';
type Tile={x:number;z:number};
const key=(p:Tile)=>`${p.x}:${p.z}`;
/** Route each real connection through whole 2 m tiles. Clearances protect other
 * connections and junctions; no wall is inserted into a physical long module. */
export function offsetCorridors(p:Parameters,nodes:CorridorSpace[],edges:{a:number;b:number;space:CorridorSpace}[],halls:CorridorSpace[],rng:()=>number){
 const nodeKeys=new Set(nodes.map(key)),guard=new Map<string,Set<number>>(),occupied=new Set<string>();
 const paths=edges.map(e=>{const a=nodes[e.a]!,b=nodes[e.b]!,vertical=a.x===b.x,length=(vertical?b.z-a.z:b.x-a.x)/2;return Array.from({length:length+1},(_,i)=>({x:a.x+(vertical?0:i*2),z:a.z+(vertical?i*2:0)}));});
 for(let i=0;i<paths.length;i++)for(const tile of paths[i]!.slice(1,-1)){if(!guard.has(key(tile)))guard.set(key(tile),new Set());guard.get(key(tile))!.add(i);}
 const touchesHall=(r:CorridorSpace)=>halls.some(h=>r.height===2?(r.z+2===h.z||r.z===h.z+h.height)&&Math.min(r.x+r.width,h.x+h.width)>Math.max(r.x,h.x):(r.x+2===h.x||r.x===h.x+h.width)&&Math.min(r.z+r.height,h.z+h.height)>Math.max(r.z,h.z));
 const protectedEdges=new Set(edges.map((e,i)=>touchesHall(e.space)?i:-1).filter(i=>i>=0));
 const order=edges.map((_,i)=>i).sort((a,b)=>Number(protectedEdges.has(b))-Number(protectedEdges.has(a))||paths[b]!.length-paths[a]!.length||a-b);
 let offsets=0;
 for(const index of order){const original=paths[index]!,a=original[0]!,b=original.at(-1)!,vertical=a.x===b.x,d=original.length-1,candidates:Tile[][]=[];
  const valid=(path:Tile[])=>{const locations=new Map(path.map((t,i)=>[key(t),i]));if(locations.size!==path.length)return false;
   for(let i=1;i<path.length-1;i++){const t=path[i]!,k=key(t);if(nodeKeys.has(k)||occupied.has(k)||[...guard.get(k)??[]].some(e=>e!==index))return false;
    for(const dx of [.1,1.9])for(const dz of [.1,1.9])if(!footprintContains(p,mm(t.x+dx),mm(t.z+dz)))return false;
    if(halls.some(h=>t.x<h.x+h.width&&t.x+2>h.x&&t.z<h.z+h.height&&t.z+2>h.z))return false;
    for(const [dx,dz]of [[-2,0],[2,0],[0,-2],[0,2]]){const n=key({x:t.x+dx!,z:t.z+dz!}),own=locations.get(n);if(own!==undefined&&Math.abs(own-i)>1)return false;if(nodeKeys.has(n)&&!((n===key(a)&&i===1)||(n===key(b)&&i===path.length-2)))return false;if(occupied.has(n)||[...guard.get(n)??[]].some(e=>e!==index))return false;}
   }return true;};
  if(!protectedEdges.has(index)){
   const options=d>=6?[[2,d-2,2],[2,d-2,-2],[2,d-2,1],[2,d-2,-1]]:d>=4?[[1,d-1,1],[1,d-1,-1],...(d===5?[[2,d-1,1],[2,d-1,-1]]:[])]:[];shuffle(options,rng);options.sort((a,b)=>Math.abs(b[2]!)-Math.abs(a[2]!));
   for(const [start,end,side]of options){const tile=(along:number,normal:number):Tile=>({x:a.x+(vertical?normal:along)*2,z:a.z+(vertical?along:normal)*2}),path=[a];for(let v=1;v<=start!;v++)path.push(tile(v,0));for(let n=1;n<=Math.abs(side!);n++)path.push(tile(start!,Math.sign(side!)*n));for(let v=start!+1;v<=end!;v++)path.push(tile(v,side!));for(let n=Math.abs(side!)-1;n>=0;n--)path.push(tile(end!,Math.sign(side!)*n));for(let v=end!+1;v<=d;v++)path.push(tile(v,0));candidates.push(path);}
  }
  const shifted=candidates.find(valid),selected=shifted??original;if(!valid(selected))throw Error('Смещение пересекло соседний коридор.');if(shifted)offsets++;paths[index]=selected;for(const tile of selected.slice(1,-1))occupied.add(key(tile));
 }
 const corridors:CorridorSpace[]=[...nodes,...paths.flatMap(path=>path.slice(1,-1).map(t=>({kind:'corridor' as const,...t,width:2,height:2})))];
 return {paths,corridors,offsets};
}
