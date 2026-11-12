import {bridgeGeometry,bridgeUprights} from '../free/bridges';
import {storeyWalls,nodePoint,twoStoreyParameters,type TwoStoreyLayout} from './two-storey';
import type {FreeLayout} from '../free/model';
import {freeRuntime,freeDomain,freePortal} from '../free/layout';
import {corridorPortalWall} from './corridor-portals';
import {originalPortalPoint,type NavigationGeometry} from './corridor-navigation';
import {axisCuts,validateCorridorParameters,type CorridorLayout} from './corridor-geometry';
import { domainOf, validateShape, type GridShape } from './domain';
import {LIMIT_KEYS,type LimitKey} from './design-limits';
import type { Environment } from './environment';

export type Algorithm = 'backtracker' | 'prim';
export type GenerationType = 'classical' | 'living' | 'corridor' | 'two-storey';
export const generationName=(p:Parameters)=>p.freeRoutePattern==='vortex'?'Вортексный':p.generationType==='two-storey'?'Двухэтажный':p.generationType==='corridor'?'Коридорный':p.generationType==='living'?'Живой':'Классический';
export interface DesignLimits {
  /** Explicit bridge experiment: length bounds apply to continuous ground paths. */
  groundOnlyLengths?:boolean;
  disabledLimits?:LimitKey[];
  maxForcedStraight:number; maxForcedRun:number; maxVisibleStraight:number;
  maxColdRatio:number; maxColdRegion:number;
  /** Optional bound for cyclic designs; absent keeps the legacy feasibility contract. */
  maxUnavoidableRouteRatio?:number;
  /** Optional limit on the largest cold district with local route approaches. */
  maxColdSideRatio?:number;
  allowReshape:boolean; maxModuleGrowth:number;
}
export const DEFAULT_DESIGN_LIMITS:Readonly<DesignLimits>={maxForcedStraight:8,maxForcedRun:16,maxVisibleStraight:12,maxColdRatio:.12,maxColdRegion:16,allowReshape:false,maxModuleGrowth:.25};
export interface Parameters {
  placementMode?:'grid'|'free';
  freeAngleSpread?:number;
  freeJunctionDegree?:3|5;
  freeBridgeCount?:number;
  freeModuleTarget?:number;
  /** Target longest side of a newly grown free connector, in metres. */
  freeConnectionSpan?:number;
  /** Explicit maximum-spacing growth; absent preserves older seeded policies. */
  freeSpanPolicy?:'maximum';
  freeRoutePattern?:'organic'|'switchbacks'|'vortex';
  freeVortexCenter?:boolean;
  freeVortexChaotic?:boolean;
  freeVortexDeepRegions?:boolean;
  freeVortexContinuous?:boolean;
  freeVortexKnots?:boolean;
  /** Additional native crosslinks through suitable interior gaps, up to this budget. */
  freeInfillPassages?:number;
  /** Generate a seeded chamber maze inside organic negative spaces. */
  freeCavityMaze?:boolean;
  freeRequiredBridgeCount?:number;
  freeRequireUnderpass?:boolean;
  freeZoneCount?:number;
  freeIslandCount?:number;
  generationType?:GenerationType;
  design?:DesignLimits;
  /** Requested minimum number of distinct directional-trap forks; absent means zero. */
  routeTrapCount?: number;
  loopTrapCount?: number;
  shape?: GridShape;
  upperShape?: GridShape;
  minFloorChanges?: number;
  columns: number;
  rows: number;
  corridorWidth: number;
  /** Present for separate square modules; absent in legacy continuous-grid files. */
  moduleSize?: number;
  extraConnections: number;
  seed: string;
  algorithm: Algorithm;
}
export interface Portal { freeId?:string; cell: number; side: 'north' | 'south' | 'east' | 'west'; /** Explicit physical width for v4 boundary openings. */ width?:number }
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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  free?:FreeLayout;
  storeys?:TwoStoreyLayout;
  /** Transient construction projection: no frame members may obstruct a shaft. */
  shaftRects?:import('./domain').CellRectangle[];
  layout?:CorridorLayout;
  /** Transient semantic analysis adapter, never part of saved maps. */
  navigation?:NavigationGeometry;
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
export interface Point { bridge?:string; x: number; z: number; y?:number; floor?:number; stair?:number }
export interface Wall { bridge?:string; x1: number; z1: number; x2: number; z2: number; thickness?: number; y?:number; height?:number; floor?:number; stair?:number }
export const WALL_THICKNESS = 0.06;

