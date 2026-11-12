import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {freeIdentity} from '../src/free/json';
import {attachDenseReturnLoop} from '../src/free/dense-return-loop';
import {freeGroundLengths} from '../src/free/path-limits';
import {auditModuleWalls} from '../src/free/module-origin';
import {routeTraps} from '../src/analysis/route-traps';
import {trapOverlay} from '../src/ui/trap-overlay';
import {validateParameters} from '../src/core/maze';

test('two-row dense return retains L2/K1 through real branch repair without restoring offset screens',async()=>{
 const source=deserialize(await Bun.file(new URL('./fixtures/dense-two-row-return-base.json',import.meta.url)).text()),before=serialize(source),fork=source.free!.modules.find(m=>m.id.startsWith('dense-apex-')&&m.id.endsWith('-7-frame-1'))!.id;
 const result=attachDenseReturnLoop(source,fork,source.parameters.seed+'-dense-return-v1');expect(serialize(source)).toBe(before);
 for(const frame of source.free!.modules.filter(m=>!m.id.startsWith('route-arm-')))expect(result.free!.modules.find(m=>m.id===frame.id)).toEqual(frame);
 expect(result.free!.spaces.filter(s=>s.kind==='hall')).toEqual(source.free!.spaces.filter(s=>s.kind==='hall'));expect(result.free!.openings).toEqual(source.free!.openings);
 expect(result.free!.modules.filter(m=>m.id.endsWith('-rows-base-0'))).toHaveLength(5);expect(result.free!.modules.filter(m=>m.id.endsWith('-micro-alcove'))).toHaveLength(2);
 expect(result.free!.connections.filter(c=>c.id.startsWith('dense-return-')).every(c=>c.width===2&&c.a.offset===0&&c.b.offset===0)).toBe(true);
 expect(result.free!.connections.some(c=>c.id.includes('-baffle-'))).toBe(false);expect(auditModuleWalls(result.free!).issues).toEqual([]);
 const lengths=freeGroundLengths(result);expect(lengths.straight).toBeLessThanOrEqual(8);expect(lengths.run).toBeLessThanOrEqual(16);
 const traps=routeTraps(result),entries=trapOverlay(result,traps);expect(traps.qualifiedCount).toBe(2);expect(entries.filter(e=>e.kind==='loop')).toHaveLength(1);
 const recipe={...result.parameters,routeTrapCount:2,loopTrapCount:1,extraConnections:1};expect(()=>validateParameters(recipe)).not.toThrow();expect(deserialize(serialize({...result,parameters:recipe})).free).toEqual(result.free);
 expect(createHash('sha256').update(JSON.stringify(freeIdentity(result))).digest('hex')).toBe('1be8811d9d0eac2653984d4694b06041f07a8a2fd1b414979302656523e967d3');
},240000);
