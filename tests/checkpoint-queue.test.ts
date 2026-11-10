import {test,expect,spyOn,afterAll} from 'bun:test';
import {freeMaze} from '../src/free/layout';
import {emptyLayout} from '../src/free/model';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {portalPoint,cellCenter} from '../src/core/maze';
import {Recorder} from '../src/simulation/recorder';
import {makeWalkData} from '../src/persistence/walk-json';
import * as mazeJson from '../src/persistence/maze-json';
import {saveLibraryWalk,flushPendingWalks} from '../src/persistence/library';
const beforeStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),beforeLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),beforeFetch=globalThis.fetch;
class Storage{getItem(k:string){return Object.hasOwn(this,k)?(this as any)[k]:null;}setItem(k:string,v:string){Object.defineProperty(this,k,{value:v,enumerable:true,configurable:true,writable:true});}removeItem(k:string){delete (this as any)[k];}}
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:new Storage()});Object.defineProperty(globalThis,'location',{configurable:true,value:{search:''}});globalThis.fetch=async()=>new Response('{}',{status:503});
afterAll(()=>{globalThis.fetch=beforeFetch;for(const [key,value]of [['localStorage',beforeStorage],['location',beforeLocation]] as const){if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key];}});
function fixture(id:string){
 const layout=emptyLayout();layout.modules=[{id:'a',type:'2x2',x:10,z:10,angle:0},{id:'b',type:'2x2',x:14,z:10,angle:0}];layout.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4}];layout.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';
 const maze=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',moduleSize:2,columns:20,rows:20,corridorWidth:2,extraConnections:0,seed:'queue-cache',algorithm:'backtracker'},construction:{...DEFAULT_CONSTRUCTION},layout}),r=new Recorder(portalPoint(maze,maze.entrance));r.record(cellCenter(maze,maze.entrance.cell),1,true);return makeWalkData(maze,r,id,false,'in-progress');
}

test('repeated current-session checkpoints reuse their exact queued snapshot and preserve terminal state',async()=>{
 const first=fixture(crypto.randomUUID()),key='maze-lab:pending-walk:'+first.id;await saveLibraryWalk(first);
 const decode=spyOn(mazeJson,'deserialize');try{
  const finished={...first,finished:true,status:'finished' as const};await saveLibraryWalk(finished);await saveLibraryWalk({...first,recording:{...first.recording,elapsed:99}});
  expect(JSON.parse(localStorage.getItem(key)!).finished).toBe(true);expect(decode).not.toHaveBeenCalled();
 }finally{decode.mockRestore();localStorage.removeItem(key);}
});
test('unknown disk snapshots are validated once, retries accept compact v5 records, and an altered backup is never taken from cache',async()=>{
 const first=fixture(crypto.randomUUID()),key='maze-lab:pending-walk:'+first.id;localStorage.setItem(key,JSON.stringify(first));
 const decode=spyOn(mazeJson,'deserialize');try{
  await flushPendingWalks();expect(decode).toHaveBeenCalledTimes(1);await flushPendingWalks();expect(decode).toHaveBeenCalledTimes(1);
  localStorage.setItem(key,JSON.stringify({...first,finished:true,status:'finished'}));await saveLibraryWalk(first);expect(decode).toHaveBeenCalledTimes(2);expect(JSON.parse(localStorage.getItem(key)!).finished).toBe(true);
 }finally{decode.mockRestore();localStorage.removeItem(key);}
});
test('paused retry leaves backups intact and cannot delete a newer queued checkpoint after an older response',async()=>{
 const first=fixture(crypto.randomUUID()),key='maze-lab:pending-walk:'+first.id;await saveLibraryWalk(first);let resolve!:(r:Response)=>void;globalThis.fetch=()=>new Promise(r=>{resolve=r;});
 const old=saveLibraryWalk(first);const backup=localStorage.getItem(key);await flushPendingWalks(()=>false);expect(localStorage.getItem(key)).toBe(backup);
 globalThis.fetch=async()=>new Response('{}',{status:503});await saveLibraryWalk({...first,finished:true,status:'finished'});resolve(new Response('{}'));await old;expect(JSON.parse(localStorage.getItem(key)!).finished).toBe(true);localStorage.removeItem(key);
});
