/** Legacy input validation only. Keep old wire readers at this boundary. */
import {decodeCorridor} from '../persistence/corridor-json';
import { domainOf } from '../core/domain';
import { componentCount } from '../core/graph';
import { DEFAULT_CONSTRUCTION, emptyMaze, neighbors, validateConstruction, validateParameters, type Construction, type Maze, type Parameters, type Portal } from '../core/maze';
import { boundaryPortal, samePortal, withPortals } from '../core/portals';
import { validateEnvironment, type Environment } from '../core/environment';

const fail = (): never => { throw new Error('Некорректный файл Maze Lab: проверьте формат и топологию.'); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
};

export function readLegacyMaze(json: string): Maze {
  if (json.length > 5_000_000) throw new Error('Файл слишком большой (максимум 5 МБ).');
  const data = object(JSON.parse(json) as unknown);
  if(data.version===4)return decodeCorridor(data);
  if (data.version !== 1 && data.version !== 2 && data.version !== 3) throw new Error('Неподдерживаемая версия формата.');
  const raw = object(data.parameters);
  const p = {
    ...(raw.generationType===undefined?{}:{generationType:raw.generationType}),
    ...(raw.design === undefined ? {} : {design:raw.design}),
    ...(raw.loopTrapCount === undefined ? {} : {loopTrapCount:raw.loopTrapCount}),
    ...(raw.routeTrapCount === undefined ? {} : {routeTrapCount:raw.routeTrapCount}),
    ...(raw.shape === undefined ? {} : {shape: raw.shape}),
    columns: raw.columns, rows: raw.rows, corridorWidth: raw.corridorWidth,
    extraConnections: raw.extraConnections, seed: raw.seed, algorithm: raw.algorithm,
    ...(raw.moduleSize === undefined ? {} : { moduleSize: raw.moduleSize }),
  } as Parameters;
  validateParameters(p);
  if(p.generationType==='two-storey')fail();
  if (data.version === 2 && p.moduleSize === undefined) fail();
  if ((data.version === 3) !== (p.shape !== undefined)) fail();
  const maze = emptyMaze(p, data.version);
  if (data.width !== maze.width || data.depth !== maze.depth) fail();
  // v1 files written before construction settings lack color and roof fields.
  const legacyOpacity = data.wallOpacity;
  if (legacyOpacity !== undefined && (typeof legacyOpacity !== 'number' || !Number.isFinite(legacyOpacity) || legacyOpacity < 0 || legacyOpacity > 1)) fail();
  const construction = {
    wallHeight: data.wallHeight,
    wallColor: data.wallColor === undefined ? DEFAULT_CONSTRUCTION.wallColor : data.wallColor,
    translucentFabric: data.translucentFabric === undefined
      ? legacyOpacity !== undefined && (legacyOpacity as number) < 1 : data.translucentFabric,
    roof: data.roof === undefined ? DEFAULT_CONSTRUCTION.roof : data.roof,
    ...(data.fabricTransmissionStrength===undefined?{}:{fabricTransmissionStrength:data.fabricTransmissionStrength}),
  } as Construction;
  validateConstruction(construction);
  Object.assign(maze, construction);
  if (data.environment !== undefined) {
    const value = object(data.environment), sun = object(value.sun), forest = object(value.forest);
    const environment = { sun: { day: sun.day, minutes: sun.minutes },
      forest: { side: forest.side, distance: forest.distance, offset: forest.offset } } as Environment;
    validateEnvironment(environment); maze.environment = environment;
  }
  if (!Array.isArray(data.passages) || data.passages.length !== maze.passages.length) return fail();
  maze.passages = data.passages.map((value: unknown, i: number) => {
    if (!Array.isArray(value) || value.length > 4) return fail();
    const allowed = neighbors(maze, i);
    const links = value.map((n: unknown) => {
      if (typeof n !== 'number' || !Number.isInteger(n) || !allowed.includes(n)) return fail();
      return n;
    });
    if (new Set(links).size !== links.length) fail();
    return links;
  });
  for (let a = 0; a < maze.passages.length; a++) for (const b of maze.passages[a]!)
    if (!maze.passages[b]!.includes(a)) fail();
  const portal = (value: unknown): Portal => {
    const v = object(value);
    if (typeof v.cell !== 'number' || !Number.isInteger(v.cell) || v.cell < 0 || v.cell >= maze.passages.length) return fail();
    if (!boundaryPortal(maze, {cell:v.cell, side:v.side as Portal['side']})) fail();
    return { cell: v.cell, side: v.side as Portal['side'] };
  };
  maze.entrance = portal(data.entrance);
  maze.exit = portal(data.exit);
  if (maze.entrance.cell === maze.exit.cell && maze.entrance.side === maze.exit.side) fail();
  if (data.portals !== undefined) {
    if (!Array.isArray(data.portals) || data.portals.length < 2 || data.portals.length > domainOf(maze).boundary.length) fail();
    const portals = (data.portals as unknown[]).map(portal);
    if (!portals.some(p => samePortal(p, maze.entrance)) || !portals.some(p => samePortal(p, maze.exit))) fail();
    Object.assign(maze, withPortals(maze, portals));
  }
  if (data.version === 3 && componentCount(maze) !== 1) fail();
  return maze;
}

