/** Run from repository root with bun scripts/free-play-benchmark.ts. No ratings or generation. */
import {deserialize} from '../src/persistence/maze-json';
import {freeRuntime,freeDomain} from '../src/free/layout';
import {CollisionWorld} from '../src/simulation/collisions';
import {walls} from '../src/core/maze';
import {pointIn} from '../src/free/geometry';
import {Player} from '../src/simulation/player';
for(const file of ['03-free-hybrid.json','04-vortex-hybrid.json','05-free-bridges-revision02.json']){
 const maze=deserialize(await Bun.file('examples/bundles/distribution-v2/'+file).text()),r=freeRuntime(maze),d=freeDomain(maze),world=new CollisionWorld(walls(maze));
 const player=new Player(maze,world),points=r.centers,n=3000;
 const contains=r.contains,nearby=r.nearbyBoundaries;
 const reference=(p:typeof points[number])=>r.polygons.some(poly=>pointIn(p,poly))&&!r.holes.some(h=>pointIn(p,h,false));
 const timings:Record<string,Record<string,number>>={};
 for(const mode of ['full-scan','indexed']){
  r.contains=mode==='full-scan'?reference:contains;
  r.nearbyBoundaries=mode==='full-scan'?()=>r.boundaries:nearby;
  const run:Record<string,(i:number)=>unknown>={
   contains:i=>r.contains(points[i%points.length]!),
   constrain:i=>{const p=points[i%points.length]!;return d.constrain(p,{x:p.x+.02,z:p.z+.01});},
   collision:i=>world.move(points[i%points.length]!,{x:.02,z:.01}),
   player:i=>{player.position={...points[i%points.length]!};player.finished=false;player.updateAnalog(1/60,1,0);},
  };
  timings[mode]={};
  for(const [name,query] of Object.entries(run)){
   for(let i=0;i<300;i++)query(i);
   const samples=[];
   for(let repeat=0;repeat<3;repeat++){const t=performance.now();for(let i=0;i<n;i++)query(i);samples.push(performance.now()-t);}
   timings[mode]![name]=+samples.sort((a,b)=>a-b)[1]!.toFixed(2);
  }
 }
 r.contains=contains;r.nearbyBoundaries=nearby;
 const boundaryCandidates=points.map(p=>nearby(p,{x:p.x+.02,z:p.z+.01}).length);
 console.log(JSON.stringify({file,regions:points.length,boundaries:r.boundaries.length,meanBoundaryCandidates:boundaryCandidates.reduce((a,b)=>a+b,0)/points.length,obstacles:r.obstacles.length,queries:n,medianMs:timings}));
}
