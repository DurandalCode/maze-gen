import type { Bounds } from './predicates';
import { boundsOverlap } from './predicates';
export interface SpatialIndex {
  cellSize: number;
  cells: Record<string, number[]>;
  bounds: Bounds[];
  overflow: number[];
}
export function buildSpatialIndex(items: Bounds[], cellSize = 2): SpatialIndex {
  const cells: Record<string, number[]> = {},
    overflow: number[] = [];
  items.forEach((b, id) => {
    const nx = Math.floor(b.maxX / cellSize) - Math.floor(b.minX / cellSize) + 1,
      nz = Math.floor(b.maxZ / cellSize) - Math.floor(b.minZ / cellSize) + 1;
    if (nx * nz > 4096) {
      overflow.push(id);
      return;
    }
    for (let x = Math.floor(b.minX / cellSize); x <= Math.floor(b.maxX / cellSize); x++)
      for (let z = Math.floor(b.minZ / cellSize); z <= Math.floor(b.maxZ / cellSize); z++)
        (cells[`${x},${z}`] ??= []).push(id);
  });
  return { cellSize, cells, bounds: items, overflow };
}
export function querySpatialIndex(index: SpatialIndex, area: Bounds): number[] {
  const nx = Math.floor(area.maxX / index.cellSize) - Math.floor(area.minX / index.cellSize) + 1,
    nz = Math.floor(area.maxZ / index.cellSize) - Math.floor(area.minZ / index.cellSize) + 1;
  if (nx * nz > 65536) return index.bounds.flatMap((b, id) => (boundsOverlap(b, area) ? [id] : []));
  const found = new Set<number>(
    index.overflow.filter((id) => boundsOverlap(index.bounds[id]!, area)),
  );
  for (
    let x = Math.floor(area.minX / index.cellSize);
    x <= Math.floor(area.maxX / index.cellSize);
    x++
  )
    for (
      let z = Math.floor(area.minZ / index.cellSize);
      z <= Math.floor(area.maxZ / index.cellSize);
      z++
    )
      for (const id of index.cells[`${x},${z}`] ?? [])
        if (boundsOverlap(index.bounds[id]!, area)) found.add(id);
  return [...found].sort((a, b) => a - b);
}
