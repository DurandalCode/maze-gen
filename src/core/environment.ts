import type { Maze, Point } from './maze';
import { solarPosition, type SunSettings } from './solar';

export interface Environment {
  /** Clockwise from north: east 90°, south 180°, west 270°. */
  sun: SunSettings;
  forest: { side: 'north' | 'east' | 'south' | 'west'; distance: number; offset: number };
}

/** Map north is -Z, east is +X. Scene date is August, independent of the computer clock. */
export const DEFAULT_ENVIRONMENT: Environment = {
  sun: { day: 15, minutes: 13*60 },
  forest: { side: 'north', distance: 12, offset: 0 },
};
export const environmentOf = (maze: Pick<Maze, 'environment'>): Environment => maze.environment ?? DEFAULT_ENVIRONMENT;

export function validateEnvironment(value: Environment): void {
  if (!value || !value.sun || !value.forest
    || !Number.isInteger(value.sun.day) || value.sun.day < 1 || value.sun.day > 31
    || !Number.isInteger(value.sun.minutes) || value.sun.minutes < 0 || value.sun.minutes > 1439
    || !['north', 'east', 'south', 'west'].includes(value.forest.side)
    || !Number.isFinite(value.forest.distance) || value.forest.distance < 2 || value.forest.distance > 100
    || !Number.isFinite(value.forest.offset) || Math.abs(value.forest.offset) > 2000)
    throw new Error('Ориентиры: день августа 1–31, время 00:00–23:59; лес — отступ 2–100 м, сдвиг до 2000 м.');
}

export function sunDirection(environment: Environment): { x: number; y: number; z: number } {
  const position = solarPosition(environment.sun);
  const azimuth = position.azimuth*Math.PI/180, elevation = position.elevation*Math.PI/180;
  return { x: Math.sin(azimuth)*Math.cos(elevation), y: Math.sin(elevation), z: -Math.cos(azimuth)*Math.cos(elevation) };
}

export const SUN_DIRECTION = Object.freeze(sunDirection(DEFAULT_ENVIRONMENT));

/** A local north-facing treeline can be rotated onto any side of the maze. */
export function forestFrame(maze: Pick<Maze, 'width' | 'depth'>, environment: Environment) {
  const { side, offset } = environment.forest;
  const frames = {
    north: { origin: { x: offset, z: 0 }, rotation: 0, length: maze.width },
    east: { origin: { x: maze.width, z: offset }, rotation: -Math.PI/2, length: maze.depth },
    south: { origin: { x: maze.width-offset, z: maze.depth }, rotation: Math.PI, length: maze.width },
    west: { origin: { x: 0, z: maze.depth-offset }, rotation: Math.PI/2, length: maze.depth },
  };
  return frames[side];
}

export function forestMapPoints(maze: Maze, environment = environmentOf(maze)): Point[] {
  const frame = forestFrame(maze, environment), distance = environment.forest.distance;
  return [[0, -distance], [frame.length, -distance], [frame.length, -distance-6], [0, -distance-6]]
    .map(([x, z]) => ({ x: frame.origin.x+x!*Math.cos(frame.rotation)+z!*Math.sin(frame.rotation),
      z: frame.origin.z-x!*Math.sin(frame.rotation)+z!*Math.cos(frame.rotation) }));
}

export function landmarkMapBounds(maze: Maze, environment = environmentOf(maze)) {
  const points = forestMapPoints(maze, environment);
  return { minX: Math.min(0, ...points.map(p => p.x)), maxX: Math.max(maze.width, ...points.map(p => p.x)),
    minZ: Math.min(0, ...points.map(p => p.z)), maxZ: Math.max(maze.depth, ...points.map(p => p.z)) };
}

/** Place the near edge of the forest from a dragged map handle. */
export function forestAtPoint(maze: Maze, point: Point, environment: Environment): Environment {
  const outside = [
    { side: 'north' as const, distance: -point.z, offset: point.x-maze.width/2 },
    { side: 'east' as const, distance: point.x-maze.width, offset: point.z-maze.depth/2 },
    { side: 'south' as const, distance: point.z-maze.depth, offset: maze.width/2-point.x },
    { side: 'west' as const, distance: -point.x, offset: maze.depth/2-point.z },
  ].sort((a, b) => b.distance-a.distance);
  const next = outside[0]!;
  return { ...environment, forest: { side: next.side, distance: Math.max(2, Math.min(100, next.distance-3)),
    offset: Math.max(-2000, Math.min(2000, next.offset)) } };
}
