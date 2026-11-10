import {storeyWire} from './two-storey-json';
import {spatialDistance,stairAt,stairProgress} from '../core/two-storey';
import type { Maze } from '../core/maze';
import { domainOf } from '../core/domain';
import { deserialize } from './maze-json';
import { Recorder,type Sample } from '../simulation/recorder';

export interface WalkRecording {samples:Sample[];distance:number;elapsed:number}
export interface WalkData {kind:'maze-lab-walk';version:1|2;id:string;maze:Maze;finished:boolean;status:'in-progress'|'stopped'|'finished';recording:WalkRecording}
export const WALK_LIMIT=12_000_000;
export function validateWalk(value:unknown):WalkData {
  const fail=():never=>{throw new Error('Некорректная запись прохождения.');};
  if(!value || typeof value!=='object')return fail();
  const raw=value as WalkData;
  if(raw.kind!=='maze-lab-walk'||![1,2].includes(raw.version)||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id)||typeof raw.finished!=='boolean'||!['in-progress','stopped','finished'].includes(raw.status))return fail();
  if(raw.finished!==(raw.status==='finished'))return fail();
  const maze=deserialize(JSON.stringify(raw.maze?.version===6?storeyWire(raw.maze):raw.maze)),recording=raw.recording;
  if(!recording||!Array.isArray(recording.samples)||recording.samples.length<1||recording.samples.length>100_000 ||
    !Number.isFinite(recording.distance)||recording.distance<0||!Number.isFinite(recording.elapsed)||recording.elapsed<0||recording.elapsed>86400)return fail();
  if((maze.version===6)!==(raw.version===2))return fail();
  const domain=domainOf(maze);let time=0,polyline=0;
  const samples=recording.samples.map((sample,i)=> {
    if(!sample||![sample.x,sample.z,sample.time].every(Number.isFinite)||sample.time<time||sample.time>recording.elapsed+1e-6||!domain.contains(sample))return fail();
    if(maze.storeys){
      if(!Number.isFinite(sample.y)||![0,1].includes(sample.floor!))return fail();
      if(sample.stair!==undefined){const st=stairAt(maze,sample);if(!st||st.id!==sample.stair||sample.floor!==(stairProgress(st,sample)<.5?0:1)||Math.abs(stairProgress(st,sample)*maze.storeys.floorHeight-sample.y!)>1e-5)return fail();}
      else if(Math.abs(sample.y!-sample.floor!*maze.storeys.floorHeight)>1e-5)return fail();
    }
    if(i===0&&sample.time!==0)return fail();
    if(i>0) {const a=recording.samples[i-1]!,length=spatialDistance(a,sample);if(length>5)return fail();if(maze.storeys){if(a.stair===undefined&&sample.stair===undefined&&a.floor!==sample.floor)return fail();if(a.stair!==undefined&&sample.stair!==undefined&&a.stair!==sample.stair)return fail();}polyline+=length;}
    time=sample.time;return {x:sample.x,z:sample.z,time:sample.time,...(maze.storeys?{y:sample.y,floor:sample.floor,...(sample.stair===undefined?{}:{stair:sample.stair})}:{})};
  });
  if(polyline>recording.distance+.01)return fail();
  return {kind:'maze-lab-walk',version:raw.version,id:raw.id,maze,finished:raw.finished,status:raw.status,
    recording:{samples,distance:recording.distance,elapsed:recording.elapsed}};
}
export function deserializeWalk(text:string):WalkData {
  if(text.length>WALK_LIMIT)throw new Error('Запись прохождения больше 12 МБ.');
  return validateWalk(JSON.parse(text));
}
export function restoreRecorder(data:WalkRecording):Recorder {
  const recorder=new Recorder(data.samples[0]!);
  for(let i=1;i<data.samples.length;i++)recorder.record(data.samples[i]!,data.samples[i]!.time,true);
  recorder.distance=data.distance;recorder.elapsed=data.elapsed;
  return recorder;
}
export function makeWalkData(maze:Maze,recorder:Recorder,id:string,finished:boolean,status:WalkData['status']):WalkData {
  return {kind:'maze-lab-walk',version:maze.storeys?2:1,id,maze,finished,status,recording:{samples:[...recorder.samples],distance:recorder.distance,elapsed:recorder.elapsed}};
}
