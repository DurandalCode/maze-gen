import { domainOf, validateShape, type GridShape } from './domain';
import {LIMIT_KEYS,type LimitKey} from './design-limits';
import type { Environment } from './environment';

export type Algorithm = 'backtracker' | 'prim';
export type GenerationType = 'classical' | 'living';
export const generationName=(p:Parameters)=>p.generationType==='living'?'Живой':'Классический';
export interface DesignLimits {
  disabledLimits?:LimitKey[];
  maxForcedStraight:number; maxForcedRun:number; maxVisibleStraight:number;
  maxColdRatio:number; maxColdRegion:number;
  /** Optional bound for cyclic designs; absent keeps the legacy feasibility contract. */
  maxUnavoidableRouteRatio?:number;
  allowReshape:boolean; maxModuleGrowth:number;
}
export const DEFAULT_DESIGN_LIMITS:Readonly<DesignLimits>={maxForcedStraight:8,maxForcedRun:16,maxVisibleStraight:12,maxColdRatio:.12,maxColdRegion:16,allowReshape:false,maxModuleGrowth:.25};
export interface Parameters {
  generationType?:GenerationType;
  design?:DesignLimits;
  /** Requested minimum number of distinct directional-trap forks; absent means zero. */
  routeTrapCount?: number;
  loopTrapCount?: number;
  shape?: GridShape;
  columns: number;
  rows: number;
  corridorWidth: number;
  /** Present for separate square modules; absent in legacy continuous-grid files. */
  moduleSize?: number;
  extraConnections: number;
  seed: string;
  algorithm: Algorithm;
}
export interface Portal { cell: number; side: 'north' | 'south' | 'east' | 'west' }
export interface Construction {
  wallHeight: number;
  wallColor: string;
  translucentFabric: boolean;
  roof: boolean;
}
export const DEFAULT_CONSTRUCTION: Readonly<Construction> = {
  wallHeight: 2.5, wallColor: '#000000', translucentFabric: true, roof: false,
};
export function validateConstruction(value: Construction): void {
  if (!Number.isFinite(value.wallHeight) || value.wallHeight < 1.8 || value.wallHeight > 10)
    throw new Error('Высота стен должна быть от 1,8 до 10 м.');
  if (typeof value.wallColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.wallColor))
    throw new Error('Цвет стен должен быть в формате #RRGGBB.');
  if (typeof value.translucentFabric !== 'boolean') throw new Error('Режим просвечивающей ткани должен быть логическим значением.');
  if (typeof value.roof !== 'boolean') throw new Error('Параметр крыши должен быть логическим значением.');
}
export interface Maze extends Construction {
  version: 1 | 2 | 3;
  parameters: Parameters;
  width: number;
  depth: number;
  /** Each adjacency list holds the cells connected by an open passage. */
  passages: number[][];
  entrance: Portal;
  exit: Portal;
  /** All placed openings; entrance/exit select the current traversal pair. */
  portals?: Portal[];
  environment?: Environment;
}
export interface Point { x: number; z: number }
export interface Wall { x1: number; z1: number; x2: number; z2: number; thickness?: number }
export const WALL_THICKNESS = 0.06;

