import {domainOf} from '../core/domain';
import {cellCenter,DEFAULT_CONSTRUCTION,validateParameters,type Maze,type Parameters,type Portal} from '../core/maze';
import {makeFloors,SLAB_THICKNESS,minimumFloorChanges,floorChangeDistances,spatialDistance,type Staircase,type TwoStoreyLayout} from '../core/two-storey';
import {random,shuffle} from '../core/random';
import {analyzePotential} from '../analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../analysis/coldspots';

export function stairCandidates(floors:[Maze,Maze],rise:number):Staircase[]{
  const base=floors[0],a=domainOf(base),b=domainOf(floors[1]),w=base.parameters.columns*2-1,h=base.parameters.rows*2-1,result:Staircase[]=[],steps=Math.ceil((rise-1e-9)/.18),minimum=steps*.28;
  for(const c of a.cells)for(const [axis,stride,count]of [['x',1,w],['z',w,h]] as const){
    const coordinate=axis==='x'?c%w:Math.floor(c/w),shaft:number[]=[];let run=0;
    for(let j=1;coordinate+j<count-1;j++){
      const q=c+j*stride,r=a.rectangles[q];if(!r||!b.active[q])break;shaft.push(q);run+=axis==='x'?r.x2-r.x1:r.z2-r.z1;
      if(run<minimum)continue;
      const end=q+stride;if(!a.active[end]||!b.active[end]||!b.active[c])break;
      const first=a.rectangles[shaft[0]!]!,last=a.rectangles[q]!,center=cellCenter(base,c),finish=cellCenter(base,end);
      const start=axis==='x'?{x:first.x1,z:center.z}:{x:center.x,z:first.z1},stop=axis==='x'?{x:last.x2,z:finish.z}:{x:finish.x,z:last.z2};
      const width=axis==='x'?first.z2-first.z1:first.x2-first.x1;
      if(width<.8)break;
      result.push({id:0,cells:[],shaft:[...shaft],lower:c,upper:end,axis,start,end:stop,width,rise,steps});
      // Reverse direction is a distinct possible staircase.
      result.push({id:0,cells:[],shaft:[...shaft].reverse(),lower:end,upper:c,axis,start:stop,end:start,width,rise,steps});break;
    }
  }
  return result;
}
export function assembleStoreys(parameters:Parameters,rise:number,selected:Staircase[]):Maze {
  const floors=makeFloors(parameters),n=floors[0].passages.length,nodes:TwoStoreyLayout['nodes']=Array(2*n).fill(null),adjacent:number[][]=Array.from({length:2*n},()=>[]),w=parameters.columns*2-1;
  for(const floor of [0,1] as const)for(const c of domainOf(floors[floor]).cells){const point=cellCenter(floors[floor],c);nodes[c+floor*n]={rect:domainOf(floors[floor]).rectangles[c]!,center:{...point,y:floor*rise,floor},floor,local:c};}
  const stairs=structuredClone(selected).map((st,i)=>({...st,id:i+1,cells:[],upper:st.upper%n} as Staircase));
  for(const st of stairs)for(const c of st.shaft){nodes[c]=null;nodes[c+n]=null;}
  const link=(a:number,b:number)=>{adjacent[a]!.push(b);adjacent[b]!.push(a);};
  for(let i=0;i<2*n;i++){if(!nodes[i])continue;const c=i%n;for(const j of [c%w<w-1?i+1:-1,c+w<n?i+w:-1])if(j>=0&&nodes[j])link(i,j);}
  for(const st of stairs){
    if(!nodes[st.lower]||!nodes[st.upper+n])throw Error('Лестницы пересекаются с площадками.');
    let previous=st.lower;
    for(const c of st.shaft){const rect=domainOf(floors[0]).rectangles[c]!,p=cellCenter(floors[0],c),length=Math.hypot(st.end.x-st.start.x,st.end.z-st.start.z),t=Math.hypot(p.x-st.start.x,p.z-st.start.z)/length,id=nodes.length;
      nodes.push({rect,center:{...p,y:t*rise,floor:t<.5?0:1,stair:st.id},floor:t<.5?0:1,stair:st.id});adjacent.push([]);st.cells.push(id);link(previous,id);previous=id;}
    st.upper+=n;link(previous,st.upper);
  }
  const maze:Maze={version:6,parameters:structuredClone(parameters),width:floors[0].width,depth:floors[0].depth,...DEFAULT_CONSTRUCTION,passages:adjacent.map(()=>[]),entrance:floors[0].entrance,exit:floors[0].exit,storeys:{slabThickness:SLAB_THICKNESS,floorHeight:rise,floors,nodes,adjacent,stairs}};
  return maze;
}
function spanningTree(maze:Maze,rng:()=>number):void {
  const parent=Int32Array.from({length:maze.passages.length},(_,i)=>i),find=(i:number):number=>{let p=i;while(parent[p]!==p)p=parent[p]!;while(parent[i]!==i){const j=parent[i]!;parent[i]=p;i=j;}return p;},edges:[number,number][]=[];
  const link=(a:number,b:number)=>{const x=find(a),y=find(b);if(x===y)return;parent[x]=y;maze.passages[a]!.push(b);maze.passages[b]!.push(a);};
  for(const st of maze.storeys!.stairs){const chain=[st.lower,...st.cells,st.upper];for(let i=1;i<chain.length;i++)link(chain[i-1]!,chain[i]!);}
  for(const a of domainOf(maze).cells)for(const b of maze.storeys!.adjacent[a]!)if(b>a&&maze.storeys!.nodes[a]!.stair===undefined&&maze.storeys!.nodes[b]!.stair===undefined)edges.push([a,b]);
  const components=new Map<number,[number,number][]>();
  for(const c of domainOf(maze).cells)if(!components.has(find(c)))components.set(find(c),[]);
  for(const [a,b]of shuffle(edges,rng)){const x=find(a),y=find(b);if(x!==y){components.get(x)!.push([a,b]);components.get(y)!.push([b,a]);}}
  const root=[...components.keys()][Math.floor(rng()*components.size)]!,visited=new Set([root]),chosen:[number,number][]=[];
  if(maze.parameters.algorithm==='prim'){
    const frontier=[...components.get(root)!];while(frontier.length){const i=Math.floor(rng()*frontier.length),[a,b]=frontier[i]!;frontier[i]=frontier.at(-1)!;frontier.pop();const next=find(b);if(visited.has(next))continue;visited.add(next);chosen.push([a,b]);frontier.push(...components.get(next)!);}
  }else{
    const stack=[root];while(stack.length){const at=stack.at(-1)!,edge=components.get(at)!.find(([,b])=>!visited.has(find(b)));if(!edge){stack.pop();continue;}visited.add(find(edge[1]));chosen.push(edge);stack.push(find(edge[1]));}
  }
  if(visited.size!==components.size)throw Error('Не все площадки доступны через лестницы.');
  for(const [a,b]of chosen){maze.passages[a]!.push(b);maze.passages[b]!.push(a);}

}
function selectPortals(maze:Maze,previous?:Maze):boolean {
  const edges=domainOf(maze).boundary,minimum=maze.parameters.minFloorChanges??4;
  if(previous?.version===6){const allowed=(p:Portal)=>edges.some(e=>e.portal.cell===p.cell&&e.portal.side===p.side);if(!allowed(previous.entrance)||!allowed(previous.exit))return false;maze.entrance={...previous.entrance};maze.exit={...previous.exit};return minimumFloorChanges(maze)>=minimum;}
  let best=-1;
  const candidates=edges.filter((_,i)=>i%Math.max(1,Math.floor(edges.length/64))===0);
  for(const a of candidates){const distances=floorChangeDistances(maze,a.portal.cell);for(const b of candidates){if(a.portal.cell===b.portal.cell)continue;const d=distances[b.portal.cell]!;if(d>=minimum&&d>best){maze.entrance={...a.portal};maze.exit={...b.portal};best=d;}}if(best>=minimum)break;}
  return best>=minimum;
}
export function generateTwoStorey(p:Parameters,previous?:Maze,progress?:(s:string)=>void):Maze {
  validateParameters(p);const rng=random(p.seed+'|two-storey-v1'),floors=makeFloors(p),rise=(previous?.wallHeight??2.5)+SLAB_THICKNESS,candidates=stairCandidates(floors,rise),k=p.minFloorChanges??4;
  if(candidates.length<k)throw Error('Недостаточно места для прямых лестниц и заданного числа смен этажей. Увеличьте форму или уменьшите минимум переходов.');
  const upper=domainOf(floors[1]),seen=new Set<number>(),w=p.columns*2-1;let islands=0;for(const c of upper.cells){if(seen.has(c))continue;islands++;const queue=[c];seen.add(c);for(let i=0;i<queue.length;i++){const a=queue[i]!;for(const b of [a%w?a-1:-1,a%w<w-1?a+1:-1,a-w,a+w])if(upper.active[b]&&!seen.has(b)){seen.add(b);queue.push(b);}}}const requiredStairs=Math.max(k,2*islands);
  let reason='Не удалось разместить лестницы и обязательные переходы.';
  const deadline=Date.now()+20_000;
  for(let attempt=0;attempt<96&&Date.now()<deadline;attempt++){
    progress?.(`Два этажа: размещение лестниц и проверка переходов ${attempt+1}/96`);
    const selected:Staircase[]=[],reserved=new Set<number>();
    for(const st of shuffle([...candidates],rng)){
      const occupied=[st.lower,st.upper,...st.shaft];if(occupied.some(c=>reserved.has(c)))continue;
      selected.push(st);occupied.forEach(c=>reserved.add(c));if(selected.length>=requiredStairs)break;
    }
    if(selected.length<requiredStairs)continue;
    try{
      const maze=assembleStoreys(p,rise,selected);if(previous){Object.assign(maze,{wallHeight:previous.wallHeight,wallColor:previous.wallColor,translucentFabric:previous.translucentFabric,roof:previous.roof,environment:previous.environment});}
      let valid=false;for(let tree=0;tree<12;tree++){maze.passages=maze.passages.map(()=>[]);spanningTree(maze,rng);if(selectPortals(maze,previous)){valid=true;break;}}if(!valid)continue;
      const closed:[number,number][]=[];for(const a of domainOf(maze).cells)for(const b of maze.storeys!.adjacent[a]!)if(b>a&&!maze.passages[a]!.includes(b))closed.push([a,b]);
      let added=0;for(const [a,b]of shuffle(closed,rng)){if(added>=p.extraConnections)break;maze.passages[a]!.push(b);maze.passages[b]!.push(a);if(minimumFloorChanges(maze)>=k)added++;else{maze.passages[a]!.pop();maze.passages[b]!.pop();}}
      if(added!==p.extraConnections){reason='Не хватает допустимых соединений без обхода обязательных лестниц.';continue;}
      maze.passages.forEach(a=>a.sort((a,b)=>a-b));
      if(p.design||(p.routeTrapCount??0)>0||(p.loopTrapCount??0)>0){const quality=analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:64},undefined,false);if(!quality.eligible){reason=quality.issues.join(' ');continue;}const verified=analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:2048},undefined,false);if(!verified.eligible){reason=verified.issues.join(' ');continue;}}
      return maze;
    }catch(e){reason=e instanceof Error?e.message:String(e);}
  }
  throw Error(reason+' Ограниченный поиск завершён; текущая карта сохранена.');
}
export function storeyEdgeLength(maze:Maze,a:number,b:number):number{return spatialDistance(cellCenter(maze,a),cellCenter(maze,b));}
