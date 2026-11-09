import { connect, emptyMaze, neighbors, type Maze, type Parameters } from '../core/maze';
import { random, shuffle } from '../core/random';
import { backtracker } from './backtracker';
import { prim } from './prim';
import {standardTraps} from './standard-traps';
import {transferPortals} from '../core/portals';

/** Unmodified seeded spanning-tree algorithms; also used to complete constrained forests. */
export function generateBase(parameters: Parameters): Maze {
  const maze = emptyMaze(parameters), rng = random(parameters.seed);
  (parameters.algorithm === 'prim' ? prim : backtracker)(maze, rng);
  const closed: [number, number][] = [];
  for (let a = 0; a < maze.passages.length; a++)
    for (const b of neighbors(maze, a))
      if (b > a && !maze.passages[a]!.includes(b)) closed.push([a, b]);
  shuffle(closed, rng);
  for (const [a, b] of closed.slice(0, parameters.extraConnections)) connect(maze, a, b);
  for (const list of maze.passages) list.sort((a, b) => a - b);
  return maze;
}

export function generate(parameters:Parameters,previous?:Maze,onProgress?:(message:string)=>void):Maze {
  let maze=generateBase(parameters);
  if(previous)maze={...transferPortals(previous,maze),wallHeight:previous.wallHeight,wallColor:previous.wallColor,translucentFabric:previous.translucentFabric,roof:previous.roof,...(previous.environment?{environment:previous.environment}:{})};
  return (parameters.routeTrapCount??0)>0 || parameters.design?standardTraps(maze,onProgress):maze;
}

