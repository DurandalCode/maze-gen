import 'fake-indexeddb/auto';
import {expect,test,spyOn} from 'bun:test';
import {generate} from '../src/generators/generate';
import {saveLibraryMaze,getLibraryMaze,prepareLibraryWalk} from '../src/persistence/library';
import {isOfflineLibrary} from '../src/persistence/platform';

test('desktop saves and prepares maps without an HTTP server',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'isTauri');
 Object.defineProperty(globalThis,'isTauri',{configurable:true,value:true});
 const network=spyOn(globalThis,'fetch').mockRejectedValue(new Error('No server in desktop app'));
 try{
  expect(isOfflineLibrary()).toBe(true);
  const maze=generate({columns:2,rows:3,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'desktop-local-library'});
  const saved=await saveLibraryMaze(maze,'Desktop map');
  expect((await getLibraryMaze(saved.id)).maze).toEqual(maze);
  const prepared=await prepareLibraryWalk(maze);
  expect(prepared.firstAttempt).toBe(true);expect(prepared.maze.roof).toBe(true);
  expect(network).not.toHaveBeenCalled();
 }finally{
  network.mockRestore();
  if(previous)Object.defineProperty(globalThis,'isTauri',previous);else Reflect.deleteProperty(globalThis,'isTauri');
 }
},60_000);
