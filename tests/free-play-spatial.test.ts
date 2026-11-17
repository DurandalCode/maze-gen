import {describe,test,expect} from 'bun:test';
import {deserialize} from '../src/persistence/maze-json';
import {physical,freeDomain,freeRuntime,modulePolygon} from '../src/free/layout';
import {pointIn,segmentInside,intersection,ends,EPS} from '../src/free/geometry';
import {CollisionWorld} from '../src/simulation/collisions';
import type {Point} from '../src/core/maze';
import type {FreeLayout} from '../src/free/model';

const files=['03-free-hybrid.json','04-vortex-hybrid.json','05-free-bridges-revision02.json'];
describe('physical snapshot broad phase',()=>{
 for(const file of files)test(file+' retains exact floor and boundary clipping',async()=>{
  const maze=deserialize(await Bun.file(new URL('../examples/bundles/distribution-v2/'+file,import.meta.url)).text()),r=freeRuntime(maze),domain=freeDomain(maze);
  const brute=(p:Point)=>r.polygons.some(poly=>pointIn(p,poly))&&!r.holes.some(h=>pointIn(p,h,false));
  let state=7529;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
  let candidates=0,queries=0;
  for(let i=0;i<600;i++){
   const p=i<r.centers.length?r.centers[i]!:{x:rand()*maze.width,z:rand()*maze.depth};
   const q={x:p.x+(rand()-.5)*(i%3===0?30:.2),z:p.z+(rand()-.5)*(i%3===0?30:.2)};
   expect(r.contains(p)).toBe(brute(p));expect(r.contains(q)).toBe(brute(q));
   const local=r.nearbyBoundaries(p,q);candidates+=local.length;queries++;
   // Every exact crossing (including EPS-extended endpoints) must survive.
   const selected=new Set(local);
   for(const w of r.boundaries)if(intersection(p,q,...ends(w))!==null)expect(selected.has(w)).toBe(true);
   expect(segmentInside(p,q,r.contains,local)).toBe(segmentInside(p,q,brute,r.boundaries));
   const clipped=domain.constrain(p,q);
   // Compare the exact old clipping algorithm, including its boundary fallback.
   const original=domain.constrain;
   const nearby=r.nearbyBoundaries;
   r.nearbyBoundaries=()=>r.boundaries;
   try{expect(original(p,q)).toEqual(clipped);}finally{r.nearbyBoundaries=nearby;}
  }
  // A deterministic work bound, not a flaky wall-clock assertion.
  expect(candidates/queries).toBeLessThan(r.boundaries.length/5);
 },60000);
 test('rotated holes, thin edges and fresh geometry after in-place editing',()=>{
  for(const angle of [0,37,90,231]){
   const module={id:'m',type:'2x6' as const,x:10,z:10,angle},polygon=modulePolygon(module);
   const layout:FreeLayout={modules:[module],spaces:[{id:'court',kind:'hall',polygon:[{x:20,z:20},{x:30,z:20},{x:30,z:30},{x:20,z:30}],holes:[[{x:23,z:23},{x:27,z:23},{x:27,z:27},{x:23,z:27}]]}],connections:[],openings:[],walls:[],entrance:'',exit:''};
   const r=physical(layout),brute=(p:Point)=>r.polygons.some(poly=>pointIn(p,poly))&&!r.holes.some(h=>pointIn(p,h,false));
   for(const p of [...polygon,...polygon.map(p=>({x:p.x+EPS/2,z:p.z})),{x:25,z:25},{x:23,z:25},{x:23-EPS/2,z:25}])expect(r.contains(p)).toBe(brute(p));
   module.x=40;
   layout.spaces[0]!.polygon.forEach(p=>{p.x+=50;});
   const edited=physical(layout);
   expect(r.contains({x:10,z:10})).toBe(true);
   expect(edited.contains({x:10,z:10})).toBe(false);
   expect(edited.contains({x:40,z:10})).toBe(true);
   expect(r.contains({x:21,z:21})).toBe(true);
   expect(edited.contains({x:21,z:21})).toBe(false);
   expect(edited.contains({x:71,z:21})).toBe(true);
   const a={x:21,z:25},b={x:29,z:25};
   expect(segmentInside(a,b,r.contains,r.nearbyBoundaries(a,b))).toBe(false);
   // Broad phase never replaces the exact wall capsule test.
   const w=new CollisionWorld(r.obstacles);expect(w.blocked(polygon[0]!, .25)).toBe(true);
  }
 });
});
