import {preferWalk} from './walk-order';
import type {Maze} from '../core/maze';
import {deserialize} from './maze-json';
import {validateWalk,WALK_LIMIT,type WalkData} from './walk-json';
import {downloadJson,pickJsonFile,isAndroidApp} from './platform';
import {getLibraryMaze,getLibraryWalk,listLibraryMazes,listLibraryWalks,saveLibraryMaze,saveLibraryWalk,flushPendingWalks} from './library';
export const LIBRARY_EXPORT_LIMIT=64_000_000;
export interface LibraryExport {
 kind:'maze-lab-library-export';version:1;createdAt:string;modelVersion:8;platform:string;
 mazes:{id?:string;title:string;maze:Maze}[];walks:WalkData[];
}
export function validateLibraryExport(raw:unknown):LibraryExport {
 const data=raw as Partial<LibraryExport>;
 if(!data||data.kind!=='maze-lab-library-export'||data.version!==1||!Array.isArray(data.mazes)||!Array.isArray(data.walks)||data.mazes.length>2000||data.walks.length>2000)throw new Error('Неподдерживаемый экспорт библиотеки.');
 const mazes=data.mazes.map(row=>{
  if(!row||typeof row.title!=='string'||row.title.length>120)throw new Error('Некорректное название карты.');
  const text=JSON.stringify(row.maze);return {title:row.title,maze:deserialize(text)};
 });
 const ids=new Map<string,string>(),walks=data.walks.map(raw=>{
  const text=JSON.stringify(raw);if(text.length>WALK_LIMIT)throw new Error('Одна из записей больше 12 МБ.');
  const walk=validateWalk(raw),known=ids.get(walk.id);if(known&&known!==text)throw new Error('В файле разные записи с одинаковым идентификатором.');ids.set(walk.id,text);return walk;
 });
 return {kind:'maze-lab-library-export',version:1,createdAt:typeof data.createdAt==='string'?data.createdAt:new Date().toISOString(),modelVersion:8,platform:typeof data.platform==='string'?data.platform:'import',mazes,walks};
}
function pendingWalks():WalkData[]{
 const walks:WalkData[]=[];
 try{for(const key of Object.keys(localStorage))if(key.startsWith('maze-lab:pending-walk:')){try{walks.push(validateWalk(JSON.parse(localStorage.getItem(key)!)));}catch{/* A damaged pending item cannot replace a verified saved recording. */}}}catch{/* IndexedDB/server recordings remain exportable when localStorage is unavailable. */}
 return walks;
}
export async function buildLibraryExport():Promise<LibraryExport>{
 await flushPendingWalks();
 const [a,b]=await Promise.all([listLibraryMazes(),listLibraryWalks()]);
 const [mazes,records]=await Promise.all([Promise.all(a.mazes.map(row=>getLibraryMaze(row.id))),Promise.all(b.walks.map(row=>getLibraryWalk(row.id)))]);
 const merged=new Map(records.map(r=>[r.id,r.walk]));
 for(const walk of pendingWalks()){const old=merged.get(walk.id);merged.set(walk.id,preferWalk(old,walk));}
 return {kind:'maze-lab-library-export',version:1,createdAt:new Date().toISOString(),modelVersion:8,platform:isAndroidApp()?'android':'web',mazes:mazes.map(({id,title,maze})=>({id,title,maze})),walks:[...merged.values()]};
}
export async function exportLibrary():Promise<{mazes:number;walks:number}>{
 const data=await buildLibraryExport(),text=JSON.stringify(data);if(new TextEncoder().encode(text).length>LIBRARY_EXPORT_LIMIT)throw new Error('Экспорт превышает 64 МБ.');
 downloadJson('maze-lab-recordings-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',text);
 return {mazes:data.mazes.length,walks:data.walks.length};
}
export async function importLibrary():Promise<{mazes:number;walks:number}|null>{
 const text=await pickJsonFile(LIBRARY_EXPORT_LIMIT);if(text===null)return null;
 const data=validateLibraryExport(JSON.parse(text));
 for(const row of data.mazes)await saveLibraryMaze(row.maze,row.title);
 for(const walk of data.walks){const result=await saveLibraryWalk(walk);if(!result.saved)throw new Error('Не все записи удалось сохранить. Файл экспорта сохранён у вас, его можно импортировать повторно.');}
 return {mazes:data.mazes.length,walks:data.walks.length};
}
