import { expect, test } from 'bun:test';
import { generate } from '../src/generators/generate';
import { measureLandmarks } from '../src/analysis/visibility';
import { prepareNavigation } from '../src/analysis/navigation';
import { analyzeColdspots, DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
import { domainOf } from '../src/core/domain';
function fixture() { return generate({ columns: 5, rows: 5, corridorWidth: 2, extraConnections: 0, algorithm: 'prim', seed: 'visibility' }); }
const perception = (maze: ReturnType<typeof fixture>) => measureLandmarks(maze, prepareNavigation(maze));
test('sun direction is blocked by opaque roofs and remains a weaker cue through woven roofs', () => {
  const base = fixture(), open = perception({ ...base, wallHeight: 1.8, roof: false });
  const opaque = perception({ ...base, roof: true, translucentFabric: false });
  const cloth = perception({ ...base, roof: true, translucentFabric: true });
  expect(open.sunAreaRatio).toBe(1);
  expect(opaque.sunAreaRatio).toBe(0);
  expect(cloth.sunAreaRatio).toBeGreaterThan(0);
  for (const cell of domainOf(base).cells) {
    expect(cloth.sun[cell]!).toBeLessThan(open.sun[cell]!);
    expect(cloth.sun[cell]!).toBeGreaterThan(0);
  }
});
test('recognizing an exposed boundary through fabric does not reveal internal walls or the entire contour', () => {
  const base = fixture(), opaque = perception({ ...base, translucentFabric: false }), cloth = perception({ ...base, translucentFabric: true });
  expect(cloth.boundaryAreaRatio).toBeGreaterThan(opaque.boundaryAreaRatio);
  expect(cloth.boundary[12]).toBe(0);
  expect(cloth.boundary[2]!).toBeGreaterThan(0);
  expect(opaque.boundary[2]).toBe(0); // North panel, away from the default west/east portals.
});
test('high walls occlude more solar directions and moving the forest far away removes the forest cue', () => {
  const base = fixture();
  const low = perception({ ...base, wallHeight: 1.8, translucentFabric: false }), high = perception({ ...base, wallHeight: 10, translucentFabric: false });
  expect(high.sunAreaRatio).toBeLessThan(low.sunAreaRatio);
  const far = perception({ ...base, environment: { sun: { day: 15, minutes: 780 }, forest: { side: 'north', distance: 100, offset: 2000 } } });
  expect(far.forestAreaRatio).toBe(0);
});
test('night removes sun, forest contrast and outside-fabric recognition instead of retaining an ideal compass', () => {
  const base = fixture(), night = { ...base, environment: { sun: { day: 15, minutes: 0 }, forest: { side: 'north' as const, distance: 12, offset: 0 } } };
  const visibility = perception(night);
  expect(visibility.sunAreaRatio).toBe(0);
  expect(visibility.forestAreaRatio).toBe(0);
  expect(visibility.boundaryAreaRatio).toBe(0);
  const day = analyzeColdspots(base,{...DEFAULT_ANALYSIS,internalOrientation:0}), dark = analyzeColdspots(night,{...DEFAULT_ANALYSIS,internalOrientation:0});
  expect(Array.from(dark.probability)).not.toEqual(Array.from(day.probability));
});
test('turning cues off does not alter the explorer profile', () => {
  const base = fixture(), dark = { ...base, roof: true, translucentFabric: false, environment: { sun: { day: 15, minutes: 0 }, forest: { side: 'north' as const, distance: 12, offset: 0 } } };
  const options = { ...DEFAULT_ANALYSIS, profile: 'explorer' as const };
  expect(analyzeColdspots(base, options)).toEqual(analyzeColdspots(dark, options));
});
