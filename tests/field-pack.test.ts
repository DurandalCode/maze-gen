import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import type {Maze} from '../src/core/maze';
import {DEFAULT_DESIGN_LIMITS,walls,cellCenter} from '../src/core/maze';
import {domainOf} from '../src/core/domain';
import {metrics} from '../src/core/metrics';
import {obviousForkDeadEnds} from '../src/analysis/visible-deadends';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
const pack=JSON.parse(readFileSync(new URL('../src/data/field-pack.json',import.meta.url),'utf8')) as {kind:string;version:number;mazes:{id:string;title:string;maze:Maze}[]};
test('the offline field pack contains 25 distinct neutral titles and roofed physical module mazes',()=>{
 expect(pack.kind).toBe('maze-lab-pack');expect(pack.version).toBe(1);expect(pack.mazes).toHaveLength(25);
 expect(new Set(pack.mazes.map(m=>m.id)).size).toBe(25);expect(new Set(pack.mazes.map(m=>m.title)).size).toBe(25);
 for(const [i,{title,maze}] of pack.mazes.entries()){
  expect(title).toBe(`Набор · ${String(i+1).padStart(2,'0')}`);expect(maze.roof).toBe(true);expect(maze.parameters.moduleSize).toBe(2);
  const modules=domainOf(maze).modules.reduce((a,b)=>a+b,0);expect(modules).toBeGreaterThanOrEqual(60);expect(modules).toBeLessThanOrEqual(70);
  expect(maze.parameters.design).toEqual(DEFAULT_DESIGN_LIMITS);expect(metrics(maze).components).toBe(1);expect(metrics(maze).cycles).toBe(maze.parameters.extraConnections);
  expect(obviousForkDeadEnds(maze).ratio).toBeLessThanOrEqual(.12+1e-9);expect(routeTraps(maze).qualifiedCount).toBeGreaterThanOrEqual(maze.parameters.routeTrapCount??0);expect(loopTraps(maze).qualifiedCount).toBeGreaterThanOrEqual(maze.parameters.loopTrapCount??0);
  expect(deserialize(serialize(maze))).toEqual(maze);
 }
});
test('all offline pack passages remain physically traversable with structural uprights',()=>{
 for(const {maze} of pack.mazes){const world=new CollisionWorld([...walls(maze),...supportColliders(maze)]);
  for(const c of domainOf(maze).cells)for(const n of maze.passages[c]!)if(n>c){const a=cellCenter(maze,c),b=cellCenter(maze,n),r=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(r.x-b.x,r.z-b.z)).toBeLessThan(1e-5);}
 }
});
