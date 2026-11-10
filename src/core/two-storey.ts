import { domainOf, shapeMask, type CellRectangle, type Domain, type GridShape } from './domain';
import { emptyMaze, cellCenter, axisBounds, walls, type Maze, type Parameters, type Point, type Wall } from './maze';

export interface SpatialNode { rect: CellRectangle; center: Point; floor: 0|1; stair?: number; local?: number }
export interface Staircase { id:number; cells:number[]; shaft:number[]; lower:number; upper:number; axis:'x'|'z'; start:Point; end:Point; width:number; rise:number; steps:number }
export interface TwoStoreyLayout { slabThickness:number; floorHeight:number; floors:[Maze,Maze]; nodes:(SpatialNode|null)[]; adjacent:number[][]; stairs:Staircase[] }
export const SLAB_THICKNESS=.2;
export function twoStoreyParameters(p:Parameters):void {
  if(p.placementMode==='free')throw Error('Два этажа доступны только на классических квадратных модулях.');
  if(p.moduleSize===undefined)throw Error('Двухэтажный лабиринт требует отдельных квадратных модулей.');
  const k=p.minFloorChanges??4;
  if(!Number.isInteger(k)||k<2||k%2||k>200)throw Error('Минимум смен этажей — чётное число от 2 до 200.');
  const lower=shapeMask(p),upper=shapeMask({...p,shape:p.upperShape??p.shape});
  if(!upper.some(Boolean))throw Error('Второй этаж пуст.');
  if(upper.some((on,i)=>on&&!lower[i]))throw Error('Верхний этаж должен находиться внутри нижнего контура.');
  if(p.design?.allowReshape)throw Error('Для двух этажей формы задаются вручную; отключите изменение формы при подборе.');
}
export function floorOf(maze:Maze,cell:number):number {return maze.storeys?.nodes[cell]?.floor??0;}
export function spatialDistance(a:Point,b:Point):number {return Math.hypot(a.x-b.x,a.z-b.z,(a.y??0)-(b.y??0));}
export function floorChangeDistances(maze:Maze,from:number):Float64Array {
  const dist=new Float64Array(maze.passages.length).fill(Infinity),queue=[from];dist[from]=0;
  for(let head=0;head<queue.length;head++)for(const b of maze.passages[queue[head]!]??[]){const a=queue[head]!,cost=floorOf(maze,a)===floorOf(maze,b)?0:1,d=dist[a]!+cost;if(d<dist[b]!){dist[b]=d;queue.push(b);}}
  return dist;
}
export function minimumFloorChanges(maze:Maze,from=maze.entrance.cell,to=maze.exit.cell):number {return maze.storeys?floorChangeDistances(maze,from)[to]!:0;}
export function validFloorChanges(maze:Maze):boolean {if(!maze.storeys)return true;const changes=minimumFloorChanges(maze);return Number.isFinite(changes)&&changes>=(maze.parameters.minFloorChanges??4);}
const domains=new WeakMap<Maze,Domain>();
const views=new WeakMap<Maze,Map<number,Maze>>();
export function storeyDomain(maze:Maze):Domain {
  const cached=domains.get(maze);if(cached)return cached;
  const s=maze.storeys!,cells=s.nodes.flatMap((n,i)=>n?[i]:[]),active=Uint8Array.from(s.nodes,n=>n?1:0),rectangles=s.nodes.map(n=>n?.rect),boundary=domainOf(s.floors[0]).boundary.filter(b=>active[b.portal.cell]);
  const modules=Uint8Array.from([...domainOf(s.floors[0]).modules,...domainOf(s.floors[1]).modules]);
  const contains=(p:Point)=>spatialCellAt(maze,p)!==null;
  const result:Domain={cells,active,rectangles,modules,boundary,area:cells.reduce((a,c)=>{const r=rectangles[c]!;return a+(r.x2-r.x1)*(r.z2-r.z1);},0),contains,constrain:(from,to)=>contains(to)?to:from};domains.set(maze,result);return result;
}
/** A planar projection for rendering or certifying local geometry, never a navigation shortcut. */
export function storeyView(maze:Maze,floor:number):Maze {
  let cache=views.get(maze);if(!cache){cache=new Map();views.set(maze,cache);}const cached=cache.get(floor);if(cached)return cached;
  const s=maze.storeys!;const base=s.floors[floor]!,n=base.passages.length,offset=floor*n;
  const view={...base,...{wallHeight:maze.wallHeight,wallColor:maze.wallColor,translucentFabric:maze.translucentFabric,roof:maze.roof},environment:maze.environment,passages:Array.from({length:n},(_,i)=>(maze.passages[i+offset]??[]).filter(b=>b>=offset&&b<offset+n).map(b=>b-offset)),entrance:maze.entrance,exit:maze.exit,portals:floor===0?maze.portals??[maze.entrance,maze.exit]:[]} as Maze;
  for(const st of s.stairs){const chain=floor===0?[st.lower,...st.shaft]:[st.upper%n,...[...st.shaft].reverse()];for(let i=1;i<chain.length;i++){const a=chain[i-1]!,b=chain[i]!;if(!view.passages[a]!.includes(b))view.passages[a]!.push(b);if(!view.passages[b]!.includes(a))view.passages[b]!.push(a);}}
  Object.defineProperty(view,'shaftRects',{value:s.stairs.flatMap(st=>st.shaft.map(c=>domainOf(s.floors[0]).rectangles[c]!)),enumerable:false});
  cache.set(floor,view);return view;
}
export function storeyWalls(maze:Maze):Wall[] {
  const s=maze.storeys!,result:Wall[]=[];
  for(const floor of [0,1]){
    const view=storeyView(maze,floor),domain=domainOf(view);
    for(const w of walls(view)){
      // Shaft walls are constructed separately, with openings only at landings.
      const mid={x:(w.x1+w.x2)/2,z:(w.z1+w.z2)/2};
      if(s.stairs.some(st=>st.shaft.some(c=>{const r=domain.rectangles[c]!;return mid.x>=r.x1-1e-7&&mid.x<=r.x2+1e-7&&mid.z>=r.z1-1e-7&&mid.z<=r.z2+1e-7;})))continue;
      result.push({...w,floor,y:floor*s.floorHeight,height:maze.wallHeight});
    }
    // The floor mask includes shaft cells for editing; actual holes and sides follow stair geometry.

  }
  for(const st of s.stairs){
    const a=st.start,b=st.end,h=st.width/2,along=st.axis==='x';
    const left=along?{x1:a.x,z1:a.z-h,x2:b.x,z2:b.z-h}:{x1:a.x-h,z1:a.z,x2:b.x-h,z2:b.z};
    const right=along?{x1:a.x,z1:a.z+h,x2:b.x,z2:b.z+h}:{x1:a.x+h,z1:a.z,x2:b.x+h,z2:b.z};
    result.push({...left,y:0,height:s.floorHeight+maze.wallHeight,stair:st.id},{...right,y:0,height:s.floorHeight+maze.wallHeight,stair:st.id});
    // Close the lower end upstairs and the upper end downstairs.
    for(const [p,y]of [[a,s.floorHeight],[b,0]] as const)result.push({x1:p.x-(along?0:h),z1:p.z-(along?h:0),x2:p.x+(along?0:h),z2:p.z+(along?h:0),y,height:maze.wallHeight});

  }
  return result;
}
export function stairAt(maze:Maze,p:Point):Staircase|undefined {
  return maze.storeys?.stairs.find(st=>{const dx=st.end.x-st.start.x,dz=st.end.z-st.start.z,length=Math.hypot(dx,dz),t=((p.x-st.start.x)*dx+(p.z-st.start.z)*dz)/(length*length),cross=Math.abs((p.x-st.start.x)*dz-(p.z-st.start.z)*dx)/length;return t>=-1e-7&&t<=1+1e-7&&cross<=st.width/2+1e-7;});
}
export function stairProgress(st:Staircase,p:Point):number {return Math.max(0,Math.min(1,((p.x-st.start.x)*(st.end.x-st.start.x)+(p.z-st.start.z)*(st.end.z-st.start.z))/((st.end.x-st.start.x)**2+(st.end.z-st.start.z)**2)));}
export function spatialCellAt(maze:Maze,p:Point):number|null {
  const s=maze.storeys!,base=s.floors[0],n=base.passages.length,w=maze.parameters.columns*2-1;
  if(p.x<0||p.z<0||p.x>maze.width||p.z>maze.depth)return null;
  const indices=(bounds:number[],v:number)=>{let lo=0,hi=bounds.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(bounds[mid]!<v-1e-8)lo=mid+1;else hi=mid;}return [lo-1,lo].filter(i=>i>=0&&i<bounds.length-1&&v>=bounds[i]!-1e-8&&v<=bounds[i+1]!+1e-8);};
  const xs=indices(axisBounds(base,'x'),p.x),zs=indices(axisBounds(base,'z'),p.z),st=p.stair===undefined?undefined:s.stairs.find(st=>st.id===p.stair);
  if(p.stair!==undefined&&!st)return null;
  for(const z of zs)for(const x of xs){const local=z*w+x;if(st){const index=st.shaft.indexOf(local);if(index>=0)return st.cells[index]!;}else{const id=local+(p.floor??0)*n,node=s.nodes[id];if(node&&node.stair===undefined&&node.floor===(p.floor??0))return id;}}
  return null;
}

