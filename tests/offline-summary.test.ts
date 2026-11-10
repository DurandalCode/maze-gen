import 'fake-indexeddb/auto';
import {test,expect,spyOn} from 'bun:test';
import * as mazeJson from '../src/persistence/maze-json';
import pack from '../src/data/commute-pack.json';
import type {SavedMaze} from '../server/store';
test('first offline library listing seeds wire snapshots without decoding maps and keeps existing bundle titles after reload',async()=>{
 const before=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{search:'?offline=1&test=619144'}});
 const modulePath='../src/persistence/offline-library.ts?summary='+crypto.randomUUID(),m=await import(modulePath) as typeof import('../src/persistence/offline-library');
 const decode=spyOn(mazeJson,'deserialize').mockImplementation(()=>{throw Error('List must not build a navigation graph');});
 let list:{mazes:{id:string;title:string;modules:number|null}[]};
 try{list=await m.offlineRequest('/api/mazes') as typeof list;expect(list.mazes).toHaveLength(31);expect(decode).not.toHaveBeenCalled();for(const row of pack.mazes.filter(r=>r.maze.version===5))expect(list.mazes.find(v=>v.id===row.id)!.modules).toBe(100);}
 finally{decode.mockRestore();}
 try{
  const id=list!.mazes.find(r=>r.title==='Набор · 01')!.id,row=await m.offlineRequest('/api/mazes/'+id) as SavedMaze;await m.saveOfflineMaze(row.maze,'My bundle title');
  const freshPath='../src/persistence/offline-library.ts?summary-reload='+crypto.randomUUID(),fresh=await import(freshPath) as typeof m;const reloaded=await fresh.offlineRequest('/api/mazes') as typeof list;
  expect(reloaded.mazes.find(v=>v.id===id)!.title).toBe('My bundle title');
 }finally{if(before)Object.defineProperty(globalThis,'location',before);else delete (globalThis as {location?:unknown}).location;}
});