export function validateParameters(p: Parameters): void {
  if(p.generationType!==undefined&&p.generationType!=='classical'&&p.generationType!=='living'&&p.generationType!=='corridor'&&p.generationType!=='two-storey')throw new Error('Неизвестный тип генерации.');
  if(p.design!==undefined){
    const d=p.design;
    if(!d||typeof d!=='object'||typeof d.allowReshape!=='boolean')throw new Error('Некорректные ограничения качества.');
    if(d.disabledLimits!==undefined&&(!Array.isArray(d.disabledLimits)||new Set(d.disabledLimits).size!==d.disabledLimits.length||d.disabledLimits.some(k=>!LIMIT_KEYS.includes(k))))throw new Error('Некорректные переключатели ограничений.');
    if(d.maxColdSideRatio!==undefined&&(!Number.isFinite(d.maxColdSideRatio)||d.maxColdSideRatio<0||d.maxColdSideRatio>1))throw Error('Доля холодного бокового района должна быть от 0 до 100%.');
    if(d.maxUnavoidableRouteRatio!==undefined&&(!Number.isFinite(d.maxUnavoidableRouteRatio)||d.maxUnavoidableRouteRatio<0||d.maxUnavoidableRouteRatio>1))throw new Error('Доля маршрута без обхода должна быть от 0 до 100%.');
    for(const [key,min,max] of [['maxForcedStraight',2,40],['maxForcedRun',2,100],['maxVisibleStraight',2,24],['maxColdRatio',0,1],['maxColdRegion',0,10000],['maxModuleGrowth',0,1]] as const)
      if(!Number.isFinite(d[key])||d[key]<min||d[key]>max)throw new Error('Некорректные ограничения качества.');
  }
  if(p.loopTrapCount!==undefined&&(!Number.isInteger(p.loopTrapCount)||p.loopTrapCount<0||p.loopTrapCount>6))throw new Error('Число кольцевых ловушек должно быть целым от 0 до 6.');
  if((p.loopTrapCount??0)>p.extraConnections)throw new Error('Для каждой кольцевой ловушки нужно хотя бы одно дополнительное соединение.');
  if(p.routeTrapCount!==undefined&&(!Number.isInteger(p.routeTrapCount)||p.routeTrapCount<0||p.routeTrapCount>6))throw new Error('Число ловушек должно быть целым от 0 до 6.');
  if(p.placementMode==='free'&&p.generationType==='two-storey')throw Error('Свободное размещение доступно для одноэтажных типов.');
  if(p.freeZoneCount!==undefined&&(!Number.isInteger(p.freeZoneCount)||p.freeZoneCount!==0&&(p.freeZoneCount<2||p.freeZoneCount>5)))throw Error('Зон: 0 или от 2 до 5.');
  if(p.freeIslandCount!==undefined&&(!Number.isInteger(p.freeIslandCount)||p.freeIslandCount<0||p.freeIslandCount>(p.freeZoneCount??0)))throw Error('Число островов должно быть от 0 до числа зон.');
  if((p.freeZoneCount??0)>0&&p.placementMode!=='free')throw Error('Зоны доступны в свободной планировке.');
  if(p.freeRequiredBridgeCount!==undefined&&(!Number.isInteger(p.freeRequiredBridgeCount)||p.freeRequiredBridgeCount<0||p.freeRequiredBridgeCount>(p.freeBridgeCount??0)))throw Error('Обязательных мостов должно быть от 0 до общего числа мостов.');
  if(p.freeModuleTarget!==undefined&&(!Number.isInteger(p.freeModuleTarget)||p.freeModuleTarget<8||p.freeModuleTarget>250))throw Error('Целевое число свободных модулей: от 8 до 250.');
  if(p.freeConnectionSpan!==undefined&&(!Number.isFinite(p.freeConnectionSpan)||p.freeConnectionSpan<1||p.freeConnectionSpan>3))throw Error('Пролёт свободного соединения должен быть от 1 до 3 м.');
  if(p.freeVortexContinuous!==undefined&&typeof p.freeVortexContinuous!=='boolean')throw Error('Некорректный непрерывный вортекс.');
  if(p.freeVortexContinuous&&(!p.freeVortexChaotic||p.freeVortexDeepRegions))throw Error('Непрерывный вортекс требует хаотичного пресета без вложенных районов.');
  if(p.freeVortexDeepRegions!==undefined&&typeof p.freeVortexDeepRegions!=='boolean')throw Error('Некорректные возвратные районы вортекса.');
  if(p.freeVortexDeepRegions&&!p.freeVortexChaotic)throw Error('Возвратные районы требуют хаотичного вортекса.');
  if(p.freeVortexChaotic!==undefined&&typeof p.freeVortexChaotic!=='boolean')throw Error('Некорректный хаотичный пресет вортекса.');
  if(p.freeVortexChaotic&&p.freeRoutePattern!=='vortex')throw Error('Хаотичный пресет доступен только в вортексе.');
  if(p.freeVortexKnots!==undefined&&typeof p.freeVortexKnots!=='boolean')throw Error('Некорректный пресет косых узлов вортекса.');
  if(p.freeVortexKnots&&p.freeRoutePattern!=='vortex')throw Error('Косые узлы доступны только в вортексном режиме.');
  if(p.freeVortexCenter!==undefined&&typeof p.freeVortexCenter!=='boolean')throw Error('Некорректный центральный пресет вортекса.');
  if(p.freeVortexCenter&&p.freeRoutePattern!=='vortex')throw Error('Центральный пресет доступен только в вортексном режиме.');
  if(p.freeRoutePattern==='vortex'&&p.placementMode!=='free')throw Error('Вортексный рисунок требует свободного размещения.');
  if(p.freeRoutePattern!==undefined&&!['organic','switchbacks','vortex'].includes(p.freeRoutePattern))throw Error('Неизвестный рисунок свободного маршрута.');
  if(p.freeSpanPolicy!==undefined&&(p.freeSpanPolicy!=='maximum'||p.placementMode!=='free'))throw Error('Максимальное разнесение доступно только для свободной планировки.');
  if(p.freeCavityMaze!==undefined&&typeof p.freeCavityMaze!=='boolean')throw Error('Некорректная настройка лабиринта в полостях.');
  if(p.freeCavityMaze&&(p.placementMode!=='free'||(p.freeBridgeCount??0)>0||p.freeRoutePattern==='switchbacks'))throw Error('Лабиринт в полостях доступен для органической свободной планировки без мостов.');
  if(p.freeInfillPassages!==undefined&&(!Number.isInteger(p.freeInfillPassages)||p.freeInfillPassages<0||p.freeInfillPassages>12))throw Error('Число поперечных связей: от 0 до 12.');
  if(p.freeInfillPassages&&(p.placementMode!=='free'||(p.freeBridgeCount??0)>0))throw Error('Связи в промежутках доступны для свободной планировки без мостов.');
  if(p.freeRoutePattern==='switchbacks'&&p.freeJunctionDegree===5)throw Error('Переплетённый маршрут использует обычные трёхсторонние развилки.');
  if(p.freeRoutePattern==='switchbacks'&&(p.placementMode!=='free'||p.extraConnections<2||(p.freeBridgeCount??0)>0||(p.freeZoneCount??0)>0))throw Error('Переплетённый маршрут требует свободной планировки, двух циклов и отсутствия мостов/зон.');
  if(p.freeRequireUnderpass!==undefined&&typeof p.freeRequireUnderpass!=='boolean')throw Error('Некорректное требование нижнего прохода.');
  if((p.freeRequiredBridgeCount||p.freeRequireUnderpass)&&p.placementMode!=='free')throw Error('Требования к маршруту мостов доступны в свободной планировке.');
  if(p.design?.groundOnlyLengths!==undefined&&typeof p.design.groundOnlyLengths!=='boolean')throw Error('Некорректная область ограничений длины.');
  if((p.freeZoneCount??0)>0&&(p.extraConnections<(p.freeIslandCount??p.freeZoneCount!)+(p.freeBridgeCount??0)-(p.freeRequiredBridgeCount??0)))throw Error('Для островов и мостов нужно достаточно дополнительных соединений.');
  if(p.freeBridgeCount!==undefined&&(!Number.isInteger(p.freeBridgeCount)||p.freeBridgeCount<0||p.freeBridgeCount>4||p.freeBridgeCount-(p.freeRequiredBridgeCount??0)>p.extraConnections))throw Error('Крытых мостов: от 0 до 4; для необязательных мостов нужны дополнительные соединения.');
  if(p.freeAngleSpread!==undefined&&(!Number.isFinite(p.freeAngleSpread)||p.freeAngleSpread<0||p.freeAngleSpread>120))throw Error('Разброс углов: от 0 до 120°.');
  if(p.freeJunctionDegree!==undefined&&![3,5].includes(p.freeJunctionDegree))throw Error('Перекрёсток: 3 или 5 проходов.');
  if(p.placementMode!==undefined&&!['grid','free'].includes(p.placementMode))throw Error('Неизвестный режим размещения.');
  if(p.generationType==='corridor'||p.placementMode==='free')validateCorridorParameters({...p,generationType:'corridor',moduleSize:2});
  if (p.generationType!=='corridor' && p.placementMode!=='free' && (!Number.isInteger(p.columns) || !Number.isInteger(p.rows) || p.columns < 1 || p.rows < 1 || p.columns > 100 || p.rows > 100))
    throw new Error('Размер сетки должен быть целым числом от 1 до 100.');
  if (!Number.isFinite(p.corridorWidth) || p.corridorWidth < 0.8 || p.corridorWidth > 10)
    throw new Error('Ширина коридора должна быть от 0,8 до 10 м.');
  if (p.moduleSize !== undefined && (!Number.isFinite(p.moduleSize) || p.moduleSize < 0.8 || p.moduleSize > 10))
    throw new Error('Размер модуля должен быть от 0,8 до 10 м.');
  if (!Number.isInteger(p.extraConnections) || p.extraConnections < 0 || p.extraConnections > 20000)
    throw new Error('Число дополнительных соединений: от 0 до 20000.');
  if (typeof p.seed !== 'string' || p.seed.length > 256) throw new Error('Seed должен содержать до 256 символов.');
  if (p.algorithm !== 'backtracker' && p.algorithm !== 'prim') throw new Error('Неизвестный алгоритм.');
  if(p.generationType==='two-storey')twoStoreyParameters(p);
  if(p.generationType!=='corridor'&&p.placementMode!=='free')validateShape(p);
}

