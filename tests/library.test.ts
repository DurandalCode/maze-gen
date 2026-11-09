import { afterEach,expect,test } from 'bun:test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../server/store';
import { createFileApi } from '../server/api';
import { generate } from '../src/generators/generate';
import { Recorder } from '../src/simulation/recorder';
import { makeWalkData,deserializeWalk,restoreRecorder } from '../src/persistence/walk-json';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'maze-library-'));roots.push(root);
  const maze=generate({columns:1,rows:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'shared'});
  const recorder=new Recorder({x:0,z:1});recorder.record({x:1,z:1},1,true);recorder.record({x:1,z:3},3,true);recorder.record({x:2,z:3},4,true);
  return {root,maze,recorder,api:createFileApi(new FileStore(root)),walk:makeWalkData(maze,recorder,'run-test-1',true,'finished')};
}
const req=(path:string,data?:unknown)=>new Request('http://127.0.0.1:1420'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});

test('two browser clients share persistent maze files, including after server restart',async()=>{
  const {api,root,maze}=await fixture();
  const a=await (await api(req('/api/mazes',{maze})))!.json();
  const b=await (await api(req('/api/mazes',{maze})))!.json();expect(a.id).toBe(b.id);
  const restarted=createFileApi(new FileStore(root));
  const list=await (await restarted(req('/api/mazes')))!.json();expect(list.mazes).toHaveLength(1);
  const loaded=await (await restarted(req('/api/mazes/'+a.id)))!.json();expect(loaded.maze).toEqual(maze);
});

test('shared runs retain maze snapshots and measured routes rather than only heat estimates',async()=>{
  const {api,walk,recorder}=await fixture();
  const response=await api(req('/api/walks',walk));expect(response!.status).toBe(201);
  const list=await (await api(req('/api/walks')))!.json();expect(list.walks).toHaveLength(1);
  expect(list.walks[0].distance).toBe(4);expect(list.walks[0].assessment.ratio).toBe(1);
  const row=await (await api(req('/api/walks/run-test-1')))!.json();
  const restored=restoreRecorder(deserializeWalk(JSON.stringify(row.walk)).recording);
  expect(restored.samples).toEqual(recorder.samples);expect(restored.distance).toBe(4);expect(restored.elapsed).toBe(4);
});

test('late checkpoints cannot overwrite a finished run',async()=>{
  const {api,walk}=await fixture();
  const early={...walk,finished:false,status:'in-progress',recording:{...walk.recording,samples:walk.recording.samples.slice(0,2),distance:1,elapsed:1}};
  await Promise.all([api(req('/api/walks',walk)),api(req('/api/walks',early))]);
  const result=await (await api(req('/api/walks/run-test-1')))!.json();expect(result.walk.status).toBe('finished');expect(result.walk.recording.distance).toBe(4);
});

test('API rejects foreign origins, invalid paths and invalid walk samples',async()=>{
  const {api,walk}=await fixture();
  const foreign=await api(new Request('http://127.0.0.1:1420/api/mazes',{headers:{Origin:'https://example.com'}}));expect(foreign!.status).toBe(403);
  expect((await api(req('/api/walks/..%2fsecret')))!.status).toBe(404);
  expect((await api(req('/api/walks',{...walk,id:'../../file'})))!.status).toBe(400);
  expect((await api(req('/api/walks',{...walk,recording:{...walk.recording,samples:[{x:NaN,z:1,time:0}]}})))!.status).toBe(400);
  expect((await api(req('/api/mazes/missing')))!.status).toBe(404);
});

test('first recorded attempt has a roof, and changing construction does not reset the protocol',async()=>{
  const {api,maze,walk}=await fixture();
  const bare={...maze,roof:false};
  const first=await (await api(req('/api/prepare-walk',{maze:bare})))!.json();
  expect(first.firstAttempt).toBe(true);expect(first.roofEnforced).toBe(true);expect(first.maze.roof).toBe(true);
  await api(req('/api/walks',{...walk,maze:first.maze}));
  const next=await (await api(req('/api/prepare-walk',{maze:{...bare,wallColor:'#123456'}})))!.json();
  expect(next.firstAttempt).toBe(false);expect(next.roofEnforced).toBe(false);expect(next.maze.roof).toBe(false);
});


test('rejected candidates retain their reason when a later checkpoint saves the same maze',async()=>{
 const {root,maze}=await fixture(),store=new FileStore(root),saved=await store.saveMaze(maze,'candidate');
 await store.rejectMaze(saved.id,'Long forced corridor');await store.saveMaze(maze);
 const result=await store.getMaze(saved.id);expect(result!.status).toBe('rejected');expect(result!.rejectionReason).toBe('Long forced corridor');
 expect((await store.listMazes())[0]!.status).toBe('rejected');
});
test('a technical candidate can be explicitly restored without changing its maze or recordings',async()=>{
 const {root,maze}=await fixture(),store=new FileStore(root),saved=await store.saveMaze(maze,'selected');
 await store.rejectMaze(saved.id,'alternative');
 const restored=await store.restoreMazeCandidate(saved.id);
 expect(restored.status).toBe('candidate');expect(restored.rejectionReason).toBeUndefined();
 expect(restored.maze).toEqual(saved.maze);expect(restored.id).toBe(saved.id);
 await expect(store.restoreMazeCandidate('missing')).rejects.toThrow('не найден');
});
