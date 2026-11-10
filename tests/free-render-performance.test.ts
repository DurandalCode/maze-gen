import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {DEFAULT_CONSTRUCTION,portalPoint,walls} from '../src/core/maze';
import {domainOf} from '../src/core/domain';
import {freeMaze,freePortal,freeRuntime} from '../src/free/layout';
import {emptyLayout} from '../src/free/model';
import {timberStructure,supportColliders} from '../src/core/structure';
import {timberMesh} from '../src/renderer/timber-mesh';
import {freeMesh} from '../src/free/mesh';
import {disposeMeshes} from '../src/renderer/dispose';
import {CollisionWorld} from '../src/simulation/collisions';
import {Player} from '../src/simulation/player';
import {routePoints} from '../src/core/pathfinding';
function fixture(){
 const l=emptyLayout();l.modules=[{id:'long',type:'2x6',x:10,z:10,angle:23},{id:'side',type:'2x2',x:0,z:0,angle:23}];
 // Rotate a midpoint T connection and its asymmetric wall fragments together.
 const angle=23*Math.PI/180;l.modules[1]!.x=10+1.5*Math.cos(angle)-4*Math.sin(angle);l.modules[1]!.z=10+1.5*Math.sin(angle)+4*Math.cos(angle);
 l.connections=[{id:'t',a:{room:'long',edge:2,offset:-1.5},b:{room:'side',edge:0,offset:0},width:1.4}];l.openings=[{id:'in',room:'long',edge:3,offset:0,width:1.4},{id:'out',room:'side',edge:2,offset:0,width:1.4}];l.entrance='in';l.exit='out';
 return freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:24,rows:24,moduleSize:2,corridorWidth:2,extraConnections:0,seed:'rail-regression',algorithm:'backtracker'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:l});
}
test('clipped lower rails stay perpendicular to their wall and every board stays above the ground',()=>{
 const m=fixture(),rails=timberStructure(m).lowerFrames!;expect(rails.length).toBeGreaterThan(4);
 for(const r of rails){expect(r.inward.x*(r.x2-r.x1)+r.inward.z*(r.z2-r.z1)).toBeCloseTo(0,10);expect(Math.hypot(r.inward.x,r.inward.z)).toBeCloseTo(1,10);}
 const group=timberMesh(m),boards=group.getObjectByName('timber-boards') as THREE.InstancedMesh,matrix=new THREE.Matrix4(),p=new THREE.Vector3();
 for(let i=0;i<boards.count;i++){boards.getMatrixAt(i,matrix);for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])expect(p.set(x,y,z).applyMatrix4(matrix).y).toBeGreaterThanOrEqual(-1e-5);}
 disposeMeshes(group);
});
test('free scene batches walls and roofs without moving panels or blocking the reference route',()=>{
 const m=fixture(),group=freeMesh(m),fabric=group.getObjectByName('fabric-walls') as THREE.InstancedMesh,roof=group.getObjectByName('free-roof') as THREE.Mesh;
 expect(fabric).toBeInstanceOf(THREE.InstancedMesh);expect(fabric.count).toBe(walls(m).length);expect(roof).toBeInstanceOf(THREE.Mesh);expect(group.children.filter(c=>c instanceof THREE.Mesh)).toHaveLength(3);
 const matrix=new THREE.Matrix4(),p=new THREE.Vector3();for(const [i,w]of walls(m).entries()){fabric.getMatrixAt(i,matrix);expect(p.set(0,0,0).applyMatrix4(matrix).x).toBeCloseTo((w.x1+w.x2)/2,5);expect(p.z).toBeCloseTo((w.z1+w.z2)/2,5);}
 let area=0;const indices=roof.geometry.index!,positions=roof.geometry.getAttribute('position'),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();for(let i=0;i<indices.count;i+=3){a.fromBufferAttribute(positions,indices.getX(i));b.fromBufferAttribute(positions,indices.getX(i+1));c.fromBufferAttribute(positions,indices.getX(i+2));area+=b.sub(a).cross(c.sub(a)).length()/2;}expect(area).toBeCloseTo(domainOf(m).area,4);
 const world=new CollisionWorld([...walls(m),...supportColliders(m)]),route=routePoints(m);for(let i=1;i<route.length;i++){const a=route[i-1]!,b=route[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);}
 disposeMeshes(group);
});
test('movement geometry is cached per immutable layout and player movement cannot mutate a cached opening',()=>{
 const m=fixture(),domain=domainOf(m),portal=freePortal(m,m.free!.entrance),start={...portal.mid};
 expect(domainOf({...m,roof:false})).toBe(domain);expect(freePortal(m,m.free!.entrance)).toBe(portal);expect(freeRuntime(m)).toBe(freeRuntime(m));
 const player=new Player(m,new CollisionWorld([...walls(m),...supportColliders(m)]));player.position.x+=.1;expect(portal.mid).toEqual(start);expect(portalPoint(m,m.entrance)).toEqual(start);
 const changed=fixture();expect(domainOf(changed)).not.toBe(domain);
});
