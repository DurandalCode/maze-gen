import {random,shuffle} from '../core/random';
import {domainOf} from '../core/domain';
import type {Maze} from '../core/maze';
import type {GuardConstraints} from './guarded';
import {contourKey,contourStructure,contourQuality} from './contours';
import {connectionRouteGain} from '../analysis/route-alternatives';
import {loopTraps} from '../analysis/loop-traps';
/** Maximum-preference Kruskal: whole contour arcs first, sparse radial gates second. */
export function livingBase(base:Maze,seed=base.parameters.seed,guard?:GuardConstraints):Maze{
 const s=contourStructure(base),pairs=[...(guard?.allowed??s.pairs)],rng=random(seed+'|living-v1'),parent=Int32Array.from({length:base.passages.length},(_,i)=>i),passages=base.passages.map(()=>[] as number[]);
 const root=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]!]!;n=parent[n]!;}return n;};
 const add=(a:number,b:number,cycle=false)=>{const x=root(a),y=root(b);if(passages[a]!.includes(b)||!cycle&&x===y)return false;parent[y]=x;passages[a]!.push(b);passages[b]!.push(a);return true;};
 // Split closed contours into long arcs so the route can move inward rather
 // than leaving every inner contour attached as a single dangling branch.
 const adjacent=passages.map(()=>[] as number[]);
 for(const [a,b] of pairs)if(s.preferred.has(contourKey(a,b))){adjacent[a]!.push(b);adjacent[b]!.push(a);}
 const seen=new Set<number>(),cuts=new Set<string>();
 for(const start of domainOf(base).cells){
  if(seen.has(start))continue;
  const component=[start];seen.add(start);
  for(let i=0;i<component.length;i++)for(const n of adjacent[component[i]!]!)if(!seen.has(n)){seen.add(n);component.push(n);}
  if(component.length<8||component.some(c=>adjacent[c]!.length!==2))continue;
  const ring=[start];let previous=-1,at=start;
  do{const next=adjacent[at]!.find(n=>n!==previous)!;previous=at;at=next;if(at!==start)ring.push(at);}while(at!==start);
  const offset=Math.floor(rng()*ring.length),separation=Math.floor(ring.length*(.35+.3*rng()));
  for(const i of [offset,(offset+separation)%ring.length]){const key=contourKey(ring[i]!,ring[(i+1)%ring.length]!);if(!guard?.locked.has(key))cuts.add(key);}
 }
 for(const [a,b] of guard?.mandatory??[])add(a,b);
 shuffle(pairs,rng);pairs.sort(([a,b],[c,d])=>Number(s.preferred.has(contourKey(c,d)))-Number(s.preferred.has(contourKey(a,b))));
 for(const [a,b] of pairs)if(!cuts.has(contourKey(a,b)))add(a,b);
 // Narrow/concave regions may require a reserved cut to reconnect.
 for(const [a,b] of pairs)add(a,b);
 const cells=domainOf(base).cells;if(cells.some(c=>root(c)!==root(cells[0]!)))throw new Error('Контурные переходы не соединяют всю область.');
 const maze={...base,passages};
 const available=pairs.filter(([a,b])=>!passages[a]!.includes(b));
 if(base.parameters.extraConnections>available.length)throw new Error('В этой форме недостаточно стен для заданного числа дополнительных соединений.');
 const large=passages.length>1200||base.parameters.extraConnections>128;
 if(large)for(const [a,b] of available.slice(0,base.parameters.extraConnections))add(a,b,true);
 for(let i=0;!large&&i<base.parameters.extraConnections;i++){
  const closed=pairs.filter(([a,b])=>!passages[a]!.includes(b));
  if(!closed.length)throw new Error('В этой форме недостаточно стен для заданного числа дополнительных соединений.');
  // Closing long arcs is preferred; among eligible choices, reward actual route alternatives.
  const preferred=closed.filter(([a,b])=>s.preferred.has(contourKey(a,b)));
  const pool=(preferred.length?preferred:closed);
  const snapshot={...maze,passages:[...passages]};
  const candidates=pool.slice(0,32).map(([a,b])=>{
   let loopCount=0,loopScore=0;
   if((base.parameters.loopTrapCount??0)>0){
    const proposed=[...passages];proposed[a]=[...proposed[a]!,b];proposed[b]=[...proposed[b]!,a];
    const loops=loopTraps({...base,passages:proposed});loopCount=loops.qualifiedCount;loopScore=loops.candidates[0]?.score??0;
   }
   return {a,b,loopCount,loopScore,preferred:Number(s.preferred.has(contourKey(a,b))),gain:(passages.length>1200||base.parameters.extraConnections>128?0:connectionRouteGain(snapshot,a,b))};
  });
  candidates.sort((a,b)=>b.loopCount-a.loopCount||b.loopScore-a.loopScore||b.preferred-a.preferred||b.gain-a.gain);
  const edge=candidates[0]!;add(edge.a,edge.b,true);
 }
 for(const ns of passages)ns.sort((a,b)=>a-b);
 if(!contourQuality(maze,base.parameters.extraConnections).certified)throw new Error('Переходы или экранирование проёмов разрушают контуры: нужно сохранить минимум 80% контурных связей и межслойных стен.');
 return maze;
}
