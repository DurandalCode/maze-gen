import {expect,test} from 'bun:test';
import {organicCharacter} from '../src/free/organic-character';
import {emptyLayout} from '../src/free/model';
test('reported module disorder ignores a global rotation and ninety-degree axis swaps',()=>{
 const l=emptyLayout();l.modules=[{id:'a',type:'2x2',x:3,z:3,angle:0},{id:'b',type:'2x2',x:7,z:3,angle:0}];l.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4}];const before=organicCharacter(l);expect(before.axisSpan).toBe(0);expect(before.gap.mean).toBe(2);
 const r=17*Math.PI/180;for(const m of l.modules){const x=m.x,z=m.z;m.x=x*Math.cos(r)-z*Math.sin(r);m.z=x*Math.sin(r)+z*Math.cos(r);m.angle+=17;}const turned=organicCharacter(l);expect(turned.axisSpan).toBeCloseTo(0,7);expect(turned.gap.mean).toBeCloseTo(before.gap.mean,7);l.modules[1]!.angle+=25;const varied=organicCharacter(l);expect(varied.axisSpan).toBeCloseTo(25,7);expect(varied.connectionBend.max).toBeCloseTo(25,7);l.modules[1]!.angle-=25;l.modules[1]!.angle+=90;expect(organicCharacter(l).axisSpan).toBeCloseTo(0,7);
});
