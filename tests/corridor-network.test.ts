import {denseClassicalTransfer} from '../src/generators/dense-classical-transfer';
import {compactVoids} from '../src/generators/void-compaction';
import {corridorSight} from '../src/analysis/corridor-sight';
import {offsetCorridors} from '../src/generators/corridor-offsets';
import {corridorQuality} from '../src/analysis/corridor-quality';
import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {generate} from '../src/generators/generate';
import {domainOf} from '../src/core/domain';
import {metrics} from '../src/core/metrics';
import {independentCycles} from '../src/core/graph';
import {corridorSpaceSummary} from '../src/core/corridor-summary';
import {corridorShell,generateCorridor} from '../src/generators/corridor';
import {corridorNavigation} from '../src/core/corridor-navigation';
import {footprint,footprintContains,mm} from '../src/core/corridor-geometry';
import {cellCenter,walls,type Parameters} from '../src/core/maze';
import {supportColliders} from '../src/core/structure';
import {CollisionWorld} from '../src/simulation/collisions';
import {routePoints} from '../src/core/pathfinding';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {prepareNavigation,prepareOutline,cellAtPoint} from '../src/analysis/navigation';
import {measureLandmarks} from '../src/analysis/visibility';
import {mazeMesh} from '../src/renderer/maze-mesh';
import {disposeMeshes} from '../src/renderer/dispose';
const p:Parameters={generationType:'corridor',columns:30,rows:26,corridorWidth:2,moduleSize:2,algorithm:'backtracker',seed:'CORRIDOR-NETWORK-01',extraConnections:2};
test('network-first generation produces halls and inaccessible islands without changing the site outline',()=>{
 const m=generate(p),s=corridorSpaceSummary(m);expect(s.siteArea).toBe(780);expect(s.halls).toBe(1);expect(s.hallArea).toBeGreaterThan(0);expect(s.islands).toBe(1);expect(s.inaccessibleArea).toBeGreaterThan(200);expect(s.walkableArea+s.inaccessibleArea).toBeCloseTo(s.siteArea);
 expect(generate(p)).toEqual(m);expect(generate({...p,seed:'another-network'}).passages).not.toEqual(m.passages);
 expect(m.parameters.shape).toBeUndefined();expect(metrics(m).cycles).toBe(2);expect(independentCycles(corridorNavigation(m))).toBe(2);
 for(const h of m.layout!.spaces!.filter(r=>r.kind==='hall'))for(const module of m.layout!.modules){const r=footprint(module);expect(Math.min(mm(h.x+h.width),r.x2)<=Math.max(mm(h.x),r.x1)||Math.min(mm(h.z+h.height),r.z2)<=Math.max(mm(h.z),r.z1)).toBe(true);}
 const graph=corridorNavigation(m);for(const hall of m.layout!.spaces!.filter(s=>s.kind==='hall')){const ids=new Set(domainOf(m).cells.filter(c=>{const q=cellCenter(m,c);return q.x>hall.x&&q.x<hall.x+hall.width&&q.z>hall.z&&q.z<hall.z+hall.height;}).map(c=>graph.navigation!.originalToRegion[c]));expect(ids.size).toBe(1);}
 const world=new CollisionWorld([...walls(m),...supportColliders(m)]),points=routePoints(m);expect(points.length).toBeGreaterThan(1);for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.04);for(let j=1;j<n;j++){const q={x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n};expect(domainOf(m).contains(q)).toBe(true);expect(world.blocked(q)).toBe(false);}}
});
test('halls are entire enclosed voids of the unchanged modular corridor network',()=>{
 const m=generate(p),corridors=m.layout!.spaces!.filter(s=>s.kind==='corridor'),shell=corridorShell(p,m.layout!.modules,corridors,3),d=domainOf(shell);
 for(const h of m.layout!.spaces!.filter(s=>s.kind==='hall')){
  for(let z=h.z+.5;z<h.z+h.height;z++)for(let x=h.x+.5;x<h.x+h.width;x++)expect(d.contains({x,z})).toBe(false);
  for(let x=h.x+.5;x<h.x+h.width;x++){expect(d.contains({x,z:h.z-.1})).toBe(true);expect(d.contains({x,z:h.z+h.height+.1})).toBe(true);}
  for(let z=h.z+.5;z<h.z+h.height;z++){expect(d.contains({x:h.x-.1,z})).toBe(true);expect(d.contains({x:h.x+h.width+.1,z})).toBe(true);}
 }
 expect(shell.layout!.modules).toEqual(m.layout!.modules);
});
test('spaces survive v4 save/load, reject invalid geometry, and the roof covers only actual accessible area',()=>{
 const m={...generate(p),roof:true},json=serialize(m),copy=deserialize(json);expect(copy.layout!.spaces).toEqual(m.layout!.spaces);expect(copy.passages).toEqual(m.passages);expect(corridorSpaceSummary(copy)).toEqual(corridorSpaceSummary(m));
 const overlap=JSON.parse(json);const h=overlap.layout.spaces.find((r:{kind:string})=>r.kind==='hall');h.z-=2;expect(()=>deserialize(JSON.stringify(overlap))).toThrow();
 const bad=JSON.parse(json);bad.layout.spaces[0].width=1000;expect(()=>deserialize(JSON.stringify(bad))).toThrow();
 const group=mazeMesh(m),roof=group.getObjectByName('roof') as THREE.InstancedMesh,matrix=new THREE.Matrix4();expect(roof).toBeInstanceOf(THREE.InstancedMesh);expect(roof.count).toBe(domainOf(m).cells.length);for(let i=0;i<roof.count;i++){roof.getMatrixAt(i,matrix);const q=new THREE.Vector3().setFromMatrixPosition(matrix);expect(domainOf(m).contains({x:q.x,z:q.z})).toBe(true);}disposeMeshes(group);
});
test('player outline and boundary cues do not reveal generated islands',()=>{
 const m=generate(p),ctx=prepareNavigation(m);prepareOutline(m,ctx);
 const plot={...m,layout:{modules:m.layout!.modules}},known=prepareNavigation(plot);prepareOutline(plot,known);
 for(const c of domainOf(m).cells){const q=cellAtPoint(plot,cellCenter(m,c))!;expect(ctx.outlineDistances![c]).toBeCloseTo(known.outlineDistances![q]!);}
 const cues=measureLandmarks(m,ctx);let internal=0;
 for(const edge of domainOf(m).boundary){const w=edge.wall,delta={west:[-.1,0],east:[.1,0],north:[0,-.1],south:[0,.1]}[edge.portal.side];if(footprintContains(p,mm((w.x1+w.x2)/2+delta[0]!),mm((w.z1+w.z2)/2+delta[1]!))){const c=edge.portal.cell,other=domainOf(m).boundary.filter(e=>e.portal.cell===c);if(other.every(e=>{const w=e.wall,d={west:[-.1,0],east:[.1,0],north:[0,-.1],south:[0,.1]}[e.portal.side];return footprintContains(p,mm((w.x1+w.x2)/2+d[0]!),mm((w.z1+w.z2)/2+d[1]!));})){internal++;expect(cues.boundary[c]).toBe(0);}}}
 expect(internal).toBeGreaterThan(0);
});