export function floorParameters(p:Parameters,shape:GridShape|undefined):Parameters {const {upperShape:_,minFloorChanges:__,...rest}=p;return {...rest,generationType:'classical',design:undefined,routeTrapCount:0,loopTrapCount:0,extraConnections:0,shape};}
export function makeFloors(p:Parameters):[Maze,Maze] {
  const lower=emptyMaze(floorParameters(p,p.shape));
  // Disconnected upper islands are deliberately legal; emptyMaze's legacy validator requires connectivity.
  const upper=emptyMaze(floorParameters(p,undefined));upper.parameters={...upper.parameters,shape:p.upperShape??p.shape};upper.version=upper.parameters.shape?3:2;
  return [lower,upper];
}
export function physicalStoreyIdentity(maze:Maze):unknown {
  const s=maze.storeys!,key=(c:number)=>{const n=s.nodes[c]!,r=n.rect;return [r.x1,r.z1,r.x2,r.z2,n.center.y??0].join(':');},edges:string[]=[];
  for(const a of domainOf(maze).cells)for(const b of maze.passages[a]!)if(b>a)edges.push([key(a),key(b)].sort().join('|'));
  return {version:6,moduleSize:maze.parameters.moduleSize,corridorWidth:maze.parameters.corridorWidth,columns:maze.parameters.columns,rows:maze.parameters.rows,floors:s.floors.map(m=>[...domainOf(m).modules]),floorHeight:s.floorHeight,slabThickness:s.slabThickness,stairs:s.stairs.map(st=>[st.start.x,st.start.z,st.end.x,st.end.z,st.width,st.rise,st.steps].join(':')).sort(),edges:edges.sort(),portals:(maze.portals??[maze.entrance,maze.exit]).map(p=>({cell:p.cell,side:p.side}))};
}

