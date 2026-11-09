import { expect, test } from 'bun:test';
import { emptyMaze, connect } from '../src/core/maze';
import { corridorQuality } from '../src/analysis/corridor-quality';
function line() { const m = emptyMaze({ columns: 7, rows: 1, corridorWidth: 2, algorithm: 'prim', seed: 'line', extraConnections: 0 }); for (let i = 0; i < 6; i++)
  connect(m, i, i + 1); return m; }
test('a long forced straight is counted independently of maze area', () => {
  const r = corridorQuality(line(), 8);
  expect(r.longestMandatoryForcedStraight).toBe(14);
  expect(r.longestMandatoryForcedRun).toBe(14);
  expect(r.longMandatoryStraightRatio).toBe(1);
  expect(r.routeForks).toBe(0);
});
test('a long perspective with real side choices is not a long mandatory straight', () => {
  const m = emptyMaze({ columns: 7, rows: 2, corridorWidth: 2, algorithm: 'prim', seed: 'choices', extraConnections: 0 });
  for (let i = 0; i < 6; i++)
    connect(m, i, i + 1);
  for (let i = 0; i < 7; i++)
    connect(m, i, i + 7);
  m.exit = { cell: 6, side: 'east' };
  const r = corridorQuality(m, 8);
  expect(r.longestVisibleStraight).toBeGreaterThanOrEqual(12);
  expect(r.longestMandatoryForcedStraight).toBe(3);
  expect(r.longMandatoryStraightRatio).toBe(0);
  expect(r.routeForks).toBe(6);
});
test('turns split straight runs but not a corridor without decisions', () => {
  const m = emptyMaze({ columns: 3, rows: 3, corridorWidth: 2, algorithm: 'prim', seed: 'turns', extraConnections: 0 }), path = [0, 1, 2, 5, 4, 3, 6, 7, 8];
  for (let i = 1; i < path.length; i++)
    connect(m, path[i - 1]!, path[i]!);
  const r = corridorQuality(m, 8);
  expect(r.longestMandatoryForcedRun).toBe(18);
  expect(r.longestMandatoryForcedStraight).toBe(5);
  expect(() => corridorQuality(m, NaN)).toThrow();
});

test('a long blind side branch is checked even when the correct route has frequent decisions',()=>{
 const m=emptyMaze({columns:7,rows:3,corridorWidth:2,algorithm:'prim',seed:'side-run',extraConnections:0});
 for(let i=7;i<13;i++)connect(m,i,i+1);for(let i=0;i<7;i++)connect(m,i,i+7);connect(m,7,14);for(let i=14;i<20;i++)connect(m,i,i+1);m.entrance={cell:7,side:'west'};m.exit={cell:13,side:'east'};
 const r=corridorQuality(m,8);expect(r.longestMandatoryForcedStraight).toBe(3);expect(r.longestForcedStraight).toBe(12);
});