test('quality analysis keeps physical navigation on large sparse corridor maps',()=>{
 const m=generate({...p,columns:60,rows:60,seed:'SHIFT-PROBE',extraConnections:12}),before=serialize(m),q=corridorQuality(m);
 expect(Number.isFinite(q.longestVisibleStraight)).toBe(true);expect(q.longestVisibleStraight).toBeLessThanOrEqual(Math.hypot(60,60));expect(q.routeForks).toBeGreaterThanOrEqual(0);expect(corridorSight(m,24,1).exceeded).toBe(false);expect(q.diagonalSight).toBeLessThanOrEqual(24);expect(serialize(m)).toBe(before);
},30000);

test('a shifted connection changes its trajectory without inventing a junction or crossing another corridor',()=>{
 const nodes=[{kind:'corridor' as const,x:0,z:4,width:2,height:2},{kind:'corridor' as const,x:12,z:4,width:2,height:2}],r=offsetCorridors({...p,columns:20,rows:12},nodes,[{a:0,b:1,space:{kind:'corridor',x:2,z:4,width:10,height:2}}],[],()=>.2),path=r.paths[0]!;
 expect(r.offsets).toBe(1);expect(path[0]).toEqual({x:0,z:4});expect(path.at(-1)).toEqual({x:12,z:4});expect(path.some(p=>p.z!==4)).toBe(true);
 for(let i=0;i<path.length;i++){const t=path[i]!,neighbours=path.filter(q=>Math.abs(q.x-t.x)+Math.abs(q.z-t.z)===2);expect(neighbours.length).toBe(i===0||i===path.length-1?1:2);}
});
test('physical sight rejects diagonal visibility even when both axis views fit the limit',()=>{
 const m=generate({...p,columns:6,rows:2,extraConnections:0});expect(corridorSight(m,6.05,90).exceeded).toBe(false);expect(corridorSight(m,6.05,1).exceeded).toBe(true);
});