export function nodePoint(maze:Maze,c:number):Point{const s=maze.storeys!,n=s.floors[0].passages.length;return s.nodes[c]?.center??{...cellCenter(s.floors[0],c%n),y:c>=n?s.floorHeight:0,floor:c>=n?1:0};}


/** Include the horizontal landing approach before the inclined flight. */
export function spatialEdgePoints(maze:Maze,a:number,b:number):Point[]{
  const p=cellCenter(maze,a),q=cellCenter(maze,b),s=maze.storeys;if(!s)return [p,q];
  const na=s.nodes[a]!,nb=s.nodes[b]!,id=na.stair??nb.stair;if(id===undefined||na.stair!==undefined&&nb.stair!==undefined)return [p,q];
  const st=s.stairs.find(st=>st.id===id)!,landing=na.stair===undefined?a:b,upper=landing===st.upper,boundary={...(upper?st.end:st.start),y:upper?s.floorHeight:0,floor:upper?1:0,stair:id};return [p,boundary,q];
}
export function spatialEdgeLength(maze:Maze,a:number,b:number):number{const points=spatialEdgePoints(maze,a,b);return points.slice(1).reduce((sum,p,i)=>sum+spatialDistance(points[i]!,p),0);}

export function spatialShortestPath(maze:Maze,from:number,to:number):number[]{
  const nodes=maze.storeys!.nodes;if(!nodes[from]||!nodes[to])return [];
  const dist=new Float64Array(nodes.length).fill(Infinity),parent=new Int32Array(nodes.length).fill(-1),heap:{cell:number;distance:number}[]=[];
  const push=(cell:number,distance:number)=>{let i=heap.length;heap.push({cell,distance});while(i){const p=(i-1)>>1;if(heap[p]!.distance<=distance)break;heap[i]=heap[p]!;i=p;}heap[i]={cell,distance};};
  const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1]!.distance<heap[child]!.distance)child++;if(heap[child]!.distance>=last.distance)break;heap[i]=heap[child]!;i=child;}heap[i]=last;}return first;};
  dist[from]=0;push(from,0);while(heap.length){const {cell:a,distance}=pop();if(distance!==dist[a])continue;if(a===to)break;for(const b of maze.passages[a]!){const d=distance+spatialEdgeLength(maze,a,b);if(d<dist[b]!){dist[b]=d;parent[b]=a;push(b,d);}}}
  if(!Number.isFinite(dist[to]!))return [];const result=[to];while(result.at(-1)!==from)result.push(parent[result.at(-1)!]!);return result.reverse();
}
