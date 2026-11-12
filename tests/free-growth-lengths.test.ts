import {expect,test} from 'bun:test';
import {freeRooms,roomPanels} from './fixtures/free-rooms';
import {mazeDraft} from '../src/free/json';
import {freeMaze,freeRuntime} from '../src/free/layout';
import {serialize} from '../src/persistence/maze-json';
import {freeGroundLengths,freeGrowthLengths,freeLengthLimits} from '../src/free/path-limits';
import {generateOrganic} from '../src/free/organic';
import {DEFAULT_DESIGN_LIMITS,type Parameters} from '../src/core/maze';

const base:Parameters={placementMode:'free',columns:80,rows:80,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'backtracker',seed:'corridors-a',freeModuleTarget:40,freeJunctionDegree:3};
test('a shallow 2x2 dead-end does not reset the physical main corridor',()=>{
 const missing=Array.from({length:10},(_,i)=>i+10).filter(i=>i!==15);
 const pairs:[number,number][]=[...Array.from({length:9},(_,i)=>[i,i+1] as [number,number]),[5,15]];
 const draft=mazeDraft(freeRooms(10,2,missing,pairs));
 draft.layout.openings[1]!.room='room-9';roomPanels(draft.layout);
 const maze=freeMaze(draft);
 const lengths=freeGroundLengths(maze);
 expect(lengths.straight).toBeGreaterThanOrEqual(16);
 expect(lengths.run).toBeGreaterThanOrEqual(16);
 expect(freeGrowthLengths(maze.free!,'room-0').run).toBeGreaterThanOrEqual(16);
});

for(const id of ['entrance','exit'])test(`a small ${id} terminal is a real choice, not a decorative bud`,()=>{
 const missing=Array.from({length:10},(_,i)=>i+10).filter(i=>i!==15);
 const pairs:[number,number][]=[...Array.from({length:9},(_,i)=>[i,i+1] as [number,number]),[5,15]];
 const draft=mazeDraft(freeRooms(10,2,missing,pairs));
 draft.layout.openings=[{id:'entrance',room:'room-0',edge:0,offset:0,width:2},{id:'exit',room:'room-9',edge:0,offset:0,width:2}];
 roomPanels(draft.layout);const plain=freeGroundLengths(freeMaze(draft));
 draft.layout.openings.find(o=>o.id===id)!.room='room-15';
 draft.layout.openings.find(o=>o.id===id)!.edge=2;
 roomPanels(draft.layout);const maze=freeMaze(draft),withPortal=freeGroundLengths(maze);
 expect(plain.run).toBeGreaterThanOrEqual(16);
 expect(withPortal.run).toBeLessThan(plain.run-4);
 expect(freeGrowthLengths(maze.free!,'room-0').run).toBeLessThan(16);
});
test('free defaults preserve explicit length overrides and disabled switches',()=>{
 expect(freeLengthLimits(base)).toEqual({straight:8,run:16});
 expect(freeLengthLimits({...base,design:{...DEFAULT_DESIGN_LIMITS,maxForcedStraight:11,maxForcedRun:22,disabledLimits:['maxForcedRun']}})).toEqual({straight:11,run:Infinity});
});
for(const seed of ['corridors-a','corridors-c'])test(`ordinary backtracker ${seed} grows distinct physical bounded paths without a fixed seed scaffold`,()=>{
 const maze=generateOrganic({...base,seed});
 expect(maze.free!.modules).toHaveLength(40);
 const n=freeGroundLengths(maze);
 expect(n.straight).toBeLessThanOrEqual(8+1e-7);expect(n.run).toBeLessThanOrEqual(16+1e-7);
 expect(maze.free!.modules.every(m=>m.id==='junction-3'||/^m-/.test(m.id))).toBe(true);
},25000);

test('short-decision ordinary growth completes substantial forks and replays a full forty-module card',()=>{
 const parameters:Parameters={...base,columns:100,rows:100,algorithm:'prim',seed:'short-decisions-1',freeAngleSpread:0,design:{...DEFAULT_DESIGN_LIMITS,maxForcedStraight:4,maxForcedRun:8,disabledLimits:['maxVisibleStraight']}};
 const maze=generateOrganic(parameters),r=freeRuntime(maze),n=freeGroundLengths(maze);
 expect(maze.free!.modules).toHaveLength(40);
 expect(n.straight).toBeLessThanOrEqual(4+1e-7);expect(n.run).toBeLessThanOrEqual(8+1e-7);
 const genuine=r.passages.filter(ns=>ns.filter(i=>r.passages[i]!.length>1||maze.free!.modules.find(m=>m.id===r.rooms[i]!.id)?.type==='2x6').length>=3);
 expect(genuine.length).toBeGreaterThanOrEqual(8);
 expect(maze.free!.modules.some(m=>m.type==='2x6')).toBe(true);
 expect(serialize(generateOrganic(parameters))).toBe(serialize(maze));
},30000);

test('a real portal in a degree-two room terminates the physical run there',()=>{
 const draft=mazeDraft(freeRooms(10,1));
 draft.layout.openings[1]!.room='room-5';draft.layout.openings[1]!.edge=0;
 roomPanels(draft.layout);
 expect(freeGroundLengths(freeMaze(draft)).run).toBeLessThan(12);
});
