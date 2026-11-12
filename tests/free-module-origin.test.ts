import {expect,test} from 'bun:test';
import {auditModuleWalls} from '../src/free/module-origin';
import {emptyLayout} from '../src/free/model';
import {physical} from '../src/free/layout';
const fixture=()=>{const l=emptyLayout();l.modules=[{id:'a',type:'2x2' as const,x:3,z:3,angle:0},{id:'b',type:'2x2' as const,x:8,z:3,angle:0}];l.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4}];l.moduleConstruction={version:1,spans:[...l.connections]};return l;};
test('every ordinary modular wall has a genuine frame or two-module span origin',()=>{const l=fixture(),r=auditModuleWalls(l);expect(r.issues).toEqual([]);expect(r.walls.every(w=>w.origins.length)).toBe(true);expect(r.origins.filter(o=>o.kind==='span').every(o=>o.modules.length===2)).toBe(true);});
test('posts and navigation polygon corners cannot certify an independent partition',()=>{const l=fixture();l.walls.push({id:'loose',x1:2.2,z1:2.2,x2:3.8,z2:3.8});l.supports=[{x:2.2,z:2.2},{x:3.8,z:3.8}];expect(physical(l).posts.length).toBeGreaterThan(4);expect(auditModuleWalls(l).issues.some(i=>i.code==='module-origin')).toBe(true);});
test('a decorative frame or an intermediate post cannot extend a real module span',()=>{const l=fixture();l.modules[1]!.frameOnly=true;expect(auditModuleWalls(l).issues.length).toBeGreaterThan(0);l.modules[1]!.frameOnly=false;l.modules[1]!.x=10;l.supports=[{x:6,z:2.3},{x:6,z:3.7}];expect(auditModuleWalls(l).issues.some(i=>i.message.includes('длиннее3'))).toBe(true);});
