import {expect,test} from 'bun:test';
import {emptyMaze,connect,neighbors,type Maze} from '../src/core/maze';
import {networkStructure,coldNearExit} from '../src/analysis/network-structure';
const maze=()=>emptyMaze({columns:3,rows:3,corridorWidth:2,algorithm:'prim',seed:'blocks',extraConnections:0});
function links(m:Maze,paths:number[][]){for(const path of paths)for(let i=1;i<path.length;i++)connect(m,path[i-1]!,path[i]!);return m;}
test('two loops meeting only at an articulation are separate detours',()=>{
 const m=links(maze(),[[0,1,4,3,0],[4,5,8,7,4],[1,2],[7,6]]),a=networkStructure(m);
 expect(a.interlinkedCycles).toBe(1);expect(a.junctions).toBe(0);
});
test('three alternative approaches between two junctions form one interlinked block',()=>{
 const m=links(maze(),[[3,4,5],[3,0,1,2,5],[3,6,7,8,5]]);m.entrance={cell:3,side:'west'};m.exit={cell:5,side:'east'};
 expect(networkStructure(m)).toEqual({interlinkedCycles:2,junctions:2,routeJunctions:2,cells:9});
});
test('a grid has overlapping detours and trees have none',()=>{
 const m=maze();for(let a=0;a<m.passages.length;a++)for(const b of neighbors(m,a))if(b>a)connect(m,a,b);
 expect(networkStructure(m).interlinkedCycles).toBe(4);expect(networkStructure(m).junctions).toBe(5);
 expect(networkStructure(links(maze(),[[0,1,2,5,8,7,6,3,4]])).interlinkedCycles).toBe(0);
});
test('cold area near the finish is raw visitation and excludes inactive cells',()=>{
 const m=emptyMaze({columns:2,rows:2,corridorWidth:2,algorithm:'prim',seed:'local-cold',extraConnections:0}),p=new Float64Array(4);p[3]=1;
 expect(coldNearExit(m,p,.2)).toEqual({area:16,coldArea:12,ratio:.75});expect(coldNearExit(m,p,.2,2)).toEqual({area:4,coldArea:0,ratio:0});
 const shaped=emptyMaze({...m.parameters,shape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:2,height:2,operation:'add'},{x:0,z:0,width:1,height:1,operation:'subtract'}]}});
 expect(coldNearExit(shaped,new Float64Array(4),.2).coldArea).toBe(12);
});
test('iterative block analysis handles a full-size snake',()=>{
 const m=emptyMaze({columns:100,rows:100,corridorWidth:2,algorithm:'prim',seed:'large-blocks',extraConnections:0});
 const cells=Array.from({length:100},(_,z)=>Array.from({length:100},(_,x)=>z*100+(z%2?99-x:x))).flat();for(let i=1;i<cells.length;i++)connect(m,cells[i-1]!,cells[i]!);
 expect(networkStructure(m).interlinkedCycles).toBe(0);
});
test('pocket reduction honors caller constraints and keeps the source intact',async()=>{
 const {braidObviousPockets}=await import('../src/generators/braid-pockets');
 const m=emptyMaze({columns:7,rows:2,corridorWidth:2,algorithm:'prim',seed:'guarded-braid',extraConnections:0});for(let i=0;i<6;i++)connect(m,i,i+1);for(let i=0;i<7;i++)connect(m,i,i+7);
 const before=structuredClone(m);let checked=0;expect(braidObviousPockets(m,0,3,undefined,()=>{checked++;return false;})).toBe(m);expect(checked).toBeGreaterThan(0);expect(m).toEqual(before);
});
test('cyclic repair cannot return a candidate rejected by caller constraints',async()=>{
 const {repairCyclicGeometry}=await import('../src/generators/loop-traps');const {portalConstraints}=await import('../src/generators/guarded');
 const pack=await Bun.file(new URL('../src/data/field-pack.json',import.meta.url)).json(),base=structuredClone(pack.mazes[0].maze) as Maze;
 base.parameters.design={maxForcedStraight:40,maxForcedRun:100,maxVisibleStraight:24,maxColdRatio:1,maxColdRegion:10000,allowReshape:false,maxModuleGrowth:0};
 const before=structuredClone(base);let checked=0;expect(repairCyclicGeometry(base,portalConstraints(base),'accept-filter',0,undefined,()=>{checked++;return false;})).toBeNull();expect(checked).toBeGreaterThan(0);expect(base).toEqual(before);
});
