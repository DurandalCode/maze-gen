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
    try{await saveLibraryWalk(queuedWalk(key,text));}catch{/* Leave a failed record available for a later retry. */}
  }
}