export function emptyMaze(parameters: Parameters, version: 1 | 2 | 3 = parameters.shape ? 3 : parameters.moduleSize === undefined ? 1 : 2): Maze {
  validateParameters(parameters);
  if(parameters.generationType==='corridor')throw Error('Для коридорного лабиринта сначала требуется физическое размещение модулей.');
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
  if((maze.version===5||maze.version===7))return {columns:maze.passages.length,rows:1};
  if(maze.version===4)return {columns:axisCuts(maze,'x').length-1,rows:axisCuts(maze,'z').length-1};
  const p = maze.parameters;
  const offset = maze.version === 1 ? 1 : -1;
  return p.moduleSize === undefined ? { columns: p.columns, rows: p.rows } : { columns: p.columns*2+offset, rows: p.rows*2+offset };
}

export function axisBounds(maze: Maze, axis: 'x' | 'z'): number[] {
  if((maze.version===5||maze.version===7))return axis==='x'?[0,maze.width]:[0,maze.depth];
  if(maze.version===4)return axisCuts(maze,axis);
  const p = maze.parameters, count = routingSize(maze)[axis === 'x' ? 'columns' : 'rows'];
  const result = [0];
  const moduleParity = maze.version === 1 ? 1 : 0;
  for (let i = 0; i < count; i++) result.push(result[i]! + (p.moduleSize !== undefined && i%2 === moduleParity ? p.moduleSize : p.corridorWidth));
  return result;
}

