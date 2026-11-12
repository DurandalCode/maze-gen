import {expect,test} from 'bun:test';
import {maximumSpanPlacement} from '../src/free/span-placement';
import {maximumConnectionGap} from '../src/free/connection-span';
import {anchorGeometry,connectionGeometry,freeMaze,validateFree} from '../src/free/layout';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {DEFAULT_CONSTRUCTION,DEFAULT_DESIGN_LIMITS,walls,type Parameters} from '../src/core/maze';
import {generateOrganic} from '../src/free/organic';
import {freeRuntime} from '../src/free/layout';
import {freeGroundLengths} from '../src/free/path-limits';
import {organicCharacter} from '../src/free/organic-character';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {freeIdentity} from '../src/free/json';

function fixture(columns:number):FreeDraft{
 const l=emptyLayout();l.modules=[{id:'a',type:'2x2',x:5,z:5,angle:0},{id:'b',type:'2x2',x:0,z:0,angle:0}];
 l.connections=[{id:'c',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.6}];
 l.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.6},{id:'out',room:'b',edge:1,offset:0,width:1.6}];l.entrance='in';l.exit='out';
 return {kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns,rows:20,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'span-fixture'},construction:{...DEFAULT_CONSTRUCTION},layout:l};
}
function placement(draft:FreeDraft,span:number){
 const l=draft.layout,c=l.connections[0]!,a=anchorGeometry(l,c.a,c.width),m=l.modules[1]!;
 m.x=0;m.z=0;const b=anchorGeometry(l,c.b,c.width),gap=maximumConnectionGap(a,b,span);
 m.x=a.mid.x+a.normal.x*gap-b.mid.x;m.z=a.mid.z+a.normal.z*gap-b.mid.z;
 const errors=validateFree(draft,false);
 return errors.length?{ok:false as const,kind:'geometry' as const,reason:errors[0]!.message}:{ok:true as const};
}
test('maximum spacing remains 3 m when geometry permits it',()=>{
 const d=fixture(20),result=maximumSpanPlacement([d],3,placement,()=>false)!;
 expect(result.span).toBe(3);expect(result.reason).toBeUndefined();expect(validateFree(d)).toEqual([]);
});
test('another orientation at 3 m wins over a compact placement of the first one',()=>{
 const blocked=fixture(14);blocked.layout.modules[1]!.type='2x6';
 const full=fixture(14);full.layout.modules[1]!.type='2x6';full.layout.modules[1]!.angle=90;full.layout.connections[0]!.b.edge=2;
 const result=maximumSpanPlacement([blocked,full],3,placement,()=>false)!;
 expect(result.candidate).toBe(full);expect(result.span).toBe(3);expect(result.reason).toBeUndefined();
});
test('only an actual site boundary permits a locally maximal, recorded fallback',()=>{
 const d=fixture(10.4),result=maximumSpanPlacement([d],3,placement,()=>false)!;
 expect(result.reason).toContain('площадк');expect(result.span).toBeGreaterThan(2.38);expect(result.span).toBeLessThanOrEqual(2.4);
 expect(validateFree(d)).toEqual([]);
 const g=connectionGeometry(d.layout,d.layout.connections[0]!);expect(Math.max(...g.sides.map(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1)))).toBeCloseTo(result.span,7);
});
test('a length rejection cannot silently turn into a smaller-module-gap solution',()=>{
 const d=fixture(20),attempted:number[]=[];
 const result=maximumSpanPlacement([d],3,(candidate,span)=>{attempted.push(span);const geometry=placement(candidate,span);return geometry.ok?{ok:false,kind:'length',reason:'Проход слишком длинный.'}:geometry;},()=>false);
 expect(result).toBeUndefined();expect(attempted).toEqual([3]);
});
test('span provenance cannot change a native physical topology identity',()=>{
 const d=fixture(20);placement(d,3);const plain=freeIdentity(freeMaze(d));
 d.layout.connections[0]!.spanAudit={desired:3,actual:3};
 expect(freeIdentity(freeMaze(d))).toEqual(plain);
 expect(deserialize(serialize(freeMaze(d))).free!.connections[0]!.spanAudit).toEqual({desired:3,actual:3});
});

test('40 modules can maximize 3 m spans through genuine branching instead of compaction',()=>{
 const parameters:Parameters={placementMode:'free',columns:100,rows:100,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'organic-maximum-13',freeModuleTarget:40,freeJunctionDegree:3,freeAngleSpread:80,freeSpanPolicy:'maximum',freeConnectionSpan:3,design:{...DEFAULT_DESIGN_LIMITS,disabledLimits:['maxVisibleStraight']}};
 const maze=generateOrganic(parameters),r=freeRuntime(maze),lengths=freeGroundLengths(maze),character=organicCharacter(maze.free!);
 expect(maze.free!.modules).toHaveLength(40);expect(lengths.straight).toBeLessThanOrEqual(8+1e-7);expect(lengths.run).toBeLessThanOrEqual(16+1e-7);
 // An adjacent two-room branch or a substantial 2x6 terminal is a real arm;
 // a lone small dead-end must never qualify as the required extra choice.
 const genuine=r.passages.filter(ns=>ns.filter(n=>r.passages[n]!.length>1||maze.free!.modules.find(m=>m.id===r.rooms[n]!.id)?.type==='2x6').length>=3);
 expect(genuine.length).toBeGreaterThanOrEqual(9);
 expect(character.axisDirections).toBeGreaterThan(20);
 expect(character.spanAudit!.audited).toBe(39);expect(character.spanAudit!.atMaximum/39).toBeGreaterThan(.9);
 expect(character.spanAudit!.fallbacks.every(f=>!!f.reason&&f.actual<f.desired)).toBe(true);
 const world=new CollisionWorld([...walls(maze),...supportColliders(maze)]);
 for(const path of [...r.edgePaths.values(),...r.portalPaths.values()])for(let i=1;i<path.length;i++){
  const a=path[i-1]!,b=path[i]!,moved=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(moved.x-b.x,moved.z-b.z)).toBeLessThan(1e-5);
 }
 expect(serialize(generateOrganic(parameters))).toBe(serialize(maze));
},20000);
