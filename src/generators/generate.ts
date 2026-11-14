import {generateFree} from '../free/generate';
import {generateTwoStorey} from './two-storey';
import {generateCorridor} from './corridor';
import {livingBase} from './living-base';
import {generateLiving} from './living';
import { connect, emptyMaze, neighbors, type Maze, type Parameters } from '../core/maze';
import { random, shuffle } from '../core/random';
import { backtracker } from './backtracker';
import { prim } from './prim';
import {standardTraps} from './standard-traps';
import {transferPortals} from '../core/portals';
import {generateLoopTraps} from './loop-traps';
import {addConstrainedConnections} from './constrained-connections';

/** Unmodified seeded spanning-tree algorithms; also used to complete constrained forests. */
export function generateBase(parameters: Parameters): Maze {
  if(parameters.placementMode==='free')return generateFree(parameters);
  if(parameters.generationType==='two-storey')return generateTwoStorey(parameters);
  if(parameters.generationType==='corridor')return generateCorridor(parameters);
  if(parameters.generationType==='living')return livingBase(emptyMaze(parameters));
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
  const maze=generateMaze(parameters,previous,onProgress);
  if(previous?.fabricTransmissionStrength!==undefined)maze.fabricTransmissionStrength=previous.fabricTransmissionStrength;
  return maze;
}
function generateMaze(parameters:Parameters,previous?:Maze,onProgress?:(message:string)=>void):Maze {
  if(parameters.placementMode==='free')return generateFree(parameters,previous,onProgress);
  if(parameters.generationType==='two-storey')return generateTwoStorey(parameters,previous,onProgress);
  if(parameters.generationType==='corridor')return generateCorridor(parameters,previous,onProgress);
  if(parameters.generationType==='living'){
    // Portal remapping validates connectivity, so provide a connected target first.
    let maze=previous?generateBase(parameters):emptyMaze(parameters);
    if(previous)maze={...transferPortals(previous,maze),wallHeight:previous.wallHeight,wallColor:previous.wallColor,translucentFabric:previous.translucentFabric,roof:previous.roof,...(previous.environment?{environment:previous.environment}:{})};
    return generateLiving(maze,onProgress);
  }
  if((parameters.loopTrapCount??0)>0){
    let maze=generateBase(parameters);
    if(previous)maze={...transferPortals(previous,maze),wallHeight:previous.wallHeight,wallColor:previous.wallColor,translucentFabric:previous.translucentFabric,roof:previous.roof,...(previous.environment?{environment:previous.environment}:{})};
    return generateLoopTraps(maze,onProgress);
  }
  if(parameters.extraConnections>0&&((parameters.routeTrapCount??0)>0||parameters.design)){
    const tree=generate({...parameters,extraConnections:0},previous,onProgress);
    return addConstrainedConnections(tree,parameters.extraConnections,parameters.seed,onProgress);
  }
  let maze=generateBase(parameters);
  if(previous)maze={...transferPortals(previous,maze),wallHeight:previous.wallHeight,wallColor:previous.wallColor,translucentFabric:previous.translucentFabric,roof:previous.roof,...(previous.environment?{environment:previous.environment}:{})};
  return (parameters.routeTrapCount??0)>0 || parameters.design?standardTraps(maze,onProgress):maze;
}

