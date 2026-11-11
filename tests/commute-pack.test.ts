import {test,expect} from 'bun:test';
import pack from '../src/data/commute-pack.json';
import {deserialize} from '../src/persistence/maze-json';
import {componentCount,independentCycles} from '../src/core/graph';
import {minimumFloorChanges} from '../src/core/two-storey';
import {loopTraps} from '../src/analysis/loop-traps';
import {contentId} from '../src/persistence/identity';
test('commute pack preserves all maps and checks loop qualification against the actual plot',async()=>{
 expect(pack.mazes).toHaveLength(6);expect(new Set(pack.mazes.map(r=>r.id)).size).toBe(6);
 for(const row of pack.mazes){
  const maze=deserialize(JSON.stringify(row.maze));expect(await contentId(maze)).toBe(row.id);expect(maze.roof).toBe(true);expect(componentCount(maze)).toBe(1);expect(independentCycles(maze)).toBe(maze.parameters.extraConnections);
  const loops=loopTraps(maze).candidates,correctedBoundaryCase=row.id==='1218aee785c4607f8f15f407';
  expect(loops.some(t=>t.credibility.strongEntry&&t.credibility.commitmentDistance>=24)).toBe(true);
  if(correctedBoundaryCase){
   // Internal room edges used to masquerade as the known outer perimeter.
   // Keep this saved map and its history, but never restore that false qualification.
   expect(loops.some(t=>t.qualifies)).toBe(false);
   expect(loops.some(t=>Math.min(...t.entryProbabilities)<.15&&t.correctProbability>.4)).toBe(true);
  }else expect(loops.some(t=>t.qualifies)).toBe(true);
  if(maze.version===6){expect(maze.width).toBeLessThanOrEqual(40);expect(maze.depth).toBeLessThanOrEqual(40);expect(minimumFloorChanges(maze)).toBeGreaterThanOrEqual(4);}
  else {expect(maze.version).toBe(5);expect(maze.parameters.placementMode).toBe('free');expect(maze.width).toBe(60);expect(maze.depth).toBe(60);expect(maze.free!.modules.some(m=>m.angle%90!==0)).toBe(true);expect(maze.passages.filter(p=>p.length>2).length).toBeGreaterThanOrEqual(8);expect(maze.free!.modules.length).toBeGreaterThanOrEqual(40);expect(loopTraps(maze).candidates.some(t=>(correctedBoundaryCase||t.qualifies)&&t.loop.filter(c=>maze.passages[c]!.length>2).length>=3)).toBe(true);}
 }
}, 60_000);
