import type { Maze, Point } from '../core/maze';
import { environmentOf, forestMapPoints, sunDirection } from '../core/environment';
import type { LandmarkVisibility } from '../analysis/visibility';
import { freeRuntime, anchorGeometry, siteGeometry } from './layout';
import { freeAreaWeights } from './analysis-geometry';
import { distance, rayWall } from './geometry';
/** Same cue thresholds as legacy analysis, traced against oriented physical walls. */
export function freeLandmarks(maze: Maze): LandmarkVisibility {
  const r = freeRuntime(maze), weights = freeAreaWeights(maze), sun = new Float64Array(r.rooms.length), forest = new Float64Array(r.rooms.length), boundary = new Float64Array(r.rooms.length), direction = sunDirection(environmentOf(maze)), daylight = Math.max(0, Math.min(1, direction.y * 4)), reach = Math.hypot(maze.width, maze.depth) * 2 + 100, forestPoints = forestMapPoints(maze), site = siteGeometry(maze.parameters);
  const trace = (from: Point, to: Point, height: number, source: 'sun' | 'forest') => {
    const length = distance(from, to), angle = Math.atan2(to.z - from.z, to.x - from.x), dy = height - 1.7;
    let strength = 1;
    if (maze.roof && dy > 0) {
      const t = (maze.wallHeight - 1.7) / dy;
      if (t >= 0 && t <= 1 && r.contains({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t })) {
        if (!maze.translucentFabric || source === 'forest') return 0;
        strength = .55;
      }
    }
    for (const wall of r.panels) {
      const hit = rayWall(from, angle, wall, length);
      if (hit < length - 1e-7 && 1.7 + dy * hit / length <= maze.wallHeight + 1e-9) {
        if (!maze.translucentFabric || source === 'forest') return 0;
        strength *= .35;
        if (strength < .2) return 0;
      }
    }
    return strength;
  };
  for (let i = 0; i < r.rooms.length; i++) {
    const p = r.centers[i]!;
    if (daylight > 0) {
      sun[i] = trace(p, { x: p.x + direction.x * reach, z: p.z + direction.z * reach }, 1.7 + direction.y * reach, 'sun');
      for (const t of [0, .5, 1]) {
        const a = forestPoints[0]!, b = forestPoints[1]!, target = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, strength = daylight * Math.exp(-distance(p, target) / 120) * trace(p, target, 12, 'forest');
        if (strength >= .2) forest[i] = Math.max(forest[i]!, strength * .8);
      }
    }
    for (const o of maze.free!.openings.filter(o => o.room === r.rooms[i]!.id)) {
      const g = anchorGeometry(maze.free!, o, o.width), outside = { x: g.mid.x + g.normal.x * .1, z: g.mid.z + g.normal.z * .1 };
      if (!site.contains(outside)) boundary[i] = daylight * .85;
    }
  }
  const total = weights.reduce((a, b) => a + b, 0), ratio = (test: (i: number) => boolean) => weights.reduce((n, w, i) => n + (test(i) ? w : 0), 0) / total;
  return { sun, forest, boundary, sunAreaRatio: ratio(i => sun[i]! >= .2), forestAreaRatio: ratio(i => forest[i]! >= .2), boundaryAreaRatio: ratio(i => boundary[i]! >= .2), orientedAreaRatio: ratio(i => Math.max(sun[i]!, forest[i]!, boundary[i]!) >= .2) };
}
