import {expect,test} from 'bun:test';
import {freeRooms} from './fixtures/free-rooms';
import {mazeDraft} from '../src/free/json';
import {freeMaze} from '../src/free/layout';
import {addTwoRowAlcove} from '../src/free/two-row-assembly';
import {promoteCavityConnectors} from '../src/free/void-infill';
import {freeGroundLengths,freeGroundRunWitness} from '../src/free/path-limits';

test('native connector promotion cannot turn a single square alcove into a real decision',()=>{
 const d=mazeDraft(freeRooms(6,1));d.parameters={...d.parameters,columns:30,rows:30,freePassagePattern:'organic-sectors-v1'};
 delete d.layout.preservedPanels;d.layout.moduleConstruction={version:1,spans:structuredClone(d.layout.connections)};
 addTwoRowAlcove(d,'room-3','bud',2);
 const before=freeGroundLengths(freeMaze(d,false));
 promoteCavityConnectors(d);const after=freeGroundLengths(freeMaze(d,false));
 expect(after.run).toBeCloseTo(before.run,8);expect(after.straight).toBeCloseTo(before.straight,8);
 expect(after.run).toBeGreaterThan(11);expect(freeGroundRunWitness(freeMaze(d,false)).length).toBeCloseTo(after.run,8);
 // Frozen old recipes retain their old measurement for deterministic replay.
 expect(freeGroundLengths(freeMaze(d,false),false).run).toBeLessThan(after.run);
});
