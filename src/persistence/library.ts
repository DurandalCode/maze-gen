import {recordJson} from './record-codec';
import {preferWalk} from './walk-order';
import {validateWalk} from './walk-json';
import {isOfflineLibrary} from './platform';
import {offlineRequest} from './offline-library';
import type { FileStore,SavedMaze,SavedWalk } from '../../server/store';
import { makeWalkData,type WalkData } from './walk-json';
import type { Maze } from '../core/maze';
import type { Recorder } from '../simulation/recorder';

async function request<T>(path:string,body?:unknown):Promise<T> {
  if(isOfflineLibrary())return await offlineRequest(path,body) as T;
  const response=await fetch(path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:recordJson(body)}),cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Не удалось обратиться к библиотеке.');return data as T;
}
export const listLibraryMazes=()=>request<{mazes:Awaited<ReturnType<FileStore['listMazes']>>}>('/api/mazes');
export const listLibraryWalks=()=>request<{walks:Awaited<ReturnType<FileStore['listWalks']>>}>('/api/walks');
export const getLibraryMaze=(id:string)=>request<SavedMaze>('/api/mazes/'+encodeURIComponent(id));
export const getLibraryWalk=(id:string)=>request<SavedWalk>('/api/walks/'+encodeURIComponent(id));
export const saveLibraryMaze=(maze:Maze,title?:string)=>request<SavedMaze>('/api/mazes',{maze,title});
export const prepareLibraryWalk=(maze:Maze)=>request<{maze:Maze;firstAttempt:boolean;roofEnforced:boolean}>('/api/prepare-walk',{maze});
const prefix='maze-lab:pending-walk:';
// Keep verified/current-session snapshots while their exact serialized backup is
// still queued. Rebuilding a large free maze on every checkpoint stalls walking.
const queuedSnapshots=new Map<string,{text:string;walk:WalkData}>();
function queuedWalk(key:string,text:string):WalkData {
  const cached=queuedSnapshots.get(key);if(cached?.text===text)return cached.walk;
  const walk=validateWalk(JSON.parse(text));queuedSnapshots.set(key,{text,walk});return walk;
}
const queuedChecks=new Map<string,{text:string;promise:Promise<WalkData>}>();
function queuedWalkInBackground(key:string,text:string):Promise<WalkData>{
  const cached=queuedSnapshots.get(key);if(cached?.text===text)return Promise.resolve(cached.walk);
  if(typeof document==='undefined'||typeof Worker==='undefined')return Promise.resolve().then(()=>queuedWalk(key,text));
  const existing=queuedChecks.get(key);if(existing?.text===text)return existing.promise;
  const promise=new Promise<WalkData>((resolve,reject)=>{
    const worker=new Worker(new URL('./queued-walk-worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=e=>{worker.terminate();if(e.data.error){reject(new Error(e.data.error));return;}const walk=e.data.walk as WalkData;
      try{if(localStorage.getItem(key)===text)queuedSnapshots.set(key,{text,walk});}catch{/* The validated result can still be uploaded. */}resolve(walk);};
    worker.onerror=()=>{worker.terminate();reject(new Error('Не удалось проверить отложенную запись.'));};
    worker.postMessage(text);
  }).finally(()=>{if(queuedChecks.get(key)?.promise===promise)queuedChecks.delete(key);});
  queuedChecks.set(key,{text,promise});return promise;
}
export async function saveLibraryWalk(data:WalkData):Promise<{saved:boolean;queued:boolean}> {
  const key=prefix+data.id;let attempt=data,queued=false;
  let pending:WalkData|undefined;
  try{const current=localStorage.getItem(key);if(current)pending=queuedWalk(key,current);else queuedSnapshots.delete(key);}
  catch{/* A damaged legacy queue item cannot prevent a verified recording from being saved. */}
  if(pending)attempt=preferWalk(pending,data);
  const text=recordJson(attempt);
  try{localStorage.setItem(key,text);queuedSnapshots.set(key,{text,walk:structuredClone(attempt)});queued=true;}catch{/* IndexedDB/server can still save when localStorage is full. */}
  try {
    await request('/api/walks',attempt);
    try{if(localStorage.getItem(key)===text){localStorage.removeItem(key);if(queuedSnapshots.get(key)?.text===text)queuedSnapshots.delete(key);}}catch{/* Storage is optional after a successful write. */}
    return {saved:true,queued:false};
  }catch{return {saved:false,queued};}
}

export function captureWalk(maze:Maze,recorder:Recorder,id:string,finished:boolean,status:WalkData['status']) {
  return saveLibraryWalk(makeWalkData(maze,recorder,id,finished,status));
}
export async function flushPendingWalks(shouldContinue:()=>boolean=()=>true):Promise<void> {
  let keys:string[];try{keys=Object.keys(localStorage).filter(k=>k.startsWith(prefix));}catch{return;}
  for(const key of keys) {
    if(!shouldContinue())break;
    let text:string|null;try{text=localStorage.getItem(key);}catch{return;}
    if(!text)continue;
    try{const walk=await queuedWalkInBackground(key,text);if(!shouldContinue())break;await saveLibraryWalk(walk);}catch{/* Leave a failed record available for a later retry. */}
  }
}
