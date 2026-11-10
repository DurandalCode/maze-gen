import {expect,test} from 'bun:test';
import {classicalTransfer,packRoute,routeRuns} from '../src/generators/classical-transfer';
import {generate} from '../src/generators/generate';
import {metrics} from '../src/core/metrics';
import {materialEstimate} from '../src/core/materials';
import {moduleFootprints,supportColliders} from '../src/core/structure';
import {routePoints} from '../src/core/pathfinding';
import {walls} from '../src/core/maze';
import {CollisionWorld} from '../src/simulation/collisions';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {timberMesh} from '../src/renderer/timber-mesh';
import {disposeMeshes} from '../src/renderer/dispose';
import type {InstancedMesh} from 'three';
test('packing preserves ordered turns, does not revisit modules and is reproducible',()=>{
 const runs=[{dx:1,dz:0,length:10},{dx:0,dz:1,length:8},{dx:-1,dz:0,length:6},{dx:0,dz:1,length:6},{dx:1,dz:0,length:10}],path=packRoute(runs,12,'packing');
 expect(path).toHaveLength(13);expect(new Set(path.map(p=>`${p.x}:${p.z}`)).size).toBe(13);expect(packRoute(runs,12,'packing')).toEqual(path);
 const directions:string[]=[];for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,d=`${Math.sign(b.x-a.x)}:${Math.sign(b.z-a.z)}`;expect(Math.abs(b.x-a.x)+Math.abs(b.z-a.z)).toBe(1);if(directions.at(-1)!==d)directions.push(d);}
 expect(directions).toEqual(runs.map(r=>`${r.dx}:${r.dz}`));expect(()=>packRoute(runs,4,'bad')).toThrow();
});
test('route-only transfer fills an irregular ordinary modular maze without a shortcut or mutation',()=>{
 const source={...generate({columns:5,rows:5,corridorWidth:2,algorithm:'backtracker',seed:'transfer-fixture',extraConnections:0}),roof:true},snapshot=serialize(source),r=classicalTransfer(source,'transfer-test',30),m=r.maze;
 expect(moduleFootprints(m)).toHaveLength(30);expect(m.version).toBe(3);expect(m.parameters.generationType).toBe('classical');expect(m.roof).toBe(true);expect(metrics(m).components).toBe(1);expect(metrics(m).cycles).toBe(0);
 expect(routeRuns(m).map(r=>[r.dx,r.dz])).toEqual(routeRuns(source).map(r=>[r.dx,r.dz]));expect(serialize(source)).toBe(snapshot);expect(deserialize(serialize(m))).toEqual(m);expect(serialize(classicalTransfer(source,'transfer-test',30).maze)).toBe(serialize(m));
 const world=new CollisionWorld([...walls(m),...supportColliders(m)]),path=routePoints(m);for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.08);for(let j=1;j<=n;j++)expect(world.blocked({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n})).toBe(false);}
 expect(()=>classicalTransfer(source,'too-few',1)).toThrow();
});
test('material piece estimate matches the rendered timber construction',()=>{
 const source=generate({columns:3,rows:3,moduleSize:2,corridorWidth:2,algorithm:'prim',seed:'bill-of-materials',extraConnections:0}),estimate=materialEstimate(source),group=timberMesh(source),boards=group.getObjectByName('timber-boards') as InstancedMesh;
 expect(estimate.boardPieces).toBe(boards.count);expect(estimate.wallMetres).toBeGreaterThan(0);expect(estimate.timberMetres).toBeGreaterThan(estimate.upperMetres);expect(estimate.postPieces).toBe(2*estimate.posts);disposeMeshes(group);
});
