import{resolve}from'node:path';
import{generate}from'../src/generators/generate';import{chaoticVortexParameters}from'../src/free/vortex-parameters';import{serialize}from'../src/persistence/maze-json';
const parameters=chaoticVortexParameters({columns:70,rows:70,corridorWidth:2,moduleSize:2,seed:'vortex-chaotic-05',algorithm:'prim',extraConnections:0}),maze=generate(parameters,undefined,console.log);await Bun.write(resolve(process.env.VORTEX_CANDIDATE_FILE??'test-results/vortex-05-candidate.json'),serialize(maze));console.log('CANDIDATE',maze.free!.modules.length);
