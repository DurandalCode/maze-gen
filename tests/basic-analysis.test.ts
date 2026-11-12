import {test,expect} from 'bun:test';
import {generate} from '../src/generators/generate';
import {DEFAULT_DESIGN_LIMITS} from '../src/core/maze';
import {DEFAULT_ANALYSIS,type ColdspotAnalysis} from '../src/analysis/coldspots';

test('ordinary worker analysis keeps the requested heat budget without an implicit difficulty assessment',async()=>{
 const maze=generate({columns:3,rows:3,corridorWidth:2,moduleSize:2,algorithm:'prim',seed:'fast-analysis',extraConnections:1});
 maze.parameters.design={...DEFAULT_DESIGN_LIMITS};
 const worker=new Worker(new URL('../src/analysis/worker.ts',import.meta.url),{type:'module'});
 try{
  const result=await new Promise<ColdspotAnalysis>((resolve,reject)=>{
   worker.onmessage=e=>e.data.kind==='error'?reject(Error(e.data.message)):resolve(e.data.result);
   worker.onerror=e=>reject(Error(e.message));
   worker.postMessage({kind:'analyze',maze,options:{...DEFAULT_ANALYSIS,samples:16}});
  });
  expect(result.probability.length).toBe(maze.passages.length);
  expect(result.sideDistricts?.assessed).toBe(true);
  expect(result.options.samples).toBe(16);
  expect(result.potential).toBeUndefined();expect(result.decisions).toBeUndefined();expect(result.sideExploration).toBeUndefined();expect(result.explorerExpectedLength).toBeUndefined();
 }finally{worker.terminate();}
});
