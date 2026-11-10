import {expect,test} from 'bun:test';
import {classicalPhysicalRoute} from '../src/core/physical-route';
import {emptyMaze,connect,walls,type Maze} from '../src/core/maze';
import {serialize} from '../src/persistence/maze-json';
import {pathLength,routePoints} from '../src/core/pathfinding';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
function fixture(){const m=emptyMaze({columns:2,rows:2,corridorWidth:2,algorithm:'prim',seed:'doorway-reference',extraConnections:0});connect(m,0,1);connect(m,1,3);connect(m,0,2);return m;}
test('classical doorway reference cuts corners without changing legacy centre lengths or saved topology',()=>{const m=fixture(),snapshot=serialize(m),legacy=pathLength(routePoints(m)),physical=classicalPhysicalRoute(m);expect(pathLength(physical)).toBeLessThan(legacy);expect(pathLength(routePoints(m))).toBe(legacy);expect(serialize(m)).toBe(snapshot);expect(classicalPhysicalRoute(m)).toEqual(physical);expect(physical[0]).toEqual(routePoints(m)[0]);expect(physical.at(-1)).toEqual(routePoints(m).at(-1));});
test('the classical physical reference is traversable with the same posts and walls as the player',()=>{const m=fixture(),world=new CollisionWorld([...walls(m),...supportColliders(m)]),points=classicalPhysicalRoute(m);for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.04);let at=a;for(let j=1;j<=n;j++){const next={x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n},end=world.move(at,{x:next.x-at.x,z:next.z-at.z});expect(Math.hypot(end.x-next.x,end.z-next.z)).toBeLessThan(1e-6);at=end;}}});
test('the legacy doorway adapter rejects other physical formats',()=>{expect(()=>classicalPhysicalRoute({...fixture(),version:4} as Maze)).toThrow('классическая');});
