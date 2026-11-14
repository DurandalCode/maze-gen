import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {deserialize, serialize} from '../src/persistence/maze-json';
import {domainOf} from '../src/core/domain';
import {cellCenter, walls} from '../src/core/maze';
import {metrics} from '../src/core/metrics';
import {supportColliders} from '../src/core/structure';
import {routePoints} from '../src/core/pathfinding';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';
import {contourQuality} from '../src/generators/contours';
import {CollisionWorld} from '../src/simulation/collisions';
import {Player} from '../src/simulation/player';
import {freeRuntime,physical,validateFree} from '../src/free/layout';
import {mazeDraft} from '../src/free/json';
import {auditModuleWalls} from '../src/free/module-origin';
import {selectOppositePortals} from '../src/free/opposite-portals';
import {readClassicalColdspotProof} from './distribution-coldspot-proof';
import {validateLibraryExport} from '../src/persistence/library-export';
import {bridgeRouteErrors,bridgeRouteSummary} from '../src/free/bridge-route';

const root = resolve(Bun.argv[2] ?? 'examples/bundles/distribution-v2');
const manifest = await Bun.file(resolve(root, 'manifest.json')).json();
assert(manifest.maps.length >= 1 && manifest.maps.length <= 10);
if (manifest.version >= 2) {
  assert.equal(manifest.targetModules.target, 75);
  assert.equal(manifest.targetModules.max, 75);
}
const hashes = new Set<string>();
const pack=validateLibraryExport(await Bun.file(resolve(root,'bundle.json')).json());
assert.equal(pack.mazes.length,manifest.maps.length);assert.equal(pack.walks.length,0);
for (const [index,item] of manifest.maps.entries()) {
  const raw = await Bun.file(resolve(root, item.file)).text();
  const hash = createHash('sha256').update(raw).digest('hex');
  assert.equal(hash, item.sha256);
  assert(!hashes.has(hash), 'Duplicate maps'); hashes.add(hash);
  const maze = deserialize(raw), d = domainOf(maze), m = metrics(maze);
  assert.equal(serialize(pack.mazes[index]!.maze),serialize(maze),'Bundle differs from selected source');
  assert.equal(pack.mazes[index]!.title,item.title);
  assert.deepEqual(deserialize(serialize(maze)), maze);
  const count = maze.free?.modules.length ?? maze.layout?.modules.length ?? d.modules.reduce((a, b) => a + b, 0);
  assert.equal(count, item.modules);
  assert(count >= (item.minimumModules??manifest.targetModules.min) && count <= manifest.targetModules.max);
  assert.equal(maze.parameters.generationType??'classical',item.generationType??item.type);
  assert.equal(maze.roof, true); assert.equal(m.components, 1); assert(m.reachable);
  if(!maze.free)assert.equal(m.cycles, maze.parameters.extraConnections);
  if(item.cycles!==undefined)assert.equal(m.cycles,item.cycles);
  assert((maze.parameters.routeTrapCount ?? 0) >= manifest.minimumRouteTraps);
  assert((maze.parameters.loopTrapCount ?? 0) >= manifest.minimumLoopTraps);
  const routes = routeTraps(maze).qualifiedCount, loops = loopTraps(maze).qualifiedCount;
  assert(routes >= manifest.minimumRouteTraps, 'Missing qualified route trap');
  assert(loops >= manifest.minimumLoopTraps, 'Missing qualified return loop');
  if (item.qualifiedRouteTraps !== undefined) assert.equal(routes, item.qualifiedRouteTraps);
  if (item.qualifiedLoopTraps !== undefined) assert.equal(loops, item.qualifiedLoopTraps);
  if(maze.free){
    assert(['free-hybrid','vortex-hybrid','free-bridges'].includes(item.type));
    if(item.type==='free-hybrid')assert.equal(maze.parameters.freeCavityMaze,true);
    if(item.type==='vortex-hybrid')assert.equal(maze.parameters.freeVortexHybrid,true);
    if(item.type==='free-bridges'){
      assert.deepEqual(bridgeRouteErrors(maze),[]);assert(bridgeRouteSummary(maze).required.length>=1);
      assert.equal(maze.free.bridges?.length,2);assert.equal(maze.fabricTransmissionStrength,.25);
    }
    assert.deepEqual(validateFree(mazeDraft(maze)),[]);
    if(maze.free.moduleConstruction)assert.deepEqual(auditModuleWalls(maze.free).issues,[]);
    const gates=maze.free.openings.filter(o=>o.id===maze.free!.entrance||o.id===maze.free!.exit);
    assert.equal(gates.length,2);assert(selectOppositePortals(maze.free,gates,Math.min(...gates.map(o=>o.width))).length>0);
  }else{assert.equal(maze.entrance.side,'west');assert.equal(maze.exit.side,'east');}
  if (item.type === 'living') assert(contourQuality(maze).certified);
  if(item.squareFootprint)assert.equal(maze.width,maze.depth);
  if(manifest.version>=2&&item.type==='classical')assert.deepEqual(await readClassicalColdspotProof(root,raw),item.coldspots);
  assert.equal(mazePortalPrivacy(maze, false).certified, item.portalPrivacy);
  const world = new CollisionWorld(maze.free?physical(maze.free).obstacles:[...walls(maze), ...supportColliders(maze)]);
  let checked = 0;
  if(maze.free){
    const runtime=freeRuntime(maze);
    for(const path of [...runtime.edgePaths.values(),...runtime.portalPaths.values()]) {
      if(path.some(p=>p.bridge||(p.y??0)>.01))continue;
      for(let i=1;i<path.length;i++)for(const [start,end] of [[path[i-1]!,path[i]!],[path[i]!,path[i-1]!]]) {
        const moved=world.move(start!,{x:end!.x-start!.x,z:end!.z-start!.z});
        assert(Math.hypot(moved.x-end!.x,moved.z-end!.z)<1e-5,'Blocked free path');
      }
      checked++;
    }
  }else for (const a of d.cells) for (const b of maze.passages[a]!) if (b > a) {
    const from = cellCenter(maze, a), to = cellCenter(maze, b);
    for (const [start, end] of [[from, to], [to, from]]) {
      const moved = world.move(start!, {x: end!.x - start!.x, z: end!.z - start!.z});
      assert(Math.hypot(moved.x - end!.x, moved.z - end!.z) < 1e-5, `Blocked opening ${a}:${b}`);
    }
    checked++;
  }
  const player = new Player(maze, world);
  for (const target of routePoints(maze).slice(1)) {
    for (let step = 0; step < 10000 && !player.finished; step++) {
      const dx = target.x - player.position.x, dz = target.z - player.position.z;
      const distance = Math.hypot(dx, dz); if (distance < 1e-6) break;
      player.yaw = Math.atan2(-dx, -dz);
      const before = {...player.position};
      player.updateAnalog(Math.min(.02, distance / 1.4), 1, 0);
      assert(Math.hypot(player.position.x - before.x, player.position.z - before.z) > 1e-8, 'Player stuck');
    }
  }
  assert(player.finished, 'Player did not reach the exit');
  console.log(`${item.title}: ${count} modules; route traps ${routes}; loop traps ${loops}; ${checked} openings in both directions; Player finished.`);
}
