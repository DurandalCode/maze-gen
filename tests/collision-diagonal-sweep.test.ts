import {expect,test} from 'bun:test';
import {CollisionWorld} from '../src/simulation/collisions';
import {movementClearance} from '../src/free/geometry';
test('a physically clear diagonal follows its requested sweep around a post in both directions',()=>{
 const post={x1:0,z1:0,x2:0,z2:0,thickness:.12},world=new CollisionWorld([post]),offset=.12+Math.SQRT2*.251,a={x:-.5,z:-.5+offset},b={x:.5-offset,z:.5};expect(movementClearance(a,b,post)).toBeGreaterThan(.25);
 for(const [from,to]of [[a,b],[b,a]]as const){const end=world.move(from,{x:to.x-from.x,z:to.z-from.z});expect(Math.hypot(end.x-to.x,end.z-to.z)).toBeLessThan(1e-8);}
});
test('a diagonal crossing a solid still collides and keeps axis sliding',()=>{
 const world=new CollisionWorld([{x1:0,z1:-2,x2:0,z2:2}]),end=world.move({x:-1,z:0},{x:2,z:1});expect(end.x).toBeLessThan(-.25);expect(end.z).toBeCloseTo(1,6);
});