export function validateParameters(p: Parameters): void {
  if(p.generationType!==undefined&&p.generationType!=='classical'&&p.generationType!=='living')throw new Error('Неизвестный тип генерации.');
  if(p.design!==undefined){
    const d=p.design;
    if(!d||typeof d!=='object'||typeof d.allowReshape!=='boolean')throw new Error('Некорректные ограничения качества.');
    if(d.disabledLimits!==undefined&&(!Array.isArray(d.disabledLimits)||new Set(d.disabledLimits).size!==d.disabledLimits.length||d.disabledLimits.some(k=>!LIMIT_KEYS.includes(k))))throw new Error('Некорректные переключатели ограничений.');
    if(d.maxUnavoidableRouteRatio!==undefined&&(!Number.isFinite(d.maxUnavoidableRouteRatio)||d.maxUnavoidableRouteRatio<0||d.maxUnavoidableRouteRatio>1))throw new Error('Доля маршрута без обхода должна быть от 0 до 100%.');
    for(const [key,min,max] of [['maxForcedStraight',2,40],['maxForcedRun',2,100],['maxVisibleStraight',2,24],['maxColdRatio',0,1],['maxColdRegion',0,10000],['maxModuleGrowth',0,1]] as const)
      if(!Number.isFinite(d[key])||d[key]<min||d[key]>max)throw new Error('Некорректные ограничения качества.');
  }
  if(p.loopTrapCount!==undefined&&(!Number.isInteger(p.loopTrapCount)||p.loopTrapCount<0||p.loopTrapCount>6))throw new Error('Число кольцевых ловушек должно быть целым от 0 до 6.');
  if((p.loopTrapCount??0)>p.extraConnections)throw new Error('Для каждой кольцевой ловушки нужно хотя бы одно дополнительное соединение.');
  if(p.routeTrapCount!==undefined&&(!Number.isInteger(p.routeTrapCount)||p.routeTrapCount<0||p.routeTrapCount>6))throw new Error('Число ловушек должно быть целым от 0 до 6.');
  if (!Number.isInteger(p.columns) || !Number.isInteger(p.rows) || p.columns < 1 || p.rows < 1 || p.columns > 100 || p.rows > 100)
    throw new Error('Размер сетки должен быть целым числом от 1 до 100.');
  if (!Number.isFinite(p.corridorWidth) || p.corridorWidth < 0.8 || p.corridorWidth > 10)
    throw new Error('Ширина коридора должна быть от 0,8 до 10 м.');
  if (p.moduleSize !== undefined && (!Number.isFinite(p.moduleSize) || p.moduleSize < 0.8 || p.moduleSize > 10))
    throw new Error('Размер модуля должен быть от 0,8 до 10 м.');
  if (!Number.isInteger(p.extraConnections) || p.extraConnections < 0 || p.extraConnections > 20000)
    throw new Error('Число дополнительных соединений: от 0 до 20000.');
  if (typeof p.seed !== 'string' || p.seed.length > 256) throw new Error('Seed должен содержать до 256 символов.');
  if (p.algorithm !== 'backtracker' && p.algorithm !== 'prim') throw new Error('Неизвестный алгоритм.');
  validateShape(p);
}

export function emptyMaze(parameters: Parameters, version: 1 | 2 | 3 = parameters.shape ? 3 : parameters.moduleSize === undefined ? 1 : 2): Maze {
  validateParameters(parameters);
  if ((version === 3) !== (parameters.shape !== undefined)) throw new Error('Версия формата не соответствует форме лабиринта.');
  const p = structuredClone(parameters);
  const legacy = version === 1 && p.moduleSize !== undefined;
  const columns = p.moduleSize === undefined ? p.columns : p.columns * 2 + (legacy ? 1 : -1);
  const rows = p.moduleSize === undefined ? p.rows : p.rows * 2 + (legacy ? 1 : -1);
  const maze: Maze = {
    version, parameters: p,
    width: p.moduleSize === undefined ? p.columns * p.corridorWidth : p.columns * p.moduleSize + (p.columns+(legacy ? 1 : -1)) * p.corridorWidth,
    depth: p.moduleSize === undefined ? p.rows * p.corridorWidth : p.rows * p.moduleSize + (p.rows+(legacy ? 1 : -1)) * p.corridorWidth,
    ...DEFAULT_CONSTRUCTION,
    passages: Array.from({ length: columns * rows }, () => []),
    entrance: { cell: legacy ? columns : 0, side: 'west' },
    exit: { cell: legacy ? (rows-2)*columns+columns-1 : columns * rows - 1, side: 'east' },
  };
  if (p.shape) {
    const cells = domainOf(maze).cells;
    maze.entrance = { cell: cells[0]!, side: 'west' };
    maze.exit = { cell: cells[cells.length-1]!, side: 'east' };
  }
  return maze;
}

