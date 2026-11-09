import type { FileStore,SavedMaze,SavedWalk } from '../../server/store';
import { makeWalkData,type WalkData } from './walk-json';
import type { Maze } from '../core/maze';
import type { Recorder } from '../simulation/recorder';

async function request<T>(path:string,body?:unknown):Promise<T> {
  const response=await fetch(path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Не удалось обратиться к библиотеке.');return data as T;
}
export const listLibraryMazes=()=>request<{mazes:Awaited<ReturnType<FileStore['listMazes']>>}>('/api/mazes');
export const listLibraryWalks=()=>request<{walks:Awaited<ReturnType<FileStore['listWalks']>>}>('/api/walks');
export const getLibraryMaze=(id:string)=>request<SavedMaze>('/api/mazes/'+encodeURIComponent(id));
export const getLibraryWalk=(id:string)=>request<SavedWalk>('/api/walks/'+encodeURIComponent(id));
export const saveLibraryMaze=(maze:Maze)=>request<SavedMaze>('/api/mazes',{maze});
export const prepareLibraryWalk=(maze:Maze)=>request<{maze:Maze;firstAttempt:boolean;roofEnforced:boolean}>('/api/prepare-walk',{maze});
const prefix='maze-lab:pending-walk:';
export async function saveLibraryWalk(data:WalkData):Promise<{saved:boolean;queued:boolean}> {
  const key=prefix+data.id,text=JSON.stringify(data);let queued=false;
  try{localStorage.setItem(key,text);queued=true;}catch{/* The server can still save when browser storage is full or disabled. */}
  try {
    await request('/api/walks',data);
    try{if(localStorage.getItem(key)===text)localStorage.removeItem(key);}catch{/* Storage is optional after a successful server write. */}
    return {saved:true,queued:false};
  }catch{return {saved:false,queued};}
}
export function captureWalk(maze:Maze,recorder:Recorder,id:string,finished:boolean,status:WalkData['status']) {
  return saveLibraryWalk(makeWalkData(maze,recorder,id,finished,status));
}
export async function flushPendingWalks():Promise<void> {
  let keys:string[];try{keys=Object.keys(localStorage).filter(k=>k.startsWith(prefix));}catch{return;}
  for(const key of keys) {
    let text:string|null;try{text=localStorage.getItem(key);}catch{return;}
    if(!text)continue;
    try{await saveLibraryWalk(JSON.parse(text) as WalkData);}catch{/* Leave a failed record available for a later retry. */}
  }
}
