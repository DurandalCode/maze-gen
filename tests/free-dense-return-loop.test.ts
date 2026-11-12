import {expect,test} from 'bun:test';
import {attachDenseReturnLoop} from '../src/free/dense-return-loop';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,validateFree} from '../src/free/layout';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {serialize} from '../src/persistence/maze-json';

function crossingFixture(){
 const layout=emptyLayout(),ids=new Map<string,string>();
 const module=(x:number,z:number)=>{const key=`${x}:${z}`;if(!ids.has(key)){ids.set(key,`room-${ids.size}`);layout.modules.push({id:ids.get(key)!,type:'2x2',x,z,angle:0});}return ids.get(key)!;};
 const chain=(points:[number,number][])=>{for(let i=1;i<points.length;i++){const [x,z]=points[i-1]!,[u,v]=points[i]!,edge=u>x?1:u<x?3:v>z?2:0;layout.connections.push({id:`span-${layout.connections.length}`,a:{room:module(x,z),edge,offset:0},b:{room:module(u,v),edge:(edge+2)%4,offset:0},width:1.4});}};
 chain([[12,8],[12,12],[12,16]]);chain([[12,12],[16,12],[20,12]]);
 chain([[12,8],[8,8],[4,8],[4,12],[4,16],[8,16],[12,16]]);
 layout.openings=[{id:'in',room:module(12,8),edge:0,offset:0,width:1.4},{id:'out',room:module(12,16),edge:2,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';layout.moduleConstruction={version:1,spans:structuredClone(layout.connections)};
 const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:26,rows:24,moduleSize:2,corridorWidth:2,extraConnections:1,seed:'non-planar-return',algorithm:'prim'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout};
 expect(validateFree(draft)).toEqual([]);return {maze:freeMaze(draft,false),fork:module(12,12)};
}
test('opposite return doors cannot cross a connected main component; refusal preserves source geometry',()=>{
 const {maze,fork}=crossingFixture(),before=serialize(maze);
 expect(()=>attachDenseReturnLoop(maze,fork,'return-refusal')).toThrow('планарного возврата');expect(serialize(maze)).toBe(before);
});
test('missing route fork fails explicitly without changing the source',()=>{
 const {maze}=crossingFixture(),before=serialize(maze);expect(()=>attachDenseReturnLoop(maze,'missing','return-refusal')).toThrow('настоящим модулем');expect(serialize(maze)).toBe(before);
});

test('staggered native doors force a physical turn without shortening the spans',async()=>{
 const {staggerDenseReturnSpans}=await import('../src/free/dense-return-loop');
 const {anchorGeometry,connectionGeometry,physical,freeRuntime}=await import('../src/free/layout');
 const {CollisionWorld}=await import('../src/simulation/collisions');
 const {distance,ends}=await import('../src/free/geometry');
 const {maze}=crossingFixture(),draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:maze.parameters,construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:emptyLayout()};
 draft.layout.modules=[0,1,2].map(i=>({id:`b${i}`,type:'2x2',x:12,z:4+i*5,angle:0}));
 draft.layout.connections=[0,1].map(i=>({id:`s${i}`,a:{room:`b${i}`,edge:2,offset:0},b:{room:`b${i+1}`,edge:0,offset:0},width:1.4}));
 draft.layout.openings=[{id:'in',room:'b0',edge:0,offset:0,width:1.4},{id:'out',room:'b2',edge:2,offset:0,width:1.4}];draft.layout.entrance='in';draft.layout.exit='out';draft.layout.moduleConstruction={version:1,spans:[]};
 const before=draft.layout.connections.map(c=>connectionGeometry(draft.layout,c).sides.map(w=>distance(...ends(w))));
 staggerDenseReturnSpans(draft,['s0','s1'],{x:1,z:0});expect(validateFree(draft)).toEqual([]);
 const slices=draft.layout.connections.flatMap(c=>{const a=anchorGeometry(draft.layout,c.a,c.width),b=anchorGeometry(draft.layout,c.b,c.width);expect(a.mid.x).toBeCloseTo(b.mid.x,10);return [a,b].map(g=>({t:g.mid.z,lo:g.mid.x-.25,hi:g.mid.x+.25}));}).sort((a,b)=>a.t-b.t);
 // A capsule-clear line x=intercept+slope*z must intersect every eroded door.
 // The required slope intervals are disjoint, proving no straight shortcut.
 let lower=-Infinity,upper=Infinity;for(let i=0;i<slices.length;i++)for(let j=i+1;j<slices.length;j++){const a=slices[i]!,b=slices[j]!,dt=b.t-a.t;lower=Math.max(lower,(b.lo-a.hi)/dt);upper=Math.min(upper,(b.hi-a.lo)/dt);}expect(lower).toBeGreaterThan(upper);
 draft.layout.connections.forEach((c,i)=>connectionGeometry(draft.layout,c).sides.forEach((w,j)=>expect(distance(...ends(w))).toBeCloseTo(before[i]![j]!,10)));
 const runtime=freeRuntime(freeMaze(draft,false)),world=new CollisionWorld(physical(draft.layout).obstacles),start={x:12,z:4},end={x:12,z:14};expect(distance(world.move(start,{x:0,z:10}),end)).toBeGreaterThan(.1);
 for(const path of runtime.edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!;expect(distance(world.move(a,{x:b.x-a.x,z:b.z-a.z}),b)).toBeLessThan(1e-5);}
});

