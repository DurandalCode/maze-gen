/** Local revision: district crossing + a perpendicular bridge inside the return loop. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {anchorGeometry,freeMaze,validateFree} from '../src/free/layout';
import {emptyLayout,type FreeModule} from '../src/free/model';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {bridgeRouteErrors} from '../src/free/bridge-route';
import {selectOppositePortals} from '../src/free/opposite-portals';
const source='examples/bundles/distribution-v2/05-free-bridges.json',output=Bun.argv[2]??'examples/bundles/distribution-v2/05-free-bridges-revision02.json';
const base=await Bun.file(source).text(),d=mazeDraft(deserialize(base)),l=d.layout;
const descendants=(roots:string[])=>{const ids=new Set(roots);for(let changed=true;changed;){changed=false;for(const c of l.connections)if(ids.has(c.a.room)&&!c.b.room.startsWith('return-')&&!ids.has(c.b.room)){ids.add(c.b.room);changed=true;}}return ids;};
const removed=descendants(['return-w','m-176']);l.modules=l.modules.filter(m=>!removed.has(m.id));l.connections=l.connections.filter(c=>!removed.has(c.a.room)&&!removed.has(c.b.room));l.walls=l.walls.filter(w=>w.id!=='return-screen-w');
const fork=l.modules.find(m=>m.id==='return-fork')!,rad=fork.angle*Math.PI/180,north={x:Math.sin(rad),z:-Math.cos(rad)};
const shifted:{ids:string[];distance:number}[]=[];
for(const [roots,distance,screen]of [[['return-nw','return-n','return-ne'],2,'return-screen-n'],[['return-e'],1,'return-screen-e']] as const){
 const ids=descendants([...roots]);for(const m of l.modules)if(ids.has(m.id)){m.x+=north.x*distance;m.z+=north.z*distance;}
 for(const w of l.walls)if(w.id===screen){w.x1+=north.x*distance;w.z1+=north.z*distance;w.x2+=north.x*distance;w.z2+=north.z*distance;}shifted.push({ids:[...ids],distance});
}
l.bridges=l.bridges!.filter(b=>b.id!=='bridge-2');l.bridges.push({id:'bridge-2-return',a:{room:'return-fork',edge:0,offset:0},b:{room:'return-nw',edge:2,offset:0},width:1.4,rise:2.8,stairRun:4.48});
const additions=[['return-n',2,1.5,2,0],['bridge-r02-0',1,0,2,0],['bridge-r02-1',2,0,1.5,25],['bridge-r02-2',2,0,2,-25],['bridge-r02-2',1,0,2,0]] as const;
for(const [i,[room,edge,offset,gap,bend]]of additions.entries()){
 const a={room,edge,offset},g=anchorGeometry(l,a,1.6),id='bridge-r02-'+i,m:FreeModule={id,type:'2x2',x:0,z:0,angle:Math.atan2(g.normal.z,g.normal.x)*180/Math.PI+bend},b={room:id,edge:3,offset:0},h=anchorGeometry({...emptyLayout(),modules:[m]},b,1.6);
 m.x=g.mid.x+g.normal.x*gap-h.mid.x;m.z=g.mid.z+g.normal.z*gap-h.mid.z;l.modules.push(m);l.connections.push({id:id+'-link',a,b,width:1.6});
}
d.parameters.extraConnections=1;d.parameters.freeModuleTarget=l.modules.length;d.construction.fabricTransmissionStrength=.25;
const maze=freeMaze(d);assert.equal(l.modules.length,60);assert.deepEqual(validateFree(d),[]);assert.equal(routeTraps(maze).qualifiedCount,1);assert.equal(loopTraps(maze).qualifiedCount,1);assert.deepEqual(bridgeRouteErrors(maze),[]);assert(selectOppositePortals(l,l.openings,1).length);
const raw=serialize(maze);await Bun.write(output,raw);await Bun.write(output.replace(/\.json$/,'.recipe.json'),JSON.stringify({source,sourceSha256:createHash('sha256').update(base).digest('hex'),removedModules:[...removed],shifted,additions,replacedBridge:'bridge-2',newBridge:l.bridges.at(-1),fabricTransmissionStrength:.25,modules:60,cycles:1,command:'bun scripts/prepare-free-bridge-revision02.ts',validation:'bun scripts/validate-free-bridge-map.ts '+output+' --install --revision02; bun scripts/check-bridge-roles.ts '+output,sha256:createHash('sha256').update(raw).digest('hex')},null,2)+'\n');console.log(JSON.stringify({output,modules:60,sha256:createHash('sha256').update(raw).digest('hex')}));
