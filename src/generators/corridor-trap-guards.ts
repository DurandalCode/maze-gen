/** Coarse construction guards only. Qualification is still checked against the
 * final physical navigation/visibility model after placement and offsets. */
export interface NetworkEdge {a:number;b:number}
export interface BranchGuard {fork:number;cells:Set<number>;kind:'route'|'loop'|'cut'}
export function branchComponent(links:readonly (readonly number[])[],first:number,fork:number):Set<number>{
 const cells=new Set([first]),queue=[first];for(let i=0;i<queue.length;i++)for(const n of links[queue[i]!]!)if(n!==fork&&!cells.has(n)){cells.add(n);queue.push(n);}return cells;
}
export function guardedConnection(edge:NetworkEdge,guards:readonly BranchGuard[]):boolean{
 return guards.every(g=>{const a=g.cells.has(edge.a),b=g.cells.has(edge.b);if(g.kind==='route')return !a&&!b;return a===b;});
}
export function routeBranchGuards(nodes:readonly {x:number;z:number}[],links:readonly (readonly number[])[],path:readonly number[],requested:number):BranchGuard[]{
 if(!requested)return [];const exit=nodes[path.at(-1)!]!,distance=(c:number)=>Math.hypot(nodes[c]!.x-exit.x,nodes[c]!.z-exit.z),candidates:{guard:BranchGuard;score:number}[]=[];
 for(let i=1;i<path.length-1;i++){
  const fork=path[i]!,correct=path[i+1]!;let peak=distance(fork),away=0;
  for(let j=i+1;j<path.length;j++){const a=path[j-1]!,b=path[j]!;if(distance(b)<distance(a)-1e-7)break;peak=Math.max(peak,distance(b));away+=Math.hypot(nodes[a]!.x-nodes[b]!.x,nodes[a]!.z-nodes[b]!.z);}
  if(peak-distance(fork)<8||away<8)continue;
  for(const n of links[fork]!)if(n!==correct&&n!==path[i-1]){
   const cells=branchComponent(links,n,fork);if(path.some(c=>cells.has(c)))continue;
   let score=0;const queue=[{cell:n,parent:fork,length:Math.hypot(nodes[n]!.x-nodes[fork]!.x,nodes[n]!.z-nodes[fork]!.z)}];
   for(let q=0;q<queue.length;q++){const at=queue[q]!,children=links[at.cell]!.filter(c=>c!==at.parent);if(!children.length){const approach=distance(fork)-distance(at.cell);if(approach>=6&&at.length>=10)score=Math.max(score,approach*(peak-distance(fork)));}for(const c of children)queue.push({cell:c,parent:at.cell,length:at.length+Math.hypot(nodes[c]!.x-nodes[at.cell]!.x,nodes[c]!.z-nodes[at.cell]!.z)});}
   if(score)candidates.push({guard:{fork,cells,kind:'route'},score});
  }
 }
 candidates.sort((a,b)=>b.score-a.score||a.guard.fork-b.guard.fork);const selected:BranchGuard[]=[];
 for(const {guard}of candidates)if(!selected.some(g=>g.fork===guard.fork||[...guard.cells].some(c=>g.cells.has(c)))){selected.push(guard);if(selected.length>=requested)break;}return selected;
}

/** Reserve a tree bridge: later connections cannot bypass this route section. */
export function bridgeGuard(links:readonly (readonly number[])[],a:number,b:number):BranchGuard{
 const cells=new Set([b]),queue=[b];for(let i=0;i<queue.length;i++)for(const n of links[queue[i]!]!)if(!((queue[i]===b&&n===a)||(queue[i]===a&&n===b))&&!cells.has(n)){cells.add(n);queue.push(n);}return {fork:a,cells,kind:'cut'};
}
