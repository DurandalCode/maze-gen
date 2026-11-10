import {test,expect} from 'bun:test';
import {compactVoids} from '../src/generators/void-compaction';
import {corridorShell} from '../src/generators/corridor';
import {domainOf} from '../src/core/domain';
import {connect,neighbors,cellCenter,walls,type Parameters} from '../src/core/maze';
import {independentCycles,componentCount} from '../src/core/graph';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {withPortals} from '../src/core/portals';
import {supportColliders} from '../src/core/structure';
import {CollisionWorld} from '../src/simulation/collisions';
import {materialEstimate} from '../src/core/materials';
import {timberMesh} from '../src/renderer/timber-mesh';
import {disposeMeshes} from '../src/renderer/dispose';
import type {InstancedMesh} from 'three';
function fixture(){const p:Parameters={generationType:'corridor',columns:12,rows:8,moduleSize:2,corridorWidth:2,algorithm:'prim',seed:'squeeze-fixture',extraConnections:1},tiles=[];for(let z=0;z<8;z+=2)for(let x=0;x<12;x+=2)if(!x||!z||x===10||z===6)tiles.push({x,z});const m=corridorShell(p,tiles.map((t,i)=>({...t,id:`m${i}`,type:'2x2',rotation:0})),tiles.map(t=>({...t,kind:'corridor',width:2,height:2})),4);for(const c of domainOf(m).cells)for(const n of neighbors(m,c))if(n>c)connect(m,c,n);m.entrance={cell:0,side:'west',width:2};m.exit={cell:6*12+11,side:'east',width:2};return withPortals(m,[m.entrance,m.exit]);}
test('void strips shrink without inventing passages or collapsing a real ring into an open room',()=>{
 const m=fixture(),before=serialize(m),r=compactVoids(m),n=r.maze;
 expect(n.width*n.depth).toBeLessThan(m.width*m.depth);expect(r.targetRouteMetres).toBeLessThan(r.sourceRouteMetres);expect(componentCount(n)).toBe(1);expect(independentCycles(n)).toBe(1);expect(serialize(m)).toBe(before);expect(deserialize(serialize(n))).toEqual(n);expect(serialize(compactVoids(m).maze)).toBe(serialize(n));
 // At least one newly adjacent pair stays separated by a physical wall.
 expect(domainOf(n).cells.some(c=>neighbors(n,c).some(b=>!n.passages[c]!.includes(b)))).toBe(true);
 const world=new CollisionWorld([...walls(n),...supportColliders(n)]);for(const c of domainOf(n).cells)for(const b of n.passages[c]!)if(b>c){const a=cellCenter(n,c),q=cellCenter(n,b),end=world.move(a,{x:q.x-a.x,z:q.z-a.z});expect(Math.hypot(end.x-q.x,end.z-q.z)).toBeLessThan(1e-6);}
});
test('unsupported open halls are rejected rather than changed into corridors',()=>{const m=fixture();m.layout!.spaces!.push({kind:'hall',x:2,z:2,width:8,height:4});expect(()=>compactVoids(m)).toThrow('без залов');});
test('compacted frame estimate counts the geometry actually rendered',()=>{const m=compactVoids(fixture()).maze,g=timberMesh(m);expect(materialEstimate(m).boardPieces).toBe((g.getObjectByName('timber-boards') as InstancedMesh).count);disposeMeshes(g);});
