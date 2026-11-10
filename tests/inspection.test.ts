import {test,expect} from 'bun:test';
import {generate} from '../src/generators/generate';
import {walls,portalPoint} from '../src/core/maze';
import {domainOf} from '../src/core/domain';
import {supportColliders} from '../src/core/structure';
import {Player} from '../src/simulation/player';
import {CollisionWorld} from '../src/simulation/collisions';
const maze=generate({columns:3,rows:2,corridorWidth:2,extraConnections:0,algorithm:'backtracker',seed:'inspection'});
const make=(mode:'walk'|'inspection')=>new Player(maze,new CollisionWorld([...walls(maze),...supportColliders(maze)]),mode);
test('inspection starts outside, respects fabric walls and bounds the surrounding ground',()=>{
 const p=make('inspection');expect(domainOf(maze).contains(p.position)).toBe(false);
 p.updateAnalog(10,1,0);expect(p.position.z).toBeGreaterThan(maze.depth+.24);
 p.position={x:maze.width+19,z:maze.depth+6};p.yaw=-Math.PI/2;p.updateAnalog(5,1,0);expect(p.position.x).toBe(maze.width+20);
 expect(p.recorder.distance).toBe(0);expect(p.recorder.elapsed).toBe(0);expect(p.recorder.samples).toHaveLength(1);
});
test('inspection never completes at the exit; normal walking still cannot escape through the entrance',()=>{
 const inspect=make('inspection');inspect.position=portalPoint(maze,maze.exit);inspect.updateAnalog(.1,0,0);expect(inspect.finished).toBe(false);
 const walk=make('walk');walk.updateAnalog(2,-1,0);expect(domainOf(maze).contains(walk.position)).toBe(true);
 walk.position=portalPoint(maze,maze.exit);walk.updateAnalog(.1,0,0);expect(walk.finished).toBe(true);
});
test('two-storey inspection remains on surrounding ground without invoking stair navigation',()=>{
 const m=generate({generationType:'two-storey',columns:5,rows:5,moduleSize:2,corridorWidth:2,minFloorChanges:4,extraConnections:2,algorithm:'backtracker',seed:'two-test'}),p=new Player(m,new CollisionWorld([...walls(m),...supportColliders(m)]),'inspection');
 const before=p.position.z;p.updateAnalog(1,-1,0);expect(p.position.z).toBeGreaterThan(before);expect(p.position.y).toBe(0);expect(p.finished).toBe(false);
});
