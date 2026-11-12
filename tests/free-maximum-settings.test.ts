import {expect,test} from 'bun:test';
import {maximumSpacingParameters} from '../src/free/maximum-settings';
import {DEFAULT_DESIGN_LIMITS,type Parameters} from '../src/core/maze';
test('explicit maximum action updates constraints without mutating a loaded legacy recipe',()=>{
 const legacy:Parameters={placementMode:'free',columns:100,rows:100,corridorWidth:2,moduleSize:2,extraConnections:0,seed:'legacy',algorithm:'prim',freeConnectionSpan:2.6,design:{...DEFAULT_DESIGN_LIMITS,maxForcedStraight:4,maxForcedRun:8}},before=JSON.stringify(legacy),next=maximumSpacingParameters(legacy);expect(JSON.stringify(legacy)).toBe(before);expect(next.freeSpanPolicy).toBe('maximum');expect(next.freeConnectionSpan).toBe(2.6);expect(next.design!.maxForcedStraight).toBe(8);expect(next.design!.maxForcedRun).toBe(16);expect(legacy.freeSpanPolicy).toBeUndefined();
});
