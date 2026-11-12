import {expect,test} from 'bun:test';
import {validateParameters,type Parameters} from '../src/core/maze';
import {vortexParameters,continuousVortexParameters,hybridVortexParameters,deepHybridVortexParameters,multiBandVortexParameters,leaveContinuousVortex} from '../src/free/vortex-parameters';
const dense:Parameters={columns:100,rows:100,moduleSize:2,corridorWidth:2,seed:'mode-transition',algorithm:'prim',extraConnections:0,placementMode:'free',freeRoutePattern:'organic',freeCavityMaze:true,freeCourtyardPolicy:'dense-v3',freePassagePattern:'organic-sectors-v1'};
test('explicit vortex selection clears incompatible dense policies without altering source settings',()=>{
 const before=JSON.stringify(dense);expect(()=>validateParameters(dense)).not.toThrow();
 for(const preset of [vortexParameters,continuousVortexParameters,hybridVortexParameters,deepHybridVortexParameters,multiBandVortexParameters]){
  const p=preset(dense);expect(p.freeCourtyardPolicy).toBeUndefined();expect(p.freePassagePattern).toBeUndefined();expect(()=>validateParameters(p)).not.toThrow();
 }
 expect(JSON.stringify(dense)).toBe(before);
});
test('continuous60, deep hybrid64 and separate83-frame multiband profiles remain distinct',()=>{
 const continuous=continuousVortexParameters(dense),hybrid=hybridVortexParameters(dense),deep=deepHybridVortexParameters(dense),multi=multiBandVortexParameters(dense);
 expect(continuous.design!.maxForcedRun).toBe(60);expect(hybrid.design!.maxForcedRun).toBe(60);expect(deep.design!.maxForcedRun).toBe(64);expect(multi.design!.maxForcedRun).toBe(60);
 expect(multi.freeModuleTarget).toBe(83);expect(multi.freeVortexHybrid).toBe(false);expect(deep.freeVortexMultiBand).toBe(false);
 expect(()=>validateParameters({...deep,freeVortexMultiBand:true})).toThrow();
 const left=leaveContinuousVortex(deep);expect(left.freeVortexHybridDeep).toBe(false);expect(left.freeVortexMultiBand).toBe(false);expect(left.design!.maxForcedRun).toBe(16);
});
