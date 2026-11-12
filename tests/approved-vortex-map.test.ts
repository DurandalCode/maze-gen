import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {FileStore} from '../server/store';
import {freeRuntime,freeGraphPath} from '../src/free/layout';
import {shortestPath} from '../src/core/pathfinding';
import {walls,type Point} from '../src/core/maze';
import {supportColliders} from '../src/core/structure';
import {CollisionWorld} from '../src/simulation/collisions';
import {Player} from '../src/simulation/player';
import {distance} from '../src/free/geometry';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {inspectHybridVortexDepth} from '../src/free/vortex-hybrid-depth';
import {freeGroundLengths} from '../src/free/path-limits';
const path=new URL('../examples/maps/approved-vortex-hybrid09.json',import.meta.url);

test('the human-approved map is the exact historical export and imports into a clean library',async()=>{
 const raw=await Bun.file(path).text();
 expect(createHash('sha256').update(raw).digest('hex')).toBe('32f8c1fcab136a91cc525558c25f52ba869724f02b6c940cb2f544babebe87a8');
 const maze=deserialize(raw);expect(serialize(maze)).toBe(raw);
 const root=await mkdtemp(join(tmpdir(),'maze-approved-example-'));
 try{const store=new FileStore(root),saved=await store.saveMaze(JSON.parse(raw),'Approved historical vortex hybrid09');
  expect(saved.id).toBe('5acfbf0115ba3765582b24f5');
  const loaded=await store.getMaze(saved.id);expect(serialize(loaded!.maze)).toBe(raw);
  expect((await store.listWalks())).toHaveLength(0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the saved example retains clear capsule paths, deep pure returns and a real Player finish',async()=>{
 const maze=deserialize(await Bun.file(path).text()),r=freeRuntime(maze),world=new CollisionWorld([...walls(maze),...supportColliders(maze)]);
 expect(maze.free!.modules).toHaveLength(96);expect(maze.roof).toBe(true);
 expect(routeTraps(maze).qualifiedCount).toBe(2);
 const loops=loopTraps(maze).candidates.filter(t=>t.qualifies);expect(loops).toHaveLength(2);
 const deep=inspectHybridVortexDepth(maze,{x:35,z:35});expect(deep.filter(d=>d.qualifies&&d.pure&&d.inwardExcursion>=10&&d.inwardBandConnections.length>=3)).toHaveLength(2);
 for(const p of [...r.edgePaths.values(),...r.portalPaths.values()])for(let i=1;i<p.length;i++){const a=p[i-1]!,b=p[i]!;expect(distance(world.move(a,{x:b.x-a.x,z:b.z-a.z}),b)).toBeLessThan(1e-5);}
 const tour:Point[]=[...r.portalPaths.get(maze.free!.entrance)!].reverse();let at=maze.entrance.cell;
 for(const loop of loops){tour.push(...freeGraphPath(maze,shortestPath(maze,at,loop.fork)).slice(1),...freeGraphPath(maze,loop.loop).slice(1));at=loop.fork;}
 tour.push(...freeGraphPath(maze,shortestPath(maze,at,maze.exit.cell)).slice(1),...r.portalPaths.get(maze.free!.exit)!.slice(1));
 const player=new Player(maze,world);for(const target of tour.slice(1)){let steps=0;while(!player.finished&&distance(player.position,target)>.01){if(++steps>2500)throw Error('Player stalled on approved example');const d=distance(player.position,target);player.yaw=Math.atan2(player.position.x-target.x,player.position.z-target.z);player.updateAnalog(Math.min(.02,d/1.4),1,0);}}
 expect(player.finished).toBe(true);const lengths=freeGroundLengths(maze);expect(lengths.straight).toBeLessThanOrEqual(8+1e-7);expect(lengths.run).toBeLessThanOrEqual(64+1e-7);
},15000);
