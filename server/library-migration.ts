import {cp,mkdir,readdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {deserialize} from '../src/persistence/maze-json';
import {recordJson} from '../src/persistence/record-codec';
import {contentId,canonical} from '../src/persistence/identity';
import {validateWalk} from '../src/persistence/walk-json';
import {convertToFree} from '../src/free/convert';
import {freeMaze} from '../src/free/layout';
import {decodeDraft,encodeDraft} from '../src/free/json';
import {portalPoint,walls,type Maze} from '../src/core/maze';
import {mazePortals} from '../src/core/portals';
import {timberStructure} from '../src/core/structure';
import {topologyId,type SavedMaze,type SavedWalk} from './store';

/** One-off operation. Sources are never modified; a complete new library is published atomically. */
export async function migrateLibraries(sources:string[],output:string,progress=(message:string)=>console.log(message)){
 const target=resolve(output),roots=sources.map(p=>resolve(p));
 if(!roots.length||roots.some(root=>!relative(root,target).startsWith('..')||!relative(target,root).startsWith('..')))throw Error('Исходная библиотека и результат должны находиться в разных каталогах.');
 try{await readdir(target);throw Error('Каталог результата уже существует. Выберите новый каталог.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const stage=target+'.'+randomUUID()+'.tmp',mazes=new Map<string,SavedMaze>(),walks=new Map<string,SavedWalk>(),convertedMazes=new Set<string>(),convertedWalks=new Set<string>();
 const cache=new Map<string,Promise<Maze>>(),mapping:{source:string;oldId:string;newId:string;from:number;to:number}[]=[];
 const readRows=async<T extends {id:string}>(root:string,folder:string):Promise<T[]>=>{
  let files:string[];try{files=await readdir(join(root,folder));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  return Promise.all(files.filter(f=>/^[a-zA-Z0-9_-]{1,80}\.json$/.test(f)).sort().map(async f=>{
   const row=JSON.parse(await readFile(join(root,folder,f),'utf8')) as T;
   if(row.id!==f.slice(0,-5))throw Error('ID записи не совпадает с именем файла: '+f);return row;
  }));
 };
 const convert=(raw:Maze):Promise<Maze>=>{
  const key=JSON.stringify(raw);let pending=cache.get(key);if(pending)return pending;
  pending=(async()=>{
   const before=deserialize(key);
   if(before.version>=5)return before; // v6 is deliberately preserved, including its recordings.
   const after=freeMaze(decodeDraft(encodeDraft(convertToFree(before))));
   // Physical coordinates are the contract of historical recordings. Never rescale or regenerate.
   if(canonical(walls(before))!==canonical(walls(after)))throw Error('При переносе изменились физические панели.');
   const posts=(maze:Maze)=>timberStructure(maze).posts.map(p=>[p.x,p.z].map(v=>(Math.round(v*1e6)/1e6).toFixed(6)).join(':')).sort();
   if(canonical(posts(before))!==canonical(posts(after)))throw Error('При переносе изменились физические стойки.');
   const a=mazePortals(before).map(p=>portalPoint(before,p)),b=mazePortals(after).map(p=>portalPoint(after,p));
   if(a.length!==b.length||a.some((p,i)=>Math.hypot(p.x-b[i]!.x,p.z-b[i]!.z)>1e-6))throw Error('При переносе изменились проёмы.');
   for(const [p,q] of [[portalPoint(before,before.entrance),portalPoint(after,after.entrance)],[portalPoint(before,before.exit),portalPoint(after,after.exit)]])if(Math.hypot(p!.x-q!.x,p!.z-q!.z)>1e-6)throw Error('При переносе изменились вход или выход.');
   return after;
  })();cache.set(key,pending);return pending;
 };
 try{
  await mkdir(join(stage,'library','mazes'),{recursive:true});await mkdir(join(stage,'library','walks'),{recursive:true});
  for(let index=0;index<roots.length;index++){
   const root=roots[index]!;
   // Work exclusively from an immutable copy, also retained for rollback.
   const backup=join(stage,'backup',String(index));await cp(root,backup,{recursive:true,errorOnExist:true,force:false});
   for(const row of await readRows<SavedMaze>(backup,'mazes')){
    progress('Карта '+row.id);const changed=row.maze.version<5,maze=changed?await convert(row.maze):row.maze,id=changed?await contentId(maze):row.id,previous=mazes.get(id);
    if(previous&&canonical(previous.maze)!==canonical(maze))throw Error('Одинаковый ID относится к разным картам: '+row.id);
    const metadata=(r:SavedMaze)=>({...r,id:undefined,maze:undefined,createdAt:undefined,updatedAt:undefined});
    if(previous&&canonical(metadata(previous))!==canonical(metadata(row)))throw Error('Совпали карты с разными метаданными: '+row.id);
    mazes.set(id,{...row,id,maze,...(previous?{createdAt:[previous.createdAt,row.createdAt].sort()[0]!,updatedAt:[previous.updatedAt,row.updatedAt].sort().at(-1)!}:{})});if(changed)convertedMazes.add(id);mapping.push({source:root,oldId:row.id,newId:id,from:row.maze.version,to:maze.version});
   }
   for(const row of await readRows<SavedWalk>(backup,'walks')){
    progress('Запись '+row.id);
    if(row.walk.maze.version>=5){
     const previous=walks.get(row.id);if(previous&&canonical(previous)!==canonical(row))throw Error('Разные записи с одинаковым ID: '+row.id);
     walks.set(row.id,row);continue;
    }
    const maze=await convert(row.walk.maze),mazeId=await contentId(maze);
    const walk=validateWalk({...row.walk,maze});
    if(canonical(walk.recording)!==canonical(row.walk.recording))throw Error('Изменилась запись '+row.id);
    const next={...row,mazeId,walk,topologyId:topologyId(maze)},previous=walks.get(row.id);
    if(previous&&canonical(previous)!==canonical(next))throw Error('Разные записи с одинаковым ID: '+row.id);
    walks.set(row.id,next);convertedWalks.add(row.id);
    if(!mazes.has(mazeId)){mazes.set(mazeId,{id:mazeId,title:'Карта записи '+row.id,createdAt:row.createdAt,updatedAt:row.updatedAt,maze,status:'candidate'});convertedMazes.add(mazeId);}
   }
  }
  for(const row of mazes.values())await writeFile(join(stage,'library','mazes',row.id+'.json'),convertedMazes.has(row.id)?recordJson(row):JSON.stringify(row));
  for(const row of walks.values())await writeFile(join(stage,'library','walks',row.id+'.json'),convertedWalks.has(row.id)?recordJson(row):JSON.stringify(row));
  const report={sources:roots,mazes:mazes.size,walks:walks.size,converted:mapping.filter(m=>m.from<5).length,convertedWalks:convertedWalks.size,preservedTwoStorey:mapping.filter(m=>m.from===6).length,mapping};
  await writeFile(join(stage,'manifest.json'),JSON.stringify(report,null,2));await rename(stage,target);return report;
 }catch(e){await rm(stage,{recursive:true,force:true});throw e;}
}
