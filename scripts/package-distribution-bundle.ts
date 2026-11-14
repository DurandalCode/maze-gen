import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {domainOf} from '../src/core/domain';
import {metrics} from '../src/core/metrics';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';
import {validateLibraryExport} from '../src/persistence/library-export';
import {readClassicalColdspotProof} from './distribution-coldspot-proof';
import {strict as assert} from 'node:assert';

const root=resolve('examples/bundles/distribution-v2');
const selection=await Bun.file('examples/maps/selected-maps.json').json();
const entries=[
 ['classical','01-classical.json','01 · Классический'],
 ['living-square','02-living.json','02 · Живой квадратный'],
 ['organic-hybrid-with-courtyards','03-free-hybrid.json','03 · Органический гибрид с дворами'],
 ['vortex-hybrid','04-vortex-hybrid.json','04 · Гибридный вортекс'],
 ['free-bridges','05-free-bridges-revision02.json','05 · Мостовой'],
] as const;
const rows=[],maps=[];
for(const [selectionType,file,title] of entries){
 const approved=selection.selected.find((m:{type:string})=>m.type===selectionType);
 assert(approved,`Map not approved for distribution: ${selectionType}`);
 const raw=await Bun.file(resolve(root,file)).text(),sha256=createHash('sha256').update(raw).digest('hex');
 assert.equal(sha256,approved.sha256,`Selected map changed: ${file}`);
 const maze=deserialize(raw),structure=metrics(maze);
 const modules=maze.free?.modules.length??maze.layout?.modules.length??domainOf(maze).modules.reduce((a,b)=>a+b,0);
 const routes=routeTraps(maze).qualifiedCount,loops=loopTraps(maze).qualifiedCount;
 assert(modules>0&&modules<=75&&routes>=1&&loops>=1&&structure.components===1&&structure.reachable&&maze.roof);
 if(selectionType==='living-square')assert.equal(maze.width,maze.depth);
 if(selectionType==='organic-hybrid-with-courtyards')assert(maze.free&&maze.parameters.freeCavityMaze);
 if(selectionType==='vortex-hybrid')assert(maze.free&&maze.parameters.freeVortexHybrid);
 if(selectionType==='free-bridges'){assert.equal(maze.free?.bridges?.length,2);assert.equal(maze.fabricTransmissionStrength,.25);}
 const coldspots=selectionType==='classical'?await readClassicalColdspotProof(root,raw):undefined;
 rows.push({title,maze:JSON.parse(raw)});
 maps.push({file,title,type:selectionType==='living-square'?'living':selectionType==='organic-hybrid-with-courtyards'?'free-hybrid':selectionType,
  generationType:maze.parameters.generationType??'classical',modules,cycles:structure.cycles,
  qualifiedRouteTraps:routes,qualifiedLoopTraps:loops,sha256,status:'accepted',portalPrivacy:mazePortalPrivacy(maze,false).certified,
  ...(coldspots?{coldspots}:{}),...(selectionType==='living-square'?{squareFootprint:true}:{}),
  libraryId:approved.libraryId,url:approved.url});
 console.log(`${file}: ${modules} modules; Л${routes}/К${loops}`);
}
const pack={kind:'maze-lab-library-export',version:1,createdAt:new Date().toISOString(),modelVersion:10,platform:'windows-distribution',mazes:rows,walks:[]};
const restored=validateLibraryExport(pack);assert.equal(restored.mazes.length,5);assert.equal(restored.walks.length,0);
for(let i=0;i<entries.length;i++)assert.equal(serialize(restored.mazes[i]!.maze),await Bun.file(resolve(root,entries[i]![1])).text());
await Bun.write(resolve(root,'bundle.json'),JSON.stringify(pack,null,2)+'\n');
await Bun.write(resolve(root,'manifest.json'),JSON.stringify({version:2,status:'accepted',mapCount:5,plannedMapCount:10,
 targetModules:{target:75,min:1,max:75},minimumRouteTraps:1,minimumLoopTraps:1,maps},null,2)+'\n');
