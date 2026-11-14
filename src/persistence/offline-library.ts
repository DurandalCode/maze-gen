import {recordJson,restoreRecord} from './record-codec';
import type {SavedMaze,SavedWalk} from '../../server/store';
import {deserialize} from './maze-json';
import {validateWalk} from './walk-json';
import {assessWalk} from '../analysis/walk-assessment';
import {storedModuleCount,storedTopologyPayload} from './library-summary';
import type {Maze} from '../core/maze';
import {contentId,browserTopologyId} from './identity';
import bundled from '../data/field-pack.json';
import commute from '../data/commute-pack.json';
import distribution from '../../examples/bundles/distribution-v2/bundle.json';
import {isTauri} from '@tauri-apps/api/core';
const dbName=()=>{
 const test=typeof location!=='undefined'?new URLSearchParams(location.search).get('test'):null;
 return test&&/^[0-9]{1,6}$/.test(test)?'maze-lab-offline-test-'+test:'maze-lab-offline-v1';
};
let opened:Promise<IDBDatabase>|undefined,seeded:Promise<void>|undefined;
const database=():Promise<IDBDatabase>=>opened??=new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open(dbName(),1);
 request.onupgradeneeded=()=>{request.result.createObjectStore('mazes',{keyPath:'id'});request.result.createObjectStore('walks',{keyPath:'id'});};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Не удалось открыть локальную библиотеку.'));
 request.onblocked=()=>reject(new Error('Закройте другое окно приложения для обновления библиотеки.'));
}).catch(error=>{opened=undefined;throw error;});
async function all<T>(store:string,restore=true):Promise<T[]>{
 const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).getAll();req.onsuccess=()=>{try{resolve(restore?req.result.map(restoreRecord):req.result);}catch(e){reject(e);}};req.onerror=()=>reject(req.error);});
}
async function get<T>(store:string,id:string):Promise<T|null>{
 const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).get(id);req.onsuccess=()=>resolve(restoreRecord(req.result??null));req.onerror=()=>reject(req.error);});
}
async function update<T>(store:string,id:string,change:(old:T|null)=>T,restore=true):Promise<T>{
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readwrite'),s=tx.objectStore(store),req=s.get(id);let result:T;
  req.onsuccess=()=>{try{const old=restore?restoreRecord(req.result??null):req.result??null;result=change(old);if(restore||result!==old)s.put(JSON.parse(restore?recordJson(result):JSON.stringify(result)));}catch(e){tx.abort();reject(e);}};
  tx.oncomplete=()=>resolve(result!);tx.onabort=tx.onerror=()=>reject(new Error('Не удалось сохранить данные на устройстве. Экспортируйте имеющиеся записи.'));
 });
}
export async function saveOfflineMaze(raw:unknown,title?:string):Promise<SavedMaze>{
 const maze=deserialize(JSON.stringify(raw)),id=await contentId(maze),now=new Date().toISOString();
 return update<SavedMaze>('mazes',id,old=>({id,title:title?.trim().slice(0,120)||old?.title||maze.parameters.columns+' × '+maze.parameters.rows,createdAt:old?.createdAt??now,updatedAt:now,maze,status:old?.status??'candidate'}));
}
async function ensureBundle():Promise<void>{
 if(!seeded)seeded=(async()=>{
  if(isTauri()){
   for(const row of distribution.mazes){
    const maze=deserialize(JSON.stringify(row.maze)),id=await contentId(maze),now=new Date().toISOString();
    await update<SavedMaze>('mazes',id,old=>old??{id,title:row.title,maze,createdAt:now,updatedAt:now,status:'candidate'},false);
   }
   return;
  }
  for(const id of (commute as {retiredIds?:string[]}).retiredIds??[]){
   await update<SavedMaze|null>('mazes',id,old=>old&&old.status!=='rejected'?{...old,status:'rejected',rejectionReason:'Отбракован: однотипная схема с очевидным кольцом и проходом без выбора.'}:old,false);
  }
  for(const row of [...bundled.mazes,...commute.mazes] as {id:string;title:string;maze:Maze}[]){
   // Existing records keep their title, completion history and user construction changes.
   const now=new Date().toISOString();await update<SavedMaze>('mazes',row.id,old=>old??{...row,createdAt:now,updatedAt:now,status:'candidate'},false);
  }
 })().catch(e=>{seeded=undefined;throw e;});return seeded;
}
export async function saveOfflineWalk(raw:unknown):Promise<SavedWalk>{
 const walk=validateWalk(raw),maze=await saveOfflineMaze(walk.maze),now=new Date().toISOString(),assessment=assessWalk(walk.maze,walk.recording.samples,walk.recording.distance,walk.finished),physicalId=await browserTopologyId(walk.maze);
 return update<SavedWalk>('walks',walk.id,old=>{
  if(old&&old.mazeId!==maze.id)throw new Error('Запись относится к другой карте.');
  if(old&&old.walk.recording.elapsed===walk.recording.elapsed&&(old.walk.recording.markers?.length??0)>(walk.recording.markers?.length??0))return old;
  if(old&&(old.walk.finished||old.walk.recording.elapsed>walk.recording.elapsed||(old.walk.status==='stopped'&&walk.status==='in-progress'&&old.walk.recording.elapsed>=walk.recording.elapsed)))return old;
  return {id:walk.id,mazeId:maze.id,createdAt:old?.createdAt??now,updatedAt:now,walk,assessment,topologyId:physicalId};
 });
}
export async function offlineRequest(path:string,body?:unknown):Promise<unknown>{
 await ensureBundle();
 if(path==='/api/mazes'&&body===undefined)return {mazes:(await all<SavedMaze>('mazes',false)).sort((a,b)=>a.title.localeCompare(b.title,'ru')).map(row=>({id:row.id,title:row.title,createdAt:row.createdAt,updatedAt:row.updatedAt,status:row.status??'candidate',rejectionReason:row.rejectionReason,columns:row.maze.parameters.columns,rows:row.maze.parameters.rows,generationType:row.maze.parameters.generationType??'classical',modules:row.maze.parameters.moduleSize===undefined?null:storedModuleCount(row.maze)}))};
 if(path==='/api/walks'&&body===undefined)return {walks:await Promise.all((await all<SavedWalk>('walks',false)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(async row=>({id:row.id,mazeId:row.mazeId,createdAt:row.createdAt,updatedAt:row.updatedAt,topologyId:row.topologyId??await contentId(storedTopologyPayload(row.walk.maze)),status:row.walk.status,finished:row.walk.finished,elapsed:row.walk.recording.elapsed,distance:row.walk.recording.distance,assessment:row.assessment,columns:row.walk.maze.parameters.columns,rows:row.walk.maze.parameters.rows})))};
 const match=path.match(/^\/api\/(mazes|walks)\/([a-zA-Z0-9_-]{1,80})$/);
 if(match){const row=await get(match[1]!,match[2]!);if(!row)throw new Error('Запись не найдена на устройстве.');return row;}
 if(path==='/api/mazes'&&body){const b=body as {maze:unknown;title?:string};return saveOfflineMaze(b.maze,b.title);}
 if(path==='/api/walks')return saveOfflineWalk(body);
 if(path==='/api/prepare-walk'){
  const maze=deserialize(JSON.stringify((body as {maze:unknown}).maze)),id=await browserTopologyId(maze),walks=await all<SavedWalk>('walks',false);let firstAttempt=true;
  for(const w of walks)if(w.walk.recording.distance>.01&&(w.topologyId??await contentId(storedTopologyPayload(w.walk.maze)))===id){firstAttempt=false;break;}
  return {maze:firstAttempt?{...maze,roof:true}:maze,firstAttempt,roofEnforced:firstAttempt};
 }
 throw new Error('Неизвестная операция локальной библиотеки.');
}
