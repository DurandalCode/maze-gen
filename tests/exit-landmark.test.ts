import {expect,test} from 'bun:test';
import {exitLandmarkHint} from '../src/core/exit-landmark';
import {DEFAULT_ENVIRONMENT,type Environment} from '../src/core/environment';
import {generateBase} from '../src/generators/generate';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {portalPoint} from '../src/core/maze';

const base=generateBase({columns:4,rows:4,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'exit-landmark'});
const environment=(side:Environment['forest']['side']):Environment=>({...DEFAULT_ENVIRONMENT,forest:{...DEFAULT_ENVIRONMENT.forest,side}});

test('start reminder follows the actual forest side and selected traversal pair',()=>{
 for(const side of ['north','east','south','west'] as const){
  const maze={...base,environment:environment(side)};
  expect(exitLandmarkHint(maze)).toBe(side==='east'||side==='south'?'Выход — к лесу':'Выход — к полю');
  expect(exitLandmarkHint({...maze,entrance:maze.exit,exit:maze.entrance})).toBe(side==='east'||side==='south'?'Выход — к полю':'Выход — к лесу');
 }
 expect(exitLandmarkHint(base)).toBe('Выход — к полю');
});

test('a direction parallel to the forest edge does not claim toward or away',()=>{
 const maze={...base,exit:{cell:6,side:'east' as const}};
 expect(portalPoint(maze,maze.entrance).z).toBe(portalPoint(maze,maze.exit).z);
 expect(exitLandmarkHint(maze)).toBe('Выход — вдоль опушки');
});

test('rotated free portals use world coordinates and do not modify a saved maze',async()=>{
 const raw=await Bun.file(new URL('../examples/maps/approved-vortex-hybrid09.json',import.meta.url)).text();
 const maze=deserialize(raw),before=serialize(maze),a=portalPoint(maze,maze.entrance),b=portalPoint(maze,maze.exit);
 expect(Math.abs(b.z-a.z)).toBeGreaterThan(1);
 expect(exitLandmarkHint({...maze,environment:environment('north')})).toBe(b.z<a.z?'Выход — к лесу':'Выход — к полю');
 expect(serialize(maze)).toBe(before);
});
