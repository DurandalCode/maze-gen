import {storeyDomain} from './two-storey';
import {freeDomain} from '../free/layout';
import {walkableContains,mm} from './corridor-geometry';
import { axisBounds, routingSize, type Maze, type Parameters, type Point, type Portal, type Wall } from './maze';
export interface ShapeRectangle {
  x: number;
  z: number;
  width: number;
  height: number;
  operation: 'add' | 'subtract';
}
export interface GridShape {
  kind: 'grid-rectangles';
  rectangles: ShapeRectangle[];
}
export interface CellRectangle {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}
export interface BoundaryEdge {
  portal: Portal;
  wall: Wall;
}
export interface Domain {
  active: Uint8Array;
  cells: number[];
  modules: Uint8Array;
  rectangles: (CellRectangle | undefined)[];
  boundary: BoundaryEdge[];
  area: number;
  contains(point: Point): boolean;
  constrain(from: Point, to: Point): Point;
}
export function shapeMask(p: Parameters): Uint8Array {
  const mask = new Uint8Array(p.columns * p.rows);
  if (p.shape === undefined)
    return mask.fill(1);
  if (!p.shape || typeof p.shape !== 'object' || Array.isArray(p.shape) || p.shape.kind !== 'grid-rectangles' || !Array.isArray(p.shape.rectangles))
    throw new Error('Некорректное описание формы.');
  for (const r of p.shape.rectangles) {
    if (!r || ![r.x, r.z, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.z < 0 || r.width < 1 || r.height < 1 || r.x + r.width > p.columns || r.z + r.height > p.rows || !['add', 'subtract'].includes(r.operation))
      throw new Error('Прямоугольник должен иметь целые размеры и находиться внутри рабочей сетки.');
  }
  for (const operation of ['add', 'subtract'] as const)
    for (const r of p.shape.rectangles)
      if (r.operation === operation)
        for (let z = r.z; z < r.z + r.height; z++)
          for (let x = r.x; x < r.x + r.width; x++)
            mask[z * p.columns + x] = operation === 'add' ? 1 : 0;
  return mask;
}
export function validateShape(p: Parameters): void {
  if (p.shape === undefined)
    return;
  const mask = shapeMask(p), first = mask.indexOf(1);
  if (first < 0)
    throw new Error('Форма пуста. Добавьте область.');
  const seen = new Uint8Array(mask.length), queue = [first];
  seen[first] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!, x = cell % p.columns, z = Math.floor(cell / p.columns);
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
      if (nx! < 0 || nx! >= p.columns || nz! < 0 || nz! >= p.rows)
        continue;
      const n = nz! * p.columns + nx!;
      if (mask[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  if (queue.length !== mask.reduce((a, b) => a + b, 0))
    throw new Error('Форма должна быть связной по сторонам. Отдельные острова и касание углами недопустимы.');
}
const cache = new WeakMap<Parameters, Map<number, Domain>>();
const corridorCache=new WeakMap<object,Domain>();
/** Grid placement adapter. Consumers use world geometry rather than editor rectangles. */
export function domainOf(maze: Maze): Domain {
  if((maze.version===5||maze.version===7))return freeDomain(maze);
  if(maze.storeys)return storeyDomain(maze);
  if(maze.navigation)return maze.navigation.domain;
  if(maze.version===4&&corridorCache.has(maze.layout!))return corridorCache.get(maze.layout!)!;
  let versions = cache.get(maze.parameters);
  if (!versions) {
    versions = new Map();
    cache.set(maze.parameters, versions);
  }
  const found = versions.get(maze.version);
  if (found&&maze.version!==4)
    return found;
  const p = maze.parameters, modules = maze.version===4?new Uint8Array(maze.layout!.modules.length).fill(1):shapeMask(p), { columns: w, rows: h } = routingSize(maze);
  const active = new Uint8Array(w * h), cells: number[] = [], rectangles: Domain['rectangles'] = [];
  const xs = axisBounds(maze, 'x'), zs = axisBounds(maze, 'z');
  const included = (x: number, z: number) => x >= 0 && z >= 0 && x < p.columns && z < p.rows && !!modules[z * p.columns + x];
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      let on = true;
      if(maze.version===4)on=walkableContains(maze,mm((xs[x]!+xs[x+1]!)/2),mm((zs[z]!+zs[z+1]!)/2));
      else if (p.shape) {
        if (p.moduleSize === undefined)
          on = included(x, z);
        else {
          const mx = Math.floor(x / 2), mz = Math.floor(z / 2);
          on = included(mx, mz) && (!(x % 2) || included(mx + 1, mz)) && (!(z % 2) || included(mx, mz + 1)) && (!(x % 2 && z % 2) || included(mx + 1, mz + 1));
        }
      }
      if (on) {
        const i = z * w + x;
        active[i] = 1;
        cells.push(i);
        rectangles[i] = { x1: xs[x]!, z1: zs[z]!, x2: xs[x + 1]!, z2: zs[z + 1]! };
      }
    }
  const boundary: BoundaryEdge[] = [];
  let area = 0;
  for (const cell of cells) {
    const x = cell % w, z = Math.floor(cell / w), r = rectangles[cell]!;
    area += (r.x2 - r.x1) * (r.z2 - r.z1);
    const sides: [
      Portal['side'],
      boolean,
      Wall
    ][] = [
      ['west', x === 0 || !active[cell - 1], { x1: r.x1, z1: r.z1, x2: r.x1, z2: r.z2 }],
      ['east', x === w - 1 || !active[cell + 1], { x1: r.x2, z1: r.z1, x2: r.x2, z2: r.z2 }],
      ['north', z === 0 || !active[cell - w], { x1: r.x1, z1: r.z1, x2: r.x2, z2: r.z1 }],
      ['south', z === h - 1 || !active[cell + w], { x1: r.x1, z1: r.z2, x2: r.x2, z2: r.z2 }],
    ];
    for (const [side, isBoundary, wall] of sides)
      if (isBoundary)
        boundary.push({ portal: { cell, side }, wall });
  }
  const axisIndex = (values: number[], v: number) => {
    let lo = 0, hi = values.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[mid]! < v - 1e-9)
        lo = mid + 1;
      else
        hi = mid;
    }
    return lo;
  };
  const contains = (point: Point) => {
    const ix = axisIndex(xs, point.x), iz = axisIndex(zs, point.z);
    for (const x of [ix - 1, ix])
      for (const z of [iz - 1, iz]) {
        if (x < 0 || x >= w || z < 0 || z >= h)
          continue;
        const r = rectangles[z * w + x];
        if (r && point.x >= r.x1 - 1e-9 && point.x <= r.x2 + 1e-9 && point.z >= r.z1 - 1e-9 && point.z <= r.z2 + 1e-9)
          return true;
      }
    return false;
  };
  const domain: Domain = { active, cells, modules, rectangles, boundary, area, contains,
    constrain(from, to) {
      // Clip against every crossed boundary; endpoints at portals remain reachable.
      if (!p.shape)
        return { x: Math.max(0, Math.min(maze.width, to.x)), z: Math.max(0, Math.min(maze.depth, to.z)) };
      let t = 1;
      for (const { wall: r } of boundary) {
        const dx = to.x - from.x, dz = to.z - from.z;
        if (r.x1 === r.x2 && Math.abs(dx) > 1e-12) {
          const v = (r.x1 - from.x) / dx, z = from.z + v * dz;
          if (v >= -1e-9 && v < t && z > Math.min(r.z1, r.z2) + 1e-9 && z < Math.max(r.z1, r.z2) - 1e-9) {
            const after = { x: from.x + (v + 1e-4) * dx, z: from.z + (v + 1e-4) * dz };
            if (!contains(after))
              t = Math.max(0, v);
          }
        }
        else if (r.z1 === r.z2 && Math.abs(dz) > 1e-12) {
          const v = (r.z1 - from.z) / dz, x = from.x + v * dx;
          if (v >= -1e-9 && v < t && x > Math.min(r.x1, r.x2) + 1e-9 && x < Math.max(r.x1, r.x2) - 1e-9) {
            if (!contains({ x: from.x + (v + 1e-4) * dx, z: from.z + (v + 1e-4) * dz }))
              t = Math.max(0, v);
          }
        }
      }
      const result = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      return contains(result) ? result : { ...from };
    } };
  if(maze.version===4)corridorCache.set(maze.layout!,domain);
  else versions.set(maze.version, domain);
  return domain;
}
