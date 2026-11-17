import {test,expect} from 'bun:test';
import {SpatialIndex,type Box} from '../src/free/spatial-index';
const overlap=(a:Box,b:Box)=>a.x1<=b.x2&&a.x2>=b.x1&&a.z1<=b.z2&&a.z2>=b.z1;
test('huge finite entries and queries use conservative bounded fallback in original order',()=>{
 const entries=[
  {id:'huge',box:{x1:-1e15,z1:-1e15,x2:1e15,z2:1e15}},
  {id:'local',box:{x1:0,z1:0,x2:2,z2:2}},
  {id:'distant',box:{x1:100,z1:100,x2:101,z2:101}},
  {id:'unsafe-cell-integer',box:{x1:1e30,z1:1e30,x2:1e30,z2:1e30}},
 ];
 const index=new SpatialIndex(entries,e=>e.box);
 for(const query of [{x1:1,z1:1,x2:1,z2:1},{x1:-1e20,z1:-1e20,x2:1e20,z2:1e20},{x1:1e30,z1:1e30,x2:1e30,z2:1e30}])
  expect(index.query(query)).toEqual(entries.filter(e=>overlap(e.box,query)));
 expect(index.at({x:1,z:1}).map(e=>e.id)).toEqual(['huge','local']);
});
test('nonfinite draft boxes and queries cannot enter nonadvancing bucket loops',()=>{
 const finite={x1:0,z1:0,x2:2,z2:2},infinite={x1:-Infinity,z1:-Infinity,x2:Infinity,z2:Infinity};
 const entries=[{id:'infinite',box:infinite},{id:'local',box:finite},{id:'nan',box:{...finite,x1:NaN}}];
 const index=new SpatialIndex(entries,e=>e.box);
 expect(index.query(infinite)).toEqual(entries);
 expect(index.query({...finite,x2:Infinity})).toEqual(entries);
 expect(index.at({x:NaN,z:0})).toEqual(entries);
 expect(index.at({x:1,z:1})).toEqual(entries);
 expect(new SpatialIndex([finite],b=>b,Infinity).at({x:1,z:1})).toEqual([finite]);
});
