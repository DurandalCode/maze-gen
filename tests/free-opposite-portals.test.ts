import {expect,test} from 'bun:test';
import {selectOppositePortals} from '../src/free/opposite-portals';
import {anchorGeometry} from '../src/free/layout';
import {emptyLayout,type Anchor} from '../src/free/model';

const anchor=(edge:number,offset=0):Anchor=>({room:'hall',edge,offset});
function hall(angle=0){
  const l=emptyLayout(),c=Math.cos(angle),s=Math.sin(angle);
  l.spaces.push({id:'hall',kind:'hall',polygon:[[-10,-5],[10,-5],[10,5],[-10,5]].map(([x,z])=>({x:x!*c-z!*s,z:x!*s+z!*c}))});
  return l;
}
test('opposite portals prefer distant external sides and reject adjacent corners',()=>{
  const l=hall(),a=anchor(3),b=anchor(1),cornerNorth=anchor(0,9),cornerEast=anchor(1,-4);
  const pairs=selectOppositePortals(l,[a,b,cornerNorth,cornerEast],1);
  expect(pairs.length).toBeGreaterThan(0);
  expect(pairs.some(p=>p.a===a&&p.b===b)).toBe(true);
  expect(pairs.some(p=>p.a===cornerNorth&&p.b===cornerEast)).toBe(false);
  expect(pairs.every(p=>p.length>=20)).toBe(true);
  expect(pairs.map(p=>p.length)).toEqual(pairs.map(p=>p.length).sort((a,b)=>b-a));
});
test('support planes and opposite sides rotate with actual construction',()=>{
  const l=hall(Math.PI*.37),a=anchor(3),b=anchor(1);
  const pairs=selectOppositePortals(l,[a,b],1.4);
  expect(pairs).toHaveLength(1);
  expect(pairs[0]!.length).toBeCloseTo(20,8);
  const ga=anchorGeometry(l,a,1.4),gb=anchorGeometry(l,b,1.4);
  expect(ga.normal.x*gb.normal.x+ga.normal.z*gb.normal.z).toBeCloseTo(-1,8);
});
test('inward or nearby corner candidates do not become a fallback pair',()=>{
  const l=hall();
  l.modules.push({id:'middle',type:'2x2',x:0,z:0,angle:0});
  expect(selectOppositePortals(l,[anchor(0,9),anchor(1,-4)],1)).toEqual([]);
  expect(selectOppositePortals(l,[{room:'middle',edge:3,offset:0},anchor(1)],1)).toEqual([]);
  expect(selectOppositePortals(emptyLayout(),[],1)).toEqual([]);
});
test('portal separation must span 85 percent of real extent along its direction',()=>{
  const l=emptyLayout();
  l.spaces.push({id:'hall',kind:'hall',polygon:[{x:0,z:0},{x:4,z:0},{x:4,z:100},{x:0,z:100}]});
  // Opposed left/right support planes, but the offset pair only crosses a small
  // part of this tall construction in the direction of its diagonal.
  expect(selectOppositePortals(l,[anchor(3,39),anchor(1,-40)],1)).toEqual([]);
});
