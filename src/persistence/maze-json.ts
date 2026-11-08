import { DEFAULT_CONSTRUCTION, emptyMaze, neighbors, routingSize, validateConstruction, validateParameters, type Construction, type Maze, type Parameters, type Portal } from '../core/maze';

const fail = (): never => { throw new Error('Некорректный файл Maze Lab: проверьте формат и топологию.'); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
};

export function deserialize(json: string): Maze {
  if (json.length > 5_000_000) throw new Error('Файл слишком большой (максимум 5 МБ).');
  const data = object(JSON.parse(json) as unknown);
  if (data.version !== 1 && data.version !== 2) throw new Error('Неподдерживаемая версия формата.');
  const raw = object(data.parameters);
  const p = {
    columns: raw.columns, rows: raw.rows, corridorWidth: raw.corridorWidth,
    extraConnections: raw.extraConnections, seed: raw.seed, algorithm: raw.algorithm,
    ...(raw.moduleSize === undefined ? {} : { moduleSize: raw.moduleSize }),
  } as Parameters;
  validateParameters(p);
  if (data.version === 2 && p.moduleSize === undefined) fail();
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
  } as Construction;
  validateConstruction(construction);
  Object.assign(maze, construction);
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
    const { columns, rows } = routingSize(maze);
    const x = v.cell % columns, y = Math.floor(v.cell / columns);
    if (!(v.side === 'west' && x === 0 || v.side === 'east' && x === columns - 1 ||
      v.side === 'north' && y === 0 || v.side === 'south' && y === rows - 1)) return fail();
    return { cell: v.cell, side: v.side as Portal['side'] };
  };
  maze.entrance = portal(data.entrance);
  maze.exit = portal(data.exit);
  if (maze.entrance.cell === maze.exit.cell && maze.entrance.side === maze.exit.side) fail();
  return maze;
}

export function serialize(maze: Maze): string {
  return JSON.stringify(maze, null, 2);
}
