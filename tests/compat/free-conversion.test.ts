import {test,expect} from 'bun:test';
import legacy from '../fixtures/legacy-framed-halls.json';
import {deserialize,serialize} from '../../src/persistence/maze-json';
import {convertToFree} from '../../src/free/convert';
import {anchorGeometry,freeMaze,validateFree} from '../../src/free/layout';
import {walls} from '../../src/core/maze';
import {timberStructure,supportColliders} from '../../src/core/structure';
import {metrics} from '../../src/core/metrics';
import {routePoints} from '../../src/core/pathfinding';
import {CollisionWorld} from '../../src/simulation/collisions';

test('legacy halls containing perimeter 2×6 frames retain open floor, semantic topology and physical construction',()=>{
 const source=deserialize(JSON.stringify(legacy)),before=serialize(source),draft=convertToFree(source);
 expect(validateFree(draft)).toEqual([]);expect(draft.layout.spaces.filter(s=>s.kind==='hall')).toHaveLength(2);
 expect(draft.layout.modules.filter(m=>m.frameOnly)).toHaveLength(4);
 const maze=freeMaze(draft),old=metrics(source),next=metrics(maze);
 expect(walls(maze)).toEqual(walls(source));expect(next.area).toBe(old.area);expect(next.cycles).toBe(old.cycles);expect(next.components).toBe(1);
 expect(next.cells).toBe(old.cells);expect(next.corridors).toBe(old.corridors);expect(next.deadEnds).toBe(old.deadEnds);expect(next.junctions).toBe(old.junctions);
 const keys=(p:{x:number;z:number}[])=>p.map(p=>[p.x,p.z].map(v=>(Math.round(v*1e6)/1e6).toFixed(6)).join(':')).sort();
 expect(keys(timberStructure(maze).posts)).toEqual(keys(timberStructure(source).posts));
 const world=new CollisionWorld([...walls(maze),...supportColliders(maze)]),route=routePoints(maze);
 expect(route.length).toBeGreaterThan(2);
 for(let i=1;i<route.length;i++){const a=route[i-1]!,b=route[i]!,p=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(p.x-b.x,p.z-b.z)).toBeLessThan(1e-5);}
 expect(deserialize(serialize(maze))).toEqual(maze);expect(serialize(source)).toBe(before);
 const module=draft.layout.modules.find(m=>!m.frameOnly&&m.type==='2x6')!;
 expect(()=>anchorGeometry(draft.layout,{room:module.id,edge:0,offset:0},6)).toThrow('1–3');
});
test('free connection overlap geometry is rebuilt after edits of the same draft objects',()=>{
 const draft=convertToFree(deserialize(JSON.stringify(legacy)));expect(validateFree(draft)).toEqual([]);
 const anchor=draft.layout.connections[0]!.b,offset=anchor.offset;anchor.offset+=100;
 expect(validateFree(draft).some(i=>i.code==='anchor')).toBe(true);anchor.offset=offset;expect(validateFree(draft)).toEqual([]);
 const frame=draft.layout.modules.find(m=>m.frameOnly)!,x=frame.x;frame.x+=1;
 expect(validateFree(draft).some(i=>i.code==='frame')).toBe(true);frame.x=x;expect(validateFree(draft)).toEqual([]);
});
