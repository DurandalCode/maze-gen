import { kernel } from '../geometry/kernel/boolean';
import type { MultiPolygon, Polygon } from '../geometry/kernel/contour';
import { bounds } from '../geometry/predicates';
export interface WalkableTiles {
  area: MultiPolygon;
  tiles: Map<string, MultiPolygon> | null;
}
function localArea(floor: MultiPolygon, obstacles: MultiPolygon, radius: number): MultiPolygon {
  const tolerance = 0.001,
    distance = radius + tolerance + 1e-6;
  return kernel.boolean(
    'difference',
    kernel.offset(floor, -distance, tolerance),
    kernel.offset(obstacles, distance, tolerance),
  );
}
export function walkableTiles(
  floor: MultiPolygon,
  obstacles: MultiPolygon,
  radius: number,
): WalkableTiles {
  if (!floor.length) return { area: [], tiles: null };
  const box = bounds(floor.flatMap((p) => p[0]!));
  if (Math.max(box.maxX - box.minX, box.maxZ - box.minZ) <= 12)
    return { area: localArea(floor, obstacles, radius), tiles: null };
  // The halo exceeds every offset radius, so artificial clipping boundaries cannot
  // influence centers in the inner tile. Coordinates stay on the same global grid.
  const halo = 2 * radius + 0.01,
    preparedFloor = kernel.prepare(floor),
    preparedObstacles = kernel.prepare(obstacles),
    tiles = new Map<string, MultiPolygon>(),
    pieces: MultiPolygon = [];
  for (let x = Math.floor(box.minX / 10); x < Math.ceil(box.maxX / 10); x++)
    for (let z = Math.floor(box.minZ / 10); z < Math.ceil(box.maxZ / 10); z++) {
      const rectangle = (padding: number): Polygon => [
        [
          { x: x * 10 - padding, z: z * 10 - padding },
          { x: (x + 1) * 10 + padding, z: z * 10 - padding },
          { x: (x + 1) * 10 + padding, z: (z + 1) * 10 + padding },
          { x: x * 10 - padding, z: (z + 1) * 10 + padding },
        ],
      ];
      const outer = rectangle(halo),
        inner = rectangle(0),
        localFloor = kernel.boolean('intersection', preparedFloor, [outer]),
        localObstacles = kernel.boolean('intersection', preparedObstacles, [outer]);
      const tile = kernel.boolean('intersection', localArea(localFloor, localObstacles, radius), [
        inner,
      ]);
      tiles.set(`${x},${z}`, tile);
      pieces.push(...tile);
    }
  const area = pieces.length
    ? kernel.boolean('union', [pieces[0]!], ...pieces.slice(1).map((p) => [p]))
    : [];
  return { area, tiles };
}
export function walkableArea(
  floor: MultiPolygon,
  obstacles: MultiPolygon,
  radius: number,
): MultiPolygon {
  return walkableTiles(floor, obstacles, radius).area;
}
