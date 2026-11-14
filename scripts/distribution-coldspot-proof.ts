import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';

/** Reports apply only to the exact map bytes and unchanged analysis settings. */
export async function readClassicalColdspotProof(root:string,raw:string) {
  const file='01-classical.coldspots.json';
  const report=await Bun.file(resolve(root,file)).json();
  assert.equal(report.sha256,createHash('sha256').update(raw).digest('hex'),'Stale classical coldspot report');
  assert.equal(report.thresholdExclusive,.2);assert.equal(report.samples,2048);
  assert.equal(report.profile,'outline');assert.equal(report.passed,true);
  assert.equal(report.scenarios.length,3);
  assert.deepEqual(report.scenarios.map((s:{strategy:string})=>s.strategy).sort(),['adaptive','avoid','follow']);
  for(const scenario of report.scenarios) {
    assert(Number.isFinite(scenario.rawColdRatio)&&scenario.rawColdRatio>=0&&scenario.rawColdRatio<.2,
      'Classical raw cold area must be strictly below20% for every strategy');
    assert.equal(scenario.options.samples,2048);
    assert.equal(scenario.options.boundaryStrategy,scenario.strategy);
    for(const [key,value] of Object.entries(DEFAULT_ANALYSIS)) {
      if(key==='samples'||key==='boundaryStrategy')continue;
      assert.deepEqual(scenario.options[key],value,`Changed analysis setting ${key}`);
    }
  }
  const worst=Math.max(...report.scenarios.map((s:{rawColdRatio:number})=>s.rawColdRatio));
  assert.equal(report.worstRawColdRatio,worst);
  return {file,thresholdExclusive:.2,samples:2048,profile:'outline',worstRawColdRatio:worst};
}