export function routingSize(maze: Maze): { columns: number; rows: number } {
  const p = maze.parameters;
  const offset = maze.version === 1 ? 1 : -1;
  return p.moduleSize === undefined ? { columns: p.columns, rows: p.rows } : { columns: p.columns*2+offset, rows: p.rows*2+offset };
}

export function axisBounds(maze: Maze, axis: 'x' | 'z'): number[] {
  const p = maze.parameters, count = routingSize(maze)[axis === 'x' ? 'columns' : 'rows'];
  const result = [0];
  const moduleParity = maze.version === 1 ? 1 : 0;
  for (let i = 0; i < count; i++) result.push(result[i]! + (p.moduleSize !== undefined && i%2 === moduleParity ? p.moduleSize : p.corridorWidth));
  return result;
}

export function cellSize(maze: Maze, cell: number): { width: number; depth: number } {
  const x = cell % routingSize(maze).columns, z = Math.floor(cell/routingSize(maze).columns);
  const p = maze.parameters;
  const moduleParity = maze.version === 1 ? 1 : 0;
  return {
    width: p.moduleSize !== undefined && x%2 === moduleParity ? p.moduleSize : p.corridorWidth,
    depth: p.moduleSize !== undefined && z%2 === moduleParity ? p.moduleSize : p.corridorWidth,
  };
}

export function neighbors(maze: Maze, cell: number): number[] {
  const { columns, rows } = routingSize(maze);
  if (!domainOf(maze).active[cell]) return [];
  const x = cell % columns, y = Math.floor(cell / columns);
  const result: number[] = [];
  if (x > 0) result.push(cell - 1);
  if (x < columns - 1) result.push(cell + 1);
  if (y > 0) result.push(cell - columns);
  if (y < rows - 1) result.push(cell + columns);
  return result.filter(n => domainOf(maze).active[n]);
}

export function connect(maze: Maze, a: number, b: number): void {
  if (!neighbors(maze, a).includes(b)) throw new Error('Соединение не соседних клеток.');
  if (!maze.passages[a]!.includes(b)) {
    maze.passages[a]!.push(b);
    maze.passages[b]!.push(a);
  }
}

export function cellCenter(maze: Maze, cell: number): Point {
  const { columns } = routingSize(maze), p = maze.parameters;
  const coordinate = (i: number) => {
    if (p.moduleSize === undefined) return (i+0.5)*p.corridorWidth;
    const start = Math.floor(i/2)*(p.moduleSize+p.corridorWidth);
    return start + (maze.version === 1
      ? (i%2 === 0 ? p.corridorWidth/2 : p.corridorWidth+p.moduleSize/2)
      : (i%2 === 0 ? p.moduleSize/2 : p.moduleSize+p.corridorWidth/2));
  };
  return { x: coordinate(cell%columns), z: coordinate(Math.floor(cell/columns)) };
}

export function portalPoint(maze: Maze, portal: Portal): Point {
  const center = cellCenter(maze, portal.cell), size = cellSize(maze, portal.cell);
  if (portal.side === 'west') center.x -= size.width/2;
  if (portal.side === 'east') center.x += size.width/2;
  if (portal.side === 'north') center.z -= size.depth/2;
  if (portal.side === 'south') center.z += size.depth/2;
  return center;
}

/** Unique segments shared by map, scene and collisions. */
export function walls(maze: Maze): Wall[] {
  const domain = domainOf(maze), result: Wall[] = [];
  const columns = routingSize(maze).columns;
  const isPortal = (p: Portal) => (maze.portals ?? [maze.entrance, maze.exit]).some(q => q.cell === p.cell && q.side === p.side);
  for (const edge of domain.boundary) if (!isPortal(edge.portal)) result.push(edge.wall);
  for (const a of domain.cells) for (const b of neighbors(maze, a)) {
    if (b <= a || maze.passages[a]!.includes(b)) continue;
    const rect = domain.rectangles[a]!;
    result.push(Math.floor(a/columns) === Math.floor(b/columns)
      ? { x1: rect.x2, z1: rect.z1, x2: rect.x2, z2: rect.z2 }
      : { x1: rect.x1, z1: rect.z2, x2: rect.x2, z2: rect.z2 });
  }
  return result;
}
