import {test,expect} from 'bun:test';
import pack from '../src/data/commute-pack.json';
import {deserialize} from '../src/persistence/maze-json';
import {componentCount,independentCycles} from '../src/core/graph';
import {minimumFloorChanges} from '../src/core/two-storey';
import {loopTraps} from '../src/analysis/loop-traps';
import {contentId} from '../src/persistence/identity';
test('commute pack keeps six distinct roofed maps with attractive return loops and branching free networks',async()=>{
 expect(pack.mazes).toHaveLength(6);expect(new Set(pack.mazes.map(r=>r.id)).size).toBe(6);
 for(const row of pack.mazes){
  const maze=deserialize(JSON.stringify(row.maze));expect(await contentId(maze)).toBe(row.id);expect(maze.roof).toBe(true);expect(componentCount(maze)).toBe(1);expect(independentCycles(maze)).toBe(maze.parameters.extraConnections);
  expect(loopTraps(maze).candidates.some(t=>t.qualifies&&t.credibility.strongEntry&&t.credibility.commitmentDistance>=24)).toBe(true);
  if(maze.version===6){expect(maze.width).toBeLessThanOrEqual(40);expect(maze.depth).toBeLessThanOrEqual(40);expect(minimumFloorChanges(maze)).toBeGreaterThanOrEqual(4);}
  else {expect(maze.version).toBe(5);expect(maze.parameters.placementMode).toBe('free');expect(maze.width).toBe(60);expect(maze.depth).toBe(60);expect(maze.free!.modules.some(m=>m.angle%90!==0)).toBe(true);expect(maze.passages.filter(p=>p.length>2).length).toBeGreaterThanOrEqual(8);expect(maze.free!.modules.length).toBeGreaterThanOrEqual(40);expect(loopTraps(maze).candidates.some(t=>t.qualifies&&t.loop.filter(c=>maze.passages[c]!.length>2).length>=3)).toBe(true);}
 }
}, 60_000);
