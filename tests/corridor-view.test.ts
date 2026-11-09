import { analyzeColdspots,DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
import { expect,test } from 'bun:test';
import { emptyMaze,connect } from '../src/core/maze';
import { prepareNavigation } from '../src/analysis/navigation';
import { viewCorridor } from '../src/analysis/corridor-view';
import { assessWalk } from '../src/analysis/walk-assessment';

function maze() {return emptyMaze({columns:7,rows:3,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'sight'});}
test('corridor vision ends at an occluding corner and never reads geometry beyond it',()=>{
  const a=maze();connect(a,0,1);connect(a,1,2);connect(a,2,9);
  const context=prepareNavigation(a),before=viewCorridor(a,context,0,1);
  expect(before.end).toBe('bend');expect(before.endCell).toBe(2);
  connect(a,9,10);connect(a,10,11);
  expect(viewCorridor(a,context,0,1)).toEqual(before);
});
test('a straight corridor exposes side openings, visible dead ends and a finite sight limit',()=>{
  const a=maze();for(let i=0;i<6;i++)connect(a,i,i+1);connect(a,2,9);
  const context=prepareNavigation(a),full=viewCorridor(a,context,0,1);
  expect(full.length).toBe(13);expect(full.junctions).toBe(1);expect(full.end).toBe('dead-end');
  const limited=viewCorridor(a,context,0,1,5);expect(limited.length).toBe(5);expect(limited.end).toBe('limit');
});
test('observed walk assessment counts a longest-corridor choice from movement without inventing gaze data',()=>{
  const a=maze();for(let i=0;i<6;i++)connect(a,i,i+1);connect(a,1,8);
  const samples=[{x:1,z:1,time:0},{x:3,z:1,time:1},{x:5,z:1,time:2},{x:7,z:1,time:3}];
  const result=assessWalk(a,samples,6);
  expect(result.decisionCount).toBe(1);expect(result.comparableCorridorChoices).toBe(1);expect(result.longestCorridorChoices).toBe(1);
  expect(result.continuedStraight).toBe(1);expect(result.interpretation).toBe('movement-only');
});


test('a long visible corridor can attract a navigator more than a short route around a corner',()=>{
  const a=maze();
  for(let x=0;x<6;x++)connect(a,x,x+1);
  connect(a,7,0);for(let x=7;x<13;x++)connect(a,x,x+1);
  connect(a,13,20);for(let x=14;x<20;x++)connect(a,x,x+1);
  a.entrance={cell:7,side:'west'};a.exit={cell:1,side:'north'};a.wallHeight=1.8;
  const base=analyzeColdspots(a,{...DEFAULT_ANALYSIS,profile:'compass',decisionMode:'frontier',corridorPreference:0,samples:2048});
  const corridors=analyzeColdspots(a,{...DEFAULT_ANALYSIS,profile:'compass',decisionMode:'frontier',corridorPreference:2,samples:2048});
  expect(corridors.probability[8]!).toBeGreaterThan(base.probability[8]!+.2);
  expect(corridors.probability[1]).toBe(1);
});
