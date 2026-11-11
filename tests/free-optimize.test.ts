import {expect,test} from 'bun:test';
import {generateFree} from '../src/free/generate';
import {dominatesFree,freeQualityVector,optimizeFree} from '../src/free/optimize';
import {mazeDraft} from '../src/free/json';
import {validateFree} from '../src/free/layout';
import {serialize} from '../src/persistence/maze-json';
const parameters={placementMode:'free' as const,columns:24,rows:16,moduleSize:2,corridorWidth:2,extraConnections:1,algorithm:'backtracker' as const,seed:'free-optimization'};
test('coverage cannot compensate deterioration of another profile or metric',()=>{
 const original=generateFree(parameters),before=freeQualityVector(original,32);
 expect(dominatesFree(before,before)).toBe(false);
 const improved=structuredClone(before);improved[0]!.unseenRatio-=.01;
 expect(dominatesFree(improved,before)).toBe(true);
 improved[1]!.coldRatio+=.01;expect(dominatesFree(improved,before)).toBe(false);
 improved[1]!.coldRatio-=.01;improved[0]!.completion=.9;expect(dominatesFree(improved,before)).toBe(false);
});
test('local optimizer is reproducible, preserves modules, connections, cycles and input',()=>{
 const original=generateFree(parameters),snapshot=serialize(original),a=optimizeFree(original,16,32),b=optimizeFree(original,16,32);
 expect(serialize(original)).toBe(snapshot);expect(serialize(a.maze)).toBe(serialize(b.maze));
 expect(a.attempted).toBe(16);expect(validateFree(mazeDraft(a.maze))).toEqual([]);
 expect(a.maze.free!.connections).toEqual(original.free!.connections);
 expect(a.maze.free!.openings).toEqual(original.free!.openings);
 expect(a.maze.free!.modules.map(m=>[m.id,m.type])).toEqual(original.free!.modules.map(m=>[m.id,m.type]));
 expect(a.maze.parameters).toEqual(original.parameters);
 expect(a.improved?dominatesFree(a.after,a.before):a.maze===original).toBe(true);
});