test('dense SE return keeps both separate dead-end traps and qualifies in the actual UI overlay',async()=>{
 const {deserialize}=await import('../src/persistence/maze-json');
 const {trapOverlay}=await import('../src/ui/trap-overlay');
 const {freeGroundLengths}=await import('../src/free/path-limits');
 const {auditModuleWalls}=await import('../src/free/module-origin');
 const {selectOppositePortals}=await import('../src/free/opposite-portals');
 const source=deserialize(await Bun.file(new URL('./fixtures/dense-return-loop-base.json',import.meta.url)).text()),before=serialize(source),fork=source.free!.modules.find(m=>m.id.startsWith('dense-apex-')&&m.id.endsWith('-7-frame-1'))!.id;
 const result=attachDenseReturnLoop(source,fork,source.parameters.seed+'-dense-return-v1');
 expect(serialize(source)).toBe(before);
 for(const frame of source.free!.modules.filter(m=>!m.id.startsWith('route-arm-')))expect(result.free!.modules.find(m=>m.id===frame.id)).toEqual(frame);
 expect(result.free!.spaces.filter(s=>s.kind==='hall')).toEqual(source.free!.spaces.filter(s=>s.kind==='hall'));
 expect(result.free!.openings).toEqual(source.free!.openings);expect(result.roof).toBe(true);
 expect(result.free!.modules.every(m=>m.type==='2x2'||m.type==='2x6')).toBe(true);
 expect(auditModuleWalls(result.free!).issues).toEqual([]);
 const lengths=freeGroundLengths(result);expect(lengths.straight).toBeLessThanOrEqual(8+1e-7);expect(lengths.run).toBeLessThanOrEqual(16+1e-7);
 const gates=result.free!.openings.filter(o=>o.id===result.free!.entrance||o.id===result.free!.exit);expect(selectOppositePortals(result.free!,gates,Math.min(...gates.map(g=>g.width))).length).toBeGreaterThan(0);
 const {validateParameters}=await import('../src/core/maze');
 const recipe={...result.parameters,routeTrapCount:2,loopTrapCount:1,extraConnections:1};expect(()=>validateParameters(recipe)).not.toThrow();expect(()=>validateParameters({...recipe,extraConnections:0})).toThrow();
 const reopened=deserialize(serialize({...result,parameters:recipe}));expect(reopened.parameters).toEqual(recipe);expect(reopened.free).toEqual(result.free);
 const entries=trapOverlay(result);expect(entries.filter(e=>e.kind==='dead-end').length).toBeGreaterThanOrEqual(2);expect(entries.filter(e=>e.kind==='loop')).toHaveLength(1);
},180000);

test('staggered offsets agree in world space for rotated native modules',async()=>{
 const {staggerDenseReturnSpans}=await import('../src/free/dense-return-loop');
 const {anchorGeometry,connectionGeometry}=await import('../src/free/layout');
 const {distance,ends}=await import('../src/free/geometry');
 for(const angle of [37,90,231]){
  const a=angle*Math.PI/180,across={x:Math.cos(a),z:Math.sin(a)},axis={x:-Math.sin(a),z:Math.cos(a)},layout=emptyLayout();
  layout.modules=[0,1,2].map(i=>({id:`r${i}`,type:'2x2',x:12+axis.x*(i-1)*5,z:10+axis.z*(i-1)*5,angle}));
  layout.connections=[0,1].map(i=>({id:`rspan${i}`,a:{room:`r${i}`,edge:2,offset:0},b:{room:`r${i+1}`,edge:0,offset:0},width:1.4}));
  layout.openings=[{id:'in',room:'r0',edge:0,offset:0,width:1.4},{id:'out',room:'r2',edge:2,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';
  const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:crossingFixture().maze.parameters,construction:DEFAULT_CONSTRUCTION,layout};
  staggerDenseReturnSpans(draft,['rspan0','rspan1'],across);expect(validateFree(draft)).toEqual([]);
  for(const c of layout.connections){const p=anchorGeometry(layout,c.a,c.width).mid,q=anchorGeometry(layout,c.b,c.width).mid;expect(p.x*across.x+p.z*across.z).toBeCloseTo(q.x*across.x+q.z*across.z,9);for(const wall of connectionGeometry(layout,c).sides)expect(distance(...ends(wall))).toBeCloseTo(3,9);}
 }
});