export function cellSize(maze: Maze, cell: number): { width: number; depth: number } {
  if((maze.version===5||maze.version===7)){const r=freeDomain(maze).rectangles[cell]!;return {width:r.x2-r.x1,depth:r.z2-r.z1};}
  if(maze.storeys){const r=maze.storeys.nodes[cell]!.rect;return {width:r.x2-r.x1,depth:r.z2-r.z1};}
  if(maze.navigation){const r=maze.navigation.domain.rectangles[cell]!;return {width:r.x2-r.x1,depth:r.z2-r.z1};}
  if(maze.version===4){const w=routingSize(maze).columns,x=cell%w,z=Math.floor(cell/w),xs=axisBounds(maze,'x'),zs=axisBounds(maze,'z');return {width:xs[x+1]!-xs[x]!,depth:zs[z+1]!-zs[z]!};}
  const x = cell % routingSize(maze).columns, z = Math.floor(cell/routingSize(maze).columns);
  const p = maze.parameters;
  const moduleParity = maze.version === 1 ? 1 : 0;
  return {
    width: p.moduleSize !== undefined && x%2 === moduleParity ? p.moduleSize : p.corridorWidth,
    depth: p.moduleSize !== undefined && z%2 === moduleParity ? p.moduleSize : p.corridorWidth,
  };
}

