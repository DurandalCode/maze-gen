/** Rebuild the 60-frame bridge candidate from its frozen native organic base.
 * The staged source is intentional: ordinary generation with this seed cannot
 * reproduce a qualified directional trap without the constructive edits below.
 */
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
const source='examples/maps/bridge-bundle-base60.json';
const output=Bun.argv[2]??'examples/bundles/distribution-v2/05-free-bridges.json';
const base=await Bun.file(source).text(),d=mazeDraft(deserialize(base)),l=d.layout;
const removed=new Set(['m-266']);for(let changed=true;changed;){changed=false;for(const c of l.connections)if(removed.has(c.a.room)&&!removed.has(c.b.room)){removed.add(c.b.room);changed=true;}}
l.modules=l.modules.filter(m=>!removed.has(m.id));l.connections=l.connections.filter(c=>!removed.has(c.a.room)&&!removed.has(c.b.room));
const edits:{room:string;edge:number;type:string;gap:number;id:string}[]=[];
function add(room:string,edge:number,type:FreeModule['type'],gap:number,id='bridge-trap-'+l.modules.length){
 const a={room,edge,offset:0},g=anchorGeometry(l,a,1.6),module:FreeModule={id,type,x:0,z:0,angle:Math.atan2(g.normal.z,g.normal.x)*180/Math.PI},b={room:id,edge:3,offset:0},h=anchorGeometry({...emptyLayout(),modules:[module]},b,1.6);
 module.x=g.mid.x+g.normal.x*gap-h.mid.x;module.z=g.mid.z+g.normal.z*gap-h.mid.z;
 l.modules.push(module);l.connections.push({id:id+'-link',a,b,width:1.6});edits.push({room,edge,type,gap,id});return id;
}
let id=add('m-268',2,'2x6',2.5);id=add(id,0,'2x6',2.5);id=add(id,1,'2x2',2);id=add(id,1,'2x6',2);id=add(id,1,'2x6',1.5);add(id,0,'2x2',2);
const oldExit=l.openings.find(o=>o.id===l.exit)!;add(oldExit.room,oldExit.edge,'2x6',1.5,'bridge-exit-extension');
l.openings=l.openings.filter(o=>o.id!==l.exit);l.openings.push({id:'bridge-exit-final',room:'bridge-exit-extension',edge:1,offset:0,width:1.6});l.exit='bridge-exit-final';
const original=deserialize(base).free!;
for(const keep of ['m-266','m-290']){l.modules.push(structuredClone(original.modules.find(m=>m.id===keep)!));l.connections.push(structuredClone(original.connections.find(c=>c.b.room===keep)!));removed.delete(keep);}
const maze=freeMaze(d);assert.deepEqual(validateFree(d),[]);assert.equal(l.modules.length,60);assert.equal(routeTraps(maze).qualifiedCount,1);assert.equal(loopTraps(maze).qualifiedCount,1);assert.deepEqual(bridgeRouteErrors(maze),[]);assert(selectOppositePortals(l,l.openings,1).length>0);
const raw=serialize(maze);await Bun.write(output,raw);
const recipe={source,sourceSha256:createHash('sha256').update(base).digest('hex'),sourceStatus:'Native organic bridge generation staged before route-trap acceptance; frozen geometry is the reproducible input.',baseParameters:maze.parameters,removedModules:[...removed],attachments:edits,restoredModules:['m-266','m-290'],output,sha256:createHash('sha256').update(raw).digest('hex'),command:'bun scripts/prepare-free-bridge-map.ts',validation:'bun scripts/validate-free-bridge-map.ts '+output+' --install'};
await Bun.write(output.replace(/\.json$/,'.recipe.json'),JSON.stringify(recipe,null,2)+'\n');console.log(JSON.stringify({output,modules:l.modules.length,sha256:recipe.sha256}));
