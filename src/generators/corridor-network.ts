import {bridgeGuard,branchComponent,guardedConnection,routeBranchGuards,type BranchGuard} from './corridor-trap-guards';
import {optionalDistricts,districtAttachment} from '../core/optional-districts';
import {offsetCorridors} from './corridor-offsets';
import type {Parameters} from '../core/maze';
import {footprintContains,mm,type CorridorLayout,type CorridorSpace,type PlacedModule} from '../core/corridor-geometry';
import {shuffle} from '../core/random';
/** Build a sparse embedded network before placing any physical module. Empty
 * land between its branches stays inaccessible, rather than receiving doors. */
export function planCorridorNetwork(p:Parameters,rng:()=>number):(CorridorLayout&{hallDoorCounts?:number[];exitTarget?:{x:number;z:number}})|null{
 // Tiny/narrow sites retain the compact adapter; they have no room for islands.
 if(p.columns<18||p.rows<18||p.columns%2||p.rows%2||p.corridorWidth<2)return null;
 const axis=(size:number)=>{const values=[0];while(size-2-values.at(-1)!>12){const step=values.length%2?8:12;if(size-2-values.at(-1)!-step<8)break;values.push(values.at(-1)!+step);}values.push(size-2);return values;},xs=axis(p.columns),zs=axis(p.rows);
 const fits=(r:CorridorSpace)=>{for(let x=mm(r.x)+50;x<mm(r.x+r.width);x+=100)for(let z=mm(r.z)+50;z<mm(r.z+r.height);z+=100)if(!footprintContains(p,x,z))return false;return true;};
 const nodes=zs.flatMap(z=>xs.map(x=>({kind:'corridor' as const,x,z,width:2,height:2}))).filter(fits),edges:{a:number;b:number;space:CorridorSpace}[]=[];
 for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++){
  const x=nodes[a]!,y=nodes[b]!;let space:CorridorSpace|null=null;
  if(x.z===y.z&&xs.indexOf(y.x)===xs.indexOf(x.x)+1)space={kind:'corridor',x:x.x+2,z:x.z,width:y.x-x.x-2,height:2};
  if(x.x===y.x&&zs.indexOf(y.z)===zs.indexOf(x.z)+1)space={kind:'corridor',x:x.x,z:x.z+2,width:2,height:y.z-x.z-2};
  if(space&&fits(space))edges.push({a,b,space});
 }
 if(nodes.length<2)return null;shuffle(edges,rng);
 const parent=nodes.map((_,i)=>i),root=(v:number):number=>{while(parent[v]!==v){parent[v]=parent[parent[v]!]!;v=parent[v]!;}return v;},used=new Set<number>();
 for(let i=0;i<edges.length;i++){const e=edges[i]!,a=root(e.a),b=root(e.b);if(a!==b){parent[a]=b;used.add(i);}}
 if(nodes.some((_,i)=>root(i)!==root(0)))return null;
 const preferDistributed=rng()<.5;
 const baseLoops=p.extraConnections>=4?p.extraConnections-2:p.extraConnections;
 const closed=edges.map((_,i)=>i).filter(i=>!used.has(i));if(closed.length<baseLoops)return null;
 const treePath=(a:number,b:number)=>{const parent=new Map<number,number>([[a,-1]]),queue=[a];for(let j=0;j<queue.length&&!parent.has(b);j++)for(const i of used){const e=edges[i]!,n=e.a===queue[j]?e.b:e.b===queue[j]?e.a:-1;if(n>=0&&!parent.has(n)){parent.set(n,queue[j]!);queue.push(n);}}const path=[b];while(path.at(-1)!==a)path.push(parent.get(path.at(-1)!)!);return path;};
 let exits=nodes.map((n,i)=>({n,i})).filter(({n})=>n.x===p.columns-2),exit=(p.loopTrapCount??0)>0?exits.sort((a,b)=>Math.abs(a.n.z+1-p.rows*.45)-Math.abs(b.n.z+1-p.rows*.45))[0]?.i:exits.at(-1)?.i,route=new Set(treePath(0,exit??nodes.length-1));
 const treeLinks=nodes.map(()=>[] as number[]);for(const i of used){const e=edges[i]!;treeLinks[e.a]!.push(e.b);treeLinks[e.b]!.push(e.a);}
 if((p.loopTrapCount??0)>0){
  let best=-Infinity;
  for(const target of exits){const path=treePath(0,target.i).reverse(),set=new Set(path),reserved=routeBranchGuards(nodes,treeLinks,path,p.routeTrapCount??0);if(reserved.length<(p.routeTrapCount??0))continue;
   for(const i of closed){const e=edges[i]!;if(!guardedConnection(e,reserved))continue;const cycle=treePath(e.a,e.b),gates=cycle.filter(c=>set.has(c));if(gates.length!==1)continue;const fork=gates[0]!,at=path.indexOf(fork);if(at<=0||at>=path.length-1)continue;const k=cycle.indexOf(fork),neighbors=k===0?[cycle[1]!,cycle.at(-1)!]:k===cycle.length-1?[cycle[k-1]!,cycle[0]!]:[cycle[k-1]!,cycle[k+1]!],a=nodes[fork]!,alignment=(c:number)=>{const b=nodes[c]!,dx=b.x-a.x,dz=b.z-a.z,gx=p.columns-1-a.x,gz=target.n.z-a.z;return (dx*gx+dz*gz)/(Math.hypot(dx,dz)*Math.hypot(gx,gz)||1);},correct=alignment(path[at+1]!),wrong=Math.min(...neighbors.map(alignment));if(correct>-.15||wrong<.1)continue;
    const score=wrong-correct;if(score>best+1e-9){best=score;exit=target.i;}
   }
  }
  route=new Set(treePath(0,exit??nodes.length-1));
 }
 const routePath=treePath(0,exit??nodes.length-1).reverse();
 const guards:BranchGuard[]=routeBranchGuards(nodes,treeLinks,routePath,p.routeTrapCount??0);
 if(guards.length<(p.routeTrapCount??0))throw Error('В этой сети нет подходящих развилок с отходом от выхода.');
 for(const guard of [...guards]){const at=routePath.indexOf(guard.fork);guards.push(bridgeGuard(treeLinks,guard.fork,routePath[at+1]!));}
 // Reserve promising blind branches before cycles are opened. Ordinary links
 // must not turn a requested dead-end trap into a shortcut or a pendant ring
 // into a second route to the finish.
 // Spend ordinary extra connections on useful links, rather than letting
 // most of the area hang off one small section of the entrance-exit route.
 const topologyScore=()=>{
  const links=nodes.map(()=>[] as number[]),weights=nodes.map(()=>4);for(const i of used){const e=edges[i]!,area=e.space.width*e.space.height;links[e.a]!.push(e.b);links[e.b]!.push(e.a);weights[e.a]!+=area/2;weights[e.b]!+=area/2;}
  const distance=nodes.map(()=>Infinity),parent=nodes.map(()=>-1),done=new Set<number>();distance[0]=0;const target=exit??nodes.length-1;
  for(let k=0;k<nodes.length;k++){let at=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(at<0||distance[i]!<distance[at]!))at=i;if(at<0||!Number.isFinite(distance[at]!))break;if(at===target)break;done.add(at);for(const n of links[at]!){const a=nodes[at]!,b=nodes[n]!,next=distance[at]!+Math.hypot(a.x-b.x,a.z-b.z);if(next<distance[n]!){distance[n]=next;parent[n]=at;}}}
  const path=[target];while(path.at(-1)!==0){const next=parent[path.at(-1)!]!;if(next<0)return Infinity;path.push(next);}path.reverse();const total=weights.reduce((a,b)=>a+b,0),cutoff=Math.max(36,total*.08);let penalty=0;
  for(const region of optionalDistricts(links,nodes.map((_,i)=>i),path)){const rs=region.cells.map(c=>nodes[c]!),area=region.cells.reduce((s,c)=>s+weights[c]!,0),attachment=districtAttachment({x1:Math.min(...rs.map(r=>r.x)),x2:Math.max(...rs.map(r=>r.x+2)),z1:Math.min(...rs.map(r=>r.z)),z2:Math.max(...rs.map(r=>r.z+2))},region.gates.map(c=>({x:nodes[c]!.x+1,z:nodes[c]!.z+1,routeDistance:distance[c]!})));if(attachment.localized&&area>=cutoff)penalty+=area/total+2*(area/total)**2;}
  return penalty;
 };
 // Rank return circuits by the same local directional competition they need
 // to survive in the final model; a remote cycle alone is not a route trap.
 const ringScore=(i:number)=>{const e=edges[i]!,path=treePath(e.a,e.b),k=path.findIndex(c=>route.has(c)),fork=path[k]!,at=routePath.indexOf(fork),correct=routePath[at+1];if(correct===undefined)return -Infinity;
  const a=nodes[fork]!,goal=nodes[exit??nodes.length-1]!,alignment=(c:number)=>{const b=nodes[c]!,dx=b.x-a.x,dz=b.z-a.z,gx=goal.x-a.x,gz=goal.z-a.z;return (dx*gx+dz*gz)/(Math.hypot(dx,dz)*Math.hypot(gx,gz)||1);};
  const circuit=[...path,path[0]!],neighbors=k===0?[path[1]!,path.at(-1)!]:k===path.length-1?[path[k-1]!,path[0]!]:[path[k-1]!,path[k+1]!],values=[...neighbors,correct].map(c=>Math.exp(3*alignment(c))),total=values.reduce((a,b)=>a+b,0),prob=values.map(v=>v/total),length=circuit.slice(1).reduce((sum,c,j)=>sum+Math.hypot(nodes[c]!.x-nodes[circuit[j]!]!.x,nodes[c]!.z-nodes[circuit[j]!]!.z),0);
  const strong=alignment(correct)<=-.15&&Math.min(...neighbors.map(alignment))>=.1;
  return (strong?1000:0)+4*Math.min(prob[0]!,prob[1]!)-prob[2]!-.002*Math.abs(length-64);
 };
 for(let n=0;n<baseLoops;n++){
   let choice=closed.find(i=>{if(!guardedConnection(edges[i]!,guards))return false;if(n>=(p.loopTrapCount??0))return true;const e=edges[i]!,path=treePath(e.a,e.b);const gates=path.filter(c=>route.has(c));return gates.length===1&&gates[0]!==routePath[0]&&gates[0]!==routePath.at(-1);});
   if(n<(p.loopTrapCount??0)&&choice!==undefined){const eligible=closed.filter(i=>{if(!guardedConnection(edges[i]!,guards))return false;const e=edges[i]!,gates=treePath(e.a,e.b).filter(c=>route.has(c));return gates.length===1&&gates[0]!==routePath[0]&&gates[0]!==routePath.at(-1);});eligible.sort((a,b)=>ringScore(b)-ringScore(a));choice=eligible[0];}
   if(preferDistributed&&n>=(p.loopTrapCount??0)){let best=Infinity;for(const i of closed){if(!guardedConnection(edges[i]!,guards))continue;used.add(i);const score=topologyScore();used.delete(i);if(score<best-1e-9){best=score;choice=i;}}}
   if(choice===undefined)throw Error('В этой сети нет соединения, сохраняющего заданные ловушки.');
   const e=edges[choice]!,loopFork=n<(p.loopTrapCount??0)?treePath(e.a,e.b).find(c=>route.has(c)):undefined;
   used.add(choice);closed.splice(closed.indexOf(choice),1);
   if(loopFork!==undefined){const links=nodes.map(()=>[] as number[]);for(const i of used){const e=edges[i]!;links[e.a]!.push(e.b);links[e.b]!.push(e.a);}const first=e.a===loopFork?e.b:e.a;guards.push({fork:loopFork,cells:branchComponent(links,first,loopFork),kind:'loop'});const at=routePath.indexOf(loopFork);guards.push(bridgeGuard(treeLinks,routePath[at-1]!,loopFork),bridgeGuard(treeLinks,loopFork,routePath[at+1]!));}
 }

 const corridors:CorridorSpace[]=[...nodes,...[...used].map(i=>edges[i]!.space)];
 // Flood the actual land left inside corridor loops. Only complete rectangular
 // courtyards can become halls in this orthogonal room adapter.
 const w=p.columns/2,h=p.rows/2,empty=new Set<number>();
 const occupied=(x:number,z:number)=>corridors.some(r=>x>r.x&&x<r.x+r.width&&z>r.z&&z<r.z+r.height);
 for(let z=0;z<h;z++)for(let x=0;x<w;x++)if(footprintContains(p,mm(x*2+1),mm(z*2+1))&&!occupied(x*2+1,z*2+1))empty.add(z*w+x);
 const courtyards:CorridorSpace[]=[];let enclosed=0;
 while(empty.size){const first=empty.values().next().value!,queue=[first];empty.delete(first);let closed=true;
 for(let j=0;j<queue.length;j++){const c=queue[j]!,x=c%w,z=Math.floor(c/w);for(const [a,b]of [[x-1,z],[x+1,z],[x,z-1],[x,z+1]]){if(a!<0||a!>=w||b!<0||b!>=h||!footprintContains(p,mm(a!*2+1),mm(b!*2+1))){closed=false;continue;}const n=b!*w+a!;if(empty.delete(n))queue.push(n);}}
 if(!closed)continue;enclosed++;const x=Math.min(...queue.map(c=>c%w))*2,z=Math.min(...queue.map(c=>Math.floor(c/w)))*2,width=(Math.max(...queue.map(c=>c%w))+1)*2-x,height=(Math.max(...queue.map(c=>Math.floor(c/w)))+1)*2-z;
 if(width*height===queue.length*4&&Math.min(width,height)<=6&&Math.max(width,height)<=16)courtyards.push({kind:'hall',x,z,width,height});
 }
 shuffle(courtyards,rng);const count=Math.min(2,Math.max(0,enclosed-1),courtyards.length),halls=courtyards.slice(0,count),routed=offsetCorridors(p,nodes,[...used].map(i=>edges[i]!),halls,rng),spaces:CorridorSpace[]=[...routed.corridors,...halls],modules:PlacedModule[]=[];
 if(p.extraConnections>baseLoops&&!halls.length)throw Error('Не найдены дворы для доступных залов.');
 const hallDoorCounts=halls.map(()=>1);for(let n=0;n<p.extraConnections-baseLoops;n++)hallDoorCounts[n%halls.length]!++;
 const add=(x:number,z:number,length:number,vertical=false)=>modules.push({id:`m${modules.length}`,type:length===6?'2x6':'2x2',x,z,rotation:vertical?90:0});
 for(const node of nodes)add(node.x,node.z,2);
 for(const path of routed.paths){const tiles=path.slice(1,-1);
  for(let j=0;j<tiles.length;){const a=tiles[j]!,b=tiles[j+1],c=tiles[j+2],vertical=b?.x===a.x,long=b&&c&&(vertical?c.x===a.x&&b.z-a.z===c.z-b.z: c.z===a.z&&b.x-a.x===c.x-b.x);if(long){add(Math.min(a.x,b.x,c.x),Math.min(a.z,b.z,c.z),6,vertical);j+=3;}else{add(a.x,a.z,2);j++;}}
 }

 return {modules,spaces,networkVersion:4,hallDoorCounts,...((p.loopTrapCount??0)>0&&exit!==undefined?{exitTarget:{x:nodes[exit]!.x+1,z:nodes[exit]!.z+1}}:{})};
}