export function neighbors(maze: Maze, cell: number): number[] {
  if((maze.version===5||maze.version===7))return maze.passages[cell]??[];
  if(maze.storeys)return maze.storeys.adjacent[cell]??[];
  if(maze.navigation)return maze.passages[cell]??[];
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
  if((maze.version===5||maze.version===7))return freeRuntime(maze).centers[cell]!;
  if(maze.storeys)return {...nodePoint(maze,cell)};
  if(maze.navigation)return maze.navigation.centers[cell]!;
  if(maze.version===4){const w=routingSize(maze).columns,x=cell%w,z=Math.floor(cell/w),xs=axisBounds(maze,'x'),zs=axisBounds(maze,'z');return {x:(xs[x]!+xs[x+1]!)/2,z:(zs[z]!+zs[z+1]!)/2};}
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
  if((maze.version===5||maze.version===7))return freePortal(maze,portal.freeId!).mid;
  if(maze.navigation)return originalPortalPoint(maze,portal);
  if(maze.version===4&&portal.width!==undefined){const w=corridorPortalWall(maze,portal);if(w)return {x:(w.x1+w.x2)/2,z:(w.z1+w.z2)/2};}
  const center = cellCenter(maze, portal.cell), size = cellSize(maze, portal.cell);
  if (portal.side === 'west') center.x -= size.width/2;
  if (portal.side === 'east') center.x += size.width/2;
  if (portal.side === 'north') center.z -= size.depth/2;
  if (portal.side === 'south') center.z += size.depth/2;
  return center;
}

/** Unique segments shared by map, scene and collisions. */
export function walls(maze: Maze): Wall[] {
  if((maze.version===5||maze.version===7))return maze.free!.bridges?.length?[...freeRuntime(maze).panels.map(w=>({...w,y:0,height:maze.wallHeight})),...maze.free!.bridges.flatMap(b=>bridgeGeometry(maze.free!,b).walls(maze.wallHeight)),...bridgeUprights(maze.free!,maze.wallHeight)]:freeRuntime(maze).panels;
  if(maze.storeys)return storeyWalls(maze);
  if(maze.navigation)return walls(maze.navigation.source);
  const domain = domainOf(maze), result: Wall[] = [];
  const columns = routingSize(maze).columns;
  const isPortal = (p: Portal) => (maze.portals ?? [maze.entrance, maze.exit]).some(q => q.cell === p.cell && q.side === p.side);
  for (const edge of domain.boundary) {
    if(maze.version!==4){if(!isPortal(edge.portal))result.push(edge.wall);continue;}
    const w=edge.wall,vertical=w.x1===w.x2;let spans:[number,number][]=[[vertical?w.z1:w.x1,vertical?w.z2:w.x2]];
    for(const p of maze.portals??[maze.entrance,maze.exit]){if(p.side!==edge.portal.side)continue;const q=corridorPortalWall(maze,p);if(!q||(vertical?q.x1!==w.x1:q.z1!==w.z1))continue;const lo=vertical?q.z1:q.x1,hi=vertical?q.z2:q.x2;spans=spans.flatMap(([a,b]):[number,number][]=>hi<=a||lo>=b?[[a,b]]:[...(lo>a?[[a,lo] as [number,number]]:[]),...(hi<b?[[hi,b] as [number,number]]:[])]);}
    for(const [lo,hi]of spans)result.push(vertical?{x1:w.x1,x2:w.x2,z1:lo,z2:hi}:{x1:lo,x2:hi,z1:w.z1,z2:w.z2});
  }
  for (const a of domain.cells) for (const b of neighbors(maze, a)) {
    if (b <= a || maze.passages[a]!.includes(b)) continue;
    const rect = domain.rectangles[a]!;
    result.push(Math.floor(a/columns) === Math.floor(b/columns)
      ? { x1: rect.x2, z1: rect.z1, x2: rect.x2, z2: rect.z2 }
      : { x1: rect.x1, z1: rect.z2, x2: rect.x2, z2: rect.z2 });
  }
  return result;
}
