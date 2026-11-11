import {expect, test} from 'bun:test';
import {CollisionWorld} from '../src/simulation/collisions';
import {wallDistance} from '../src/free/geometry';

test('movement checks collisions at the current elevation and preserves spatial metadata', () => {
  const world = new CollisionWorld([{x1:1,z1:-2,x2:1,z2:2,y:3,height:2.5}]);
  const start = {x:0,z:0,y:3,floor:1,stair:7};
  const end = world.move(start,{x:2,z:0});
  expect(end.x).toBeLessThan(.73);
  expect(end.y).toBe(3);
  expect(end.floor).toBe(1);
  expect(end.stair).toBe(7);
  expect(world.move({...start,y:0,floor:0},{x:2,z:0}).x).toBeCloseTo(2);
});

test('spatial hash includes the complete thick wall solid across bucket boundaries', () => {
  for (const wall of [
    {x1:1.8,z1:0,x2:1.8,z2:4,thickness:1},
    {x1:0,z1:1.8,x2:4,z2:1.8,thickness:1},
    {x1:1.8,z1:1.8,x2:4,z2:4,thickness:1},
  ]) {
    const world = new CollisionWorld([wall]);
    for (let x=0;x<5;x+=.1) for(let z=0;z<5;z+=.1) {
      expect(world.blocked({x,z},.01)).toBe(wallDistance({x,z},wall)<.01-1e-8);
    }
  }
});
