import { walls, type Maze, type Point, type Wall } from './maze';

export const BOARD_WIDTH = 0.12;
export const BOARD_THICKNESS = 0.04;
export const FRAME_POST_SIZE = BOARD_WIDTH;
export const HEADER_DEPTH = 0.14;

export interface TimberStructure {
  posts: Point[];
  frames: Wall[];
  braceDrop: number;
}

export interface ModuleFootprint { x: number; z: number; size: number }
export function moduleFootprints(maze: Maze): ModuleFootprint[] {
  const { moduleSize, columns, rows, corridorWidth: gap } = maze.parameters;
  if (moduleSize === undefined) return [];
  const modules: ModuleFootprint[] = [];
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++)
    modules.push({ x: (maze.version === 1 ? gap : 0)+x*(moduleSize+gap), z: (maze.version === 1 ? gap : 0)+z*(moduleSize+gap), size: moduleSize });
  return modules;
}

/** Each separate module owns four corner uprights and a closed top perimeter. */
export function timberStructure(maze: Maze): TimberStructure {
  const { columns, rows, corridorWidth: s } = maze.parameters;
  const posts: Point[] = [], frames: Wall[] = [];
  if (maze.parameters.moduleSize !== undefined) {
    const uniquePosts = new Map<string, Point>();
    const addFrame = (a: Point, b: Point) => {
      uniquePosts.set(`${a.x.toFixed(6)},${a.z.toFixed(6)}`, a);
      uniquePosts.set(`${b.x.toFixed(6)},${b.z.toFixed(6)}`, b);
      frames.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
    };
    for (const m of moduleFootprints(maze)) {
      const corners = [{ x: m.x, z: m.z }, { x: m.x+m.size, z: m.z },
        { x: m.x+m.size, z: m.z+m.size }, { x: m.x, z: m.z+m.size }];
      for (let i = 0; i < 4; i++) addFrame(corners[i]!, corners[(i+1)%4]!);
    }
    // Preserve geometry only when opening a previously saved v1 modular file.
    if (maze.version === 1) for (const w of walls(maze)) if (w.x1 === 0 && w.x2 === 0 || w.z1 === 0 && w.z2 === 0 ||
      Math.abs(w.x1-maze.width)<1e-6 && Math.abs(w.x2-maze.width)<1e-6 ||
      Math.abs(w.z1-maze.depth)<1e-6 && Math.abs(w.z2-maze.depth)<1e-6)
      addFrame({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 });
    return { posts: [...uniquePosts.values()], frames,
      braceDrop: Math.min(0.42, maze.parameters.moduleSize*0.28, Math.max(0, maze.wallHeight-HEADER_DEPTH-1.88)) };
  }
  // Legacy files retain their continuous-grid layout.
  for (let z = 0; z <= rows; z++) for (let x = 0; x <= columns; x++) {
    posts.push({ x: x * s, z: z * s });
    if (x < columns) frames.push({ x1: x*s, z1: z*s, x2: (x+1)*s, z2: z*s });
    if (z < rows) frames.push({ x1: x*s, z1: z*s, x2: x*s, z2: (z+1)*s });
  }
  return {
    posts, frames,
    // At the minimum wall height omit braces rather than putting them at eye level.
    braceDrop: Math.min(0.42, s * 0.28, Math.max(0, maze.wallHeight - HEADER_DEPTH - 1.88)),
  };
}

/** Uprights occupy a conservative 12 × 12 cm envelope at lattice intersections. */
export function supportColliders(maze: Maze): Wall[] {
  return timberStructure(maze).posts.map(p => ({ x1: p.x, z1: p.z, x2: p.x, z2: p.z, thickness: FRAME_POST_SIZE }));
}
