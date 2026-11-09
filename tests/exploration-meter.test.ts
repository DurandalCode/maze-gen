import { expect, test } from 'bun:test';
import { emptyMaze, connect } from '../src/core/maze';
import { explorationMeter } from '../src/analysis/exploration-meter';
import { analyzeColdspots, DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
function fixture() { const m = emptyMaze({ columns: 3, rows: 2, corridorWidth: 2, algorithm: 'prim', seed: 'observer', extraConnections: 0 }); for (const [a, b] of [[0, 1], [1, 2], [1, 4], [4, 3], [4, 5]])
  connect(m, a!, b!); m.entrance = { cell: 0, side: 'west' }; m.exit = { cell: 2, side: 'east' }; return m; }
test('simulation observer measures the same first detour and branch depth as a trace', () => {
  const meter = explorationMeter(fixture())!;
  meter.begin();
  meter.enter(0, 1);
  meter.enter(1, 4);
  meter.enter(4, 3);
  meter.enter(1, 2);
  meter.finish();
  const r = meter.summary();
  expect(r.firstDetourRate).toBe(1);
  expect(r.expectedEnteredBranches).toBe(1);
  expect(r.expectedDeepBranches).toBe(0);
  expect(r.meanBranchDepth).toBe(4);
  expect(r.medianBranchDepth).toBe(4);
});
test('replaying a known branch does not inflate unique-depth metrics', () => {
  const meter = explorationMeter(fixture())!;
  meter.begin();
  meter.enter(0, 1);
  meter.enter(1, 4);
  meter.enter(4, 3);
  meter.enter(1, 4);
  meter.enter(4, 3);
  meter.enter(1, 2);
  meter.finish();
  expect(meter.summary().expectedEnteredBranches).toBe(1);
  expect(meter.summary().meanBranchDepth).toBe(4);
});
test('both directed search and exact explorer provide pre-walk depth forecasts', () => {
  const m = fixture();
  for (const profile of ['outline', 'explorer'] as const) {
    const r = analyzeColdspots(m, { ...DEFAULT_ANALYSIS, profile, samples: 32 });
    expect(r.explorationForecast).toBeDefined();
    expect(r.explorationForecast!.firstDetourRate).toBeGreaterThanOrEqual(0);
    expect(r.explorationForecast!.firstDetourRate).toBeLessThanOrEqual(1);
    expect(r.explorationForecast!.expectedDeepBranches).toBe(0);
  }
});
