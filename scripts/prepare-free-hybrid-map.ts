import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {generate} from '../src/generators/generate';
import {DEFAULT_DESIGN_LIMITS,type Parameters} from '../src/core/maze';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {auditModuleWalls} from '../src/free/module-origin';
import {freeGroundLengths} from '../src/free/path-limits';

const [seed,count,file,...flags]=Bun.argv.slice(2);
if(!seed||!count||!file||!file.endsWith('.json'))throw Error('Usage: bun scripts/prepare-free-hybrid-map.ts SEED BASE_MODULES OUTPUT.json [--legacy-passages] [--route-traps=2]');
const routes=Number(flags.find(f=>f.startsWith('--route-traps='))?.split('=')[1]??1),selective=flags.includes('--selective');
const parameters:Parameters={
 placementMode:'free',generationType:'classical',columns:100,rows:100,moduleSize:2,corridorWidth:2,
 algorithm:'prim',seed,extraConnections:selective?3:1,routeTrapCount:routes,loopTrapCount:1,
 freeModuleTarget:Number(count),freeRoutePattern:'organic',freeJunctionDegree:selective?5:3,
 freeAngleSpread:80,freeSpanPolicy:'maximum',freeConnectionSpan:3,
 freeCavityMaze:true,freeCourtyardPolicy:selective?'selective-v2':'dense-v3',
 ...(selective||flags.includes('--legacy-passages')?{}:{freePassagePattern:'two-row-v1'}),
 design:{...DEFAULT_DESIGN_LIMITS,disabledLimits:['maxVisibleStraight']},
};
let previous=0;
const maze=generate(parameters,undefined,message=>{if(performance.now()-previous>4000){console.log(message);previous=performance.now();}});
maze.roof=true;
const raw=serialize(maze),restored=deserialize(raw),n=restored.free!.modules.length;
const report={modules:n,routeTraps:routeTraps(restored).qualifiedCount,loopTraps:loopTraps(restored).qualifiedCount,lengths:freeGroundLengths(restored),wallIssues:auditModuleWalls(restored.free!).issues,parameters};
console.log(JSON.stringify(report,null,2));
if(n>75)throw Error(`Final hybrid has ${n} modules, above75.`);
if(report.routeTraps<routes||report.loopTraps<1||report.wallIssues.length)throw Error('Hybrid acceptance failed.');
await mkdir(dirname(resolve(file)),{recursive:true});await Bun.write(file,raw);
await Bun.write(file.replace(/\.json$/,'.validation.json'),JSON.stringify(report,null,2)+'\n');
