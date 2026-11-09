import { domainOf } from '../core/domain';
import { environmentOf, forestMapPoints, sunDirection } from '../core/environment';
import { axisBounds, routingSize, walls, type Maze, type Point } from '../core/maze';
import type { NavigationContext } from './navigation';
export interface LandmarkVisibility {
  sun: Float64Array;
  forest: Float64Array;
  boundary: Float64Array;
  sunAreaRatio: number;
  forestAreaRatio: number;
  boundaryAreaRatio: number;
  orientedAreaRatio: number;
}
const cache = new WeakMap<Maze, LandmarkVisibility>();
const EYE_HEIGHT = 1.7;
/** Geometric cue approximation, not a reproduction of shader pixels or human visual thresholds. */
export function measureLandmarks(maze: Maze, context: NavigationContext): LandmarkVisibility {
  const existing = cache.get(maze);
  if (existing)
    return existing;
  const domain = domainOf(maze), { columns, rows } = routingSize(maze), size = maze.passages.length;
  const sun = new Float64Array(size), forest = new Float64Array(size), boundary = new Float64Array(size);
  const xs = axisBounds(maze, 'x'), zs = axisBounds(maze, 'z');
  const xi = new Map(xs.map((v, i) => [v, i])), zi = new Map(zs.map((v, i) => [v, i]));
  const panels = new Uint8Array(size);
  for (const wall of walls(maze)) {
    const x = xi.get(wall.x1)!, z = zi.get(wall.z1)!;
    if (wall.x1 === wall.x2) {
      if (x < columns)
        panels[z * columns + x] = panels[z * columns + x]! | 1;
      if (x > 0)
        panels[z * columns + x - 1] = panels[z * columns + x - 1]! | 2;
    }
    else {
      if (z < rows)
        panels[z * columns + x] = panels[z * columns + x]! | 4;
      if (z > 0)
        panels[(z - 1) * columns + x] = panels[(z - 1) * columns + x]! | 8;
    }
  }
  const direction = sunDirection(environmentOf(maze)), daylight = Math.max(0, Math.min(1, direction.y * 4));
  const trace = (cell: number, to: Point, targetHeight: number, source: 'sun' | 'forest') => {
    const from = context.centers[cell]!, dx = to.x - from.x, dz = to.z - from.z, dy = targetHeight - EYE_HEIGHT;
    let strength = 1;
    if (maze.roof && dy > 0) {
      const t = (maze.wallHeight - EYE_HEIGHT) / dy;
      if (t >= 0 && t <= 1 && domain.contains({ x: from.x + dx * t, z: from.z + dz * t })) {
        if (!maze.translucentFabric || source === 'forest')
          return 0;
        // The current fabric roof scatters a directional source spot, but conceals scenery.
        strength = 0.55;
      }
    }
    let x = cell % columns, z = Math.floor(cell / columns);
    const sx = Math.sign(dx), sz = Math.sign(dz);
    for (let step = 0; step <= columns + rows; step++) {
      const tx = sx ? (xs[x + (sx > 0 ? 1 : 0)]! - from.x) / dx : Infinity;
      const tz = sz ? (zs[z + (sz > 0 ? 1 : 0)]! - from.z) / dz : Infinity;
      const t = Math.min(tx, tz);
      if (t > 1 || !Number.isFinite(t))
        break;
      const crossX = tx <= tz + 1e-10, crossZ = tz <= tx + 1e-10, height = EYE_HEIGHT + dy * t;
      const bits = panels[z * columns + x]!;
      const hitX = crossX && !!(bits & (sx > 0 ? 2 : 1)), hitZ = crossZ && !!(bits & (sz > 0 ? 8 : 4));
      if (height <= maze.wallHeight + 1e-9 && (hitX || hitZ)) {
        if (!maze.translucentFabric || source === 'forest')
          return 0;
        // A bright source can remain directional through one backlit fabric panel.
        strength *= 0.35;
        if (strength < 0.2)
          return 0;
      }
      if (crossX)
        x += sx;
      if (crossZ)
        z += sz;
      if (x < 0 || x >= columns || z < 0 || z >= rows)
        break;
    }
    return strength;
  };
  const forestPoints = forestMapPoints(maze), nearA = forestPoints[0]!, nearB = forestPoints[1]!;
  const targets = [0, 0.5, 1].map(t => ({ x: nearA.x + (nearB.x - nearA.x) * t, z: nearA.z + (nearB.z - nearA.z) * t }));
  const reach = Math.hypot(maze.width, maze.depth) * 2 + 100;
  if (daylight > 0)
    for (const cell of context.cells) {
      const point = context.centers[cell]!;
      sun[cell] = trace(cell, { x: point.x + direction.x * reach, z: point.z + direction.z * reach }, EYE_HEIGHT + direction.y * reach, 'sun');
      for (const target of targets) {
        // The rendered forest starts at 12m tree height. Use a conservative canopy sample.
        const range = Math.hypot(target.x - point.x, target.z - point.z), strength = daylight * Math.exp(-range / 120) * trace(cell, target, 12, 'forest');
        if (strength >= 0.2)
          forest[cell] = Math.max(forest[cell]!, strength * 0.8);
      }
    }
  const portals = new Set((maze.portals ?? [maze.entrance, maze.exit]).map(p => `${p.cell}:${p.side}`));
  for (const edge of domain.boundary) {
    // Only an exposed local envelope panel is recognizable; internal fabric does not reveal a full map.
    const open = portals.has(`${edge.portal.cell}:${edge.portal.side}`);
    if (open || maze.translucentFabric)
      boundary[edge.portal.cell] = Math.max(boundary[edge.portal.cell]!, daylight * (open ? 0.85 : 0.6));
  }
  let sunArea = 0, forestArea = 0, boundaryArea = 0, orientedArea = 0;
  for (const cell of context.cells) {
    const r = domain.rectangles[cell]!, area = (r.x2 - r.x1) * (r.z2 - r.z1);
    if (sun[cell]! >= 0.2)
      sunArea += area;
    if (forest[cell]! >= 0.2)
      forestArea += area;
    if (boundary[cell]! >= 0.2)
      boundaryArea += area;
    if (Math.max(sun[cell]!, forest[cell]!, boundary[cell]!) >= 0.2)
      orientedArea += area;
  }
  const result = { sun, forest, boundary, sunAreaRatio: sunArea / domain.area, forestAreaRatio: forestArea / domain.area,
    boundaryAreaRatio: boundaryArea / domain.area, orientedAreaRatio: orientedArea / domain.area };
  cache.set(maze, result);
  return result;
}
