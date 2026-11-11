import {neighbors,type Maze} from '../core/maze';
import {domainOf} from '../core/domain';
export const contourKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
export interface ContourStructure {depth:Int32Array;layers:number;pairs:[number,number][];preferred:Set<string>;forestCapacity:number;cycleCapacity:number}
const cache=new WeakMap<object,Map<number,ContourStructure>>();
/** Topological erosion from ALL boundaries, including courtyards. No hidden wall data. */
export function contourStructure(maze:Maze):ContourStructure{
 let versions=cache.get(maze.parameters);if(!versions){versions=new Map();cache.set(maze.parameters,versions);}const found=versions.get(maze.version);if(found)return found;
 const domain=domainOf(maze),depth=new Int32Array(maze.passages.length).fill(-1),queue:number[]=[],pairs:[number,number][]=[];
 for(const c of domain.cells){const ns=neighbors(maze,c);if(ns.length<4){depth[c]=0;queue.push(c);}for(const n of ns)if(n>c)pairs.push([c,n]);}
 for(let i=0;i<queue.length;i++)for(const n of neighbors(maze,queue[i]!))if(depth[n]===-1){depth[n]=depth[queue[i]!]!+1;queue.push(n);}
 const preferred=new Set<string>(),parent=Int32Array.from({length:depth.length},(_,i)=>i);
 const root=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]!]!;n=parent[n]!;}return n;};
 let forestCapacity=0;
 for(const [a,b] of pairs)if(depth[a]===depth[b]){preferred.add(contourKey(a,b));const x=root(a),y=root(b);if(x!==y){parent[y]=x;forestCapacity++;}}
 const result={depth,layers:domain.cells.reduce((max,c)=>Math.max(max,depth[c]!+1),0),pairs,preferred,forestCapacity,cycleCapacity:preferred.size-forestCapacity};versions.set(maze.version,result);return result;
}
export interface ContourQuality {supported?:boolean;reason?:string;layers:number;retained:number;maximum:number;ratio:number|null;separation:number|null;certified:boolean}
export function contourQuality(maze:Maze,cycles?:number):ContourQuality{
 if(maze.free)return {supported:false,reason:'Контурная оценка сетки не применяется к свободным модулям.',layers:0,retained:0,maximum:0,ratio:null,separation:null,certified:false};
 const s=contourStructure(maze);let edges=0,retained=0;
 for(const a of domainOf(maze).cells)for(const b of maze.passages[a]!)if(b>a){edges++;if(s.preferred.has(contourKey(a,b)))retained++;}
 const count=cycles??Math.max(0,edges-domainOf(maze).cells.length+1),maximum=s.forestCapacity+Math.min(count,s.cycleCapacity),ratio=maximum?retained/maximum:null;
 // Retaining tangent passages alone would incorrectly certify a fully open grid.
 const radialCapacity=s.pairs.length-s.preferred.size,minimumRadial=domainOf(maze).cells.length-1-s.forestCapacity,maximumWalls=radialCapacity-minimumRadial;
 const separation=maximumWalls>0?(radialCapacity-(edges-retained))/maximumWalls:null;
 return {layers:s.layers,retained,maximum,ratio,separation,certified:(ratio===null||ratio>=.8-1e-9)&&(separation===null||separation>=.8-1e-9)};
}
