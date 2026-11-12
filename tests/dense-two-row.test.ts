import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {freeIdentity} from '../src/free/json';
import {generateSecondDenseTrap} from '../src/free/dense-second-trap';
import {freeGroundLengths} from '../src/free/path-limits';
import {auditModuleWalls} from '../src/free/module-origin';
import {independentCycles} from '../src/core/graph';

test('the seeded dense extension uses two-row alternatives rather than offset screens, preserving its dense core',async()=>{
 const source=deserialize(await Bun.file(new URL('./fixtures/dense-one-trap-base.json',import.meta.url)).text());source.parameters={...source.parameters,freePassagePattern:'two-row-v1'};const before=serialize(source),result=generateSecondDenseTrap(source);
 expect(serialize(source)).toBe(before);
 for(const frame of source.free!.modules.filter(m=>!m.id.startsWith('route-arm-')))expect(result.free!.modules.find(m=>m.id===frame.id)).toEqual(frame);
 expect(result.free!.spaces.filter(s=>s.kind==='hall')).toEqual(source.free!.spaces.filter(s=>s.kind==='hall'));expect(result.free!.openings).toEqual(source.free!.openings);
 expect(result.free!.modules.filter(m=>m.id.endsWith('-rows-base-0'))).toHaveLength(5);
 const rowLinks=result.free!.moduleConstruction!.spans.filter(c=>c.id.includes('-rows-link-'));expect(rowLinks).toHaveLength(30);expect(rowLinks.every(c=>c.width===2&&c.a.offset===0&&c.b.offset===0)).toBe(true);
 expect(result.free!.connections.some(c=>c.id.includes('-baffle-'))).toBe(false);expect(result.free!.modules.filter(m=>m.id.endsWith('-micro-alcove'))).toHaveLength(2);
 expect(independentCycles(result)).toBeGreaterThanOrEqual(independentCycles(source)+4);expect(auditModuleWalls(result.free!).issues).toEqual([]);
 const lengths=freeGroundLengths(result);expect(lengths.straight).toBeLessThanOrEqual(8);expect(lengths.run).toBeLessThanOrEqual(16);
 // This independently reconstructed sector must match the ordinary full
 // generator's published two-row geometry for this recipe.
 expect(createHash('sha256').update(JSON.stringify(freeIdentity(result))).digest('hex')).toBe('c556ffe1662ac339d9421182326c9ea7e8a78ac8e94370fb280a06069d3eeb7c');
},90000);
