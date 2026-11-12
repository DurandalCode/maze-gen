import{resolve,dirname}from'node:path';
import{mkdir}from'node:fs/promises';
import{generate}from'../src/generators/generate';
import{deepHybridVortexParameters}from'../src/free/vortex-parameters';
import{serialize,deserialize}from'../src/persistence/maze-json';
const p=deepHybridVortexParameters({columns:70,rows:70,corridorWidth:2,moduleSize:2,seed:process.env.MAZE_SEED??'vortex-chaotic-05',algorithm:'prim',extraConnections:0});
const maze=generate(p,undefined,console.log),raw=serialize(maze);deserialize(raw);const target=process.env.VORTEX_HYBRID_FILE??resolve('test-results/vortex-hybrid-deep-candidate.json');await mkdir(dirname(target),{recursive:true});await Bun.write(target,raw);console.log('PUBLIC',maze.free!.modules.length,maze.free!.cavityReport?.construction);
