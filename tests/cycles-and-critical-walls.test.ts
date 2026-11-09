import {expect,test} from 'bun:test';
import {generate} from '../src/generators/generate';
import {addConstrainedConnections} from '../src/generators/constrained-connections';
import {withPortals} from '../src/core/portals';
import {emptyMaze,connect,type Maze} from '../src/core/maze';
import {metrics} from '../src/core/metrics';
import {criticalWalls,criticalWallAt} from '../src/analysis/critical-walls';
import {minimaxRetreat} from '../src/analysis/minimax-retreat';
import {routeTraps} from '../src/analysis/route-traps';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {optimizeColdspots} from '../src/analysis/optimize';
import {serialize,deserialize} from '../src/persistence/maze-json';
let cached:Maze|undefined;
function fixture(){if(!cached){const raw=generate({columns:9,rows:9,corridorWidth:2,moduleSize:2,algorithm:'backtracker',seed:'ordinary-generator-proof',extraConnections:0,shape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:9,height:9,operation:'add'},{x:3,z:3,width:3,height:6,operation:'subtract'}]}});const old=withPortals({...raw,entrance:{cell:272,side:'south'},exit:{cell:288,side:'south'}},[{cell:272,side:'south'},{cell:288,side:'south'}]);cached=generate({...raw.parameters,routeTrapCount:1},old);}return structuredClone(cached);}
test('an alternative cyclic path reduces necessary retreat rather than borrowing a later detour',()=>{
 const m=emptyMaze({columns:2,rows:2,corridorWidth:2,algorithm:'prim',seed:'minimax',extraConnections:0});
 connect(m,0,1);connect(m,1,3);connect(m,3,2);m.exit={cell:3,side:'east'};
 const heights=[4,10,3,0];expect(minimaxRetreat(m,heights)[0]).toBe(10);
 connect(m,0,2);expect(minimaxRetreat(m,heights)[0]).toBe(4);
 expect(routeTraps(m).qualifiedCount).toBe(0);
});
test('critical walls identify which recognized elements a single opening destroys',()=>{
 const m=fixture(),before=structuredClone(m),walls=criticalWalls(m);
 expect(walls.some(w=>w.protections.some(p=>p.kind==='portal'))).toBe(true);
 const trapWalls=walls.filter(w=>w.protections.some(p=>p.kind==='trap'));expect(trapWalls.length).toBeGreaterThan(0);
 for(const w of trapWalls.slice(0,3)){
   const passages=m.passages.map(ns=>[...ns]);passages[w.a]!.push(w.b);passages[w.b]!.push(w.a);
   const forks=new Set(routeTraps({...m,passages}).candidates.filter(t=>t.qualifies).map(t=>`trap:${t.fork}`));
   for(const p of w.protections.filter(p=>p.kind==='trap'))expect(forks.has(p.element)).toBe(false);
 }
 const first=walls[0]!,point={x:(first.wall.x1+first.wall.x2)/2,z:(first.wall.z1+first.wall.z2)/2};
 expect(criticalWallAt(walls,point,.01)).toEqual(first);expect(criticalWallAt(walls,{x:-100,z:-100},.1)).toBeUndefined();
 expect(m).toEqual(before);
});
test('adding connections keeps shielding, original traps and every critical wall, with an exact cycle count',()=>{
 const m=fixture(),snapshot=structuredClone(m),critical=criticalWalls(m),maze=addConstrainedConnections(m,2,'cycles-proof');
 expect(metrics(maze).cycles).toBe(2);expect(metrics(maze).components).toBe(1);expect(maze.parameters.extraConnections).toBe(2);
 expect(routeTraps(maze).qualifiedCount).toBeGreaterThanOrEqual(1);expect(mazePortalPrivacy(maze,false).certified).toBe(true);
 for(const w of critical)expect(maze.passages[w.a]!.includes(w.b)).toBe(false);
 for(let c=0;c<m.passages.length;c++)for(const n of m.passages[c]!)expect(maze.passages[c]).toContain(n);
 expect(m).toEqual(snapshot);expect(addConstrainedConnections(m,2,'cycles-proof')).toEqual(maze);expect(deserialize(serialize(maze))).toEqual(maze);
 const p=analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:32},undefined,false);
 expect(p.supported).toBe(true);expect(p.treeForecast).toBe(false);expect(p.cycles).toBe(2);expect(p.decisions).toBeUndefined();expect(p.eligible).toBe(true);
 const optimized=optimizeColdspots(maze,{...DEFAULT_ANALYSIS,samples:16},'walls',3,undefined,'exploration');
 expect(metrics(optimized.maze).cycles).toBe(2);for(const w of critical)expect(optimized.maze.passages[w.a]!.includes(w.b)).toBe(false);
 expect(()=>addConstrainedConnections(m,20000,'impossible')).toThrow();expect(m).toEqual(snapshot);
},30000);