test('corridor generation combines a protected blind route trap with a return ring and bounded cold area',async()=>{
 const {routeTraps}=await import('../src/analysis/route-traps'),{loopTraps}=await import('../src/analysis/loop-traps'),{analyzeColdspots,DEFAULT_ANALYSIS}=await import('../src/analysis/coldspots');
 const m=generateCorridor({...p,columns:60,rows:60,seed:'CORRIDOR-10-CREDIBLE-1',extraConnections:2,routeTrapCount:1,loopTrapCount:1},undefined,undefined,Date.now()+60000);m.roof=true;
 expect(routeTraps(m).qualifiedCount).toBeGreaterThanOrEqual(1);expect(loopTraps(m).qualifiedCount).toBeGreaterThanOrEqual(1);
 expect(metrics(m).components).toBe(1);expect(metrics(m).cycles).toBe(2);expect(corridorSight(m,24,1).exceeded).toBe(false);
 const ring=loopTraps(m).candidates.find(t=>t.qualifies)!;expect(ring.credibility.strongEntry).toBe(true);expect(ring.credibility.commitmentDistance).toBeGreaterThanOrEqual(24);expect(ring.credibility.loopReturns).toBeGreaterThan(0);
 expect(analyzeColdspots(m,{...DEFAULT_ANALYSIS,samples:64}).coldAreaRatio).toBeLessThan(.25);
 const copy=deserialize(serialize(m));expect(copy.parameters.routeTrapCount).toBe(1);expect(copy.parameters.loopTrapCount).toBe(1);expect(copy.passages).toEqual(m.passages);
 const snapshot=serialize(m),compressed=compactVoids(m);expect(compressed.targetRouteMetres).toBeLessThan(compressed.sourceRouteMetres);expect(compressed.maze.width*compressed.maze.depth).toBeLessThan(m.width*m.depth);expect(metrics(compressed.maze).cycles).toBe(2);expect(routeTraps(compressed.maze).candidates.some(t=>t.qualifies&&t.fork===compressed.routeFork)).toBe(true);expect(loopTraps(compressed.maze).candidates.some(t=>t.qualifies&&t.fork===compressed.loopFork)).toBe(true);expect(serialize(m)).toBe(snapshot);expect(deserialize(serialize(compressed.maze)).passages).toEqual(compressed.maze.passages);
 const dense=denseClassicalTransfer(m,undefined,Date.now()+2500),n=dense.maze;expect(n.parameters.generationType).toBe('classical');expect(n.parameters.moduleSize).toBe(2);expect(n.parameters.shape).toBeUndefined();expect(domainOf(n).area).toBe(n.width*n.depth);expect(domainOf(n).cells.length).toBe(n.passages.length);expect(metrics(n).cycles).toBe(2);expect(dense.targetRouteMetres).toBeLessThan(dense.sourceRouteMetres);expect(routeTraps(n).candidates.some(t=>t.qualifies&&t.fork===dense.routeFork&&t.deadEnd===dense.routeDeadEnd)).toBe(true);expect(loopTraps(n).candidates.some(t=>t.qualifies&&t.fork===dense.loopFork&&t.credibility.credible)).toBe(true);expect(deserialize(serialize(n))).toEqual(n);expect(serialize(m)).toBe(snapshot);expect(()=>denseClassicalTransfer(m,'cancelled',Date.now()-1)).toThrow('бюджет');
},65000);
