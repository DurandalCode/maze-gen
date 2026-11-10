import type { Maze, Parameters } from '../core/maze';
import { generateOrganic } from './organic';
/** All free placement is grown from world-space doorways, without a lattice. */
export function generateFree(parameters: Parameters, previous?: Maze, onProgress?: (message: string) => void): Maze {
  return generateOrganic(parameters, previous, onProgress);
}
