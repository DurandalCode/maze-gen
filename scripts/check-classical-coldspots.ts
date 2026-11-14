import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {domainOf} from '../src/core/domain';
import {metrics} from '../src/core/metrics';
import {analyzeColdspots,DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {recognitionAdjustedColdspots} from '../src/analysis/visible-deadends';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';

const path=resolve(Bun.argv[2]??'examples/bundles/distribution-v2/01-classical.json');
const output=resolve(Bun.argv[3]??'examples/bundles/distribution-v2/01-classical.coldspots.json');
assert.notEqual(path.toLowerCase(),output.toLowerCase(),'The report must not overwrite its source map.');
const raw=await Bun.file(path).text(),maze=deserialize(raw);
assert.equal(maze.parameters.generationType,'classical');
assert.deepEqual(deserialize(serialize(maze)),maze);
const modules=domainOf(maze).modules.reduce((a,b)=>a+b,0),structure=metrics(maze);
assert(modules<=75);assert.equal(structure.components,1);assert(structure.reachable);
assert.equal(structure.cycles,maze.parameters.extraConnections);assert.equal(maze.roof,true);
assert.equal(maze.entrance.side,'west');assert.equal(maze.exit.side,'east');
const routes=routeTraps(maze).qualifiedCount,loops=loopTraps(maze).qualifiedCount;
assert(routes>=1);assert(loops>=1);assert(mazePortalPrivacy(maze,false).certified);
const samples=2048,thresholdExclusive=.2,profile='outline' as const;
const scenarios=[];
for(const strategy of ['adaptive','follow','avoid'] as const){
 const result=analyzeColdspots(maze,{...DEFAULT_ANALYSIS,profile,samples,boundaryStrategy:strategy});
 const effective=recognitionAdjustedColdspots(maze,result.probability,result.options.threshold);
 assert.equal(result.samples,samples);
 const row={strategy,rawColdRatio:result.coldAreaRatio,effectiveColdRatio:effective.coldAreaRatio,
  rawColdArea:result.coldArea,effectiveColdArea:effective.coldArea,largestRawColdArea:result.largestColdArea,
  recognizedTerminalArea:effective.recognizedTerminalArea,modelVersion:result.modelVersion,options:result.options};
 scenarios.push(row);console.log(JSON.stringify(row));
}
const passed=scenarios.every(s=>s.rawColdRatio<thresholdExclusive);
assert(passed,'Classical raw cold area must be strictly below20% for all three strategies.');
const report={version:1,sha256:createHash('sha256').update(raw).digest('hex'),thresholdExclusive,samples,profile,
 modules,area:structure.area,cycles:structure.cycles,qualifiedRouteTraps:routes,qualifiedLoopTraps:loops,
 worstRawColdRatio:Math.max(...scenarios.map(s=>s.rawColdRatio)),
 worstEffectiveColdRatio:Math.max(...scenarios.map(s=>s.effectiveColdRatio)),scenarios,passed};
await Bun.write(output,JSON.stringify(report,null,2)+'\n');
console.log(`Verified raw cold <20%; report saved to ${output}`);
