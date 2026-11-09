import type { Maze } from '../core/maze';
import { domainOf } from '../core/domain';
import { deserialize } from './maze-json';
import { Recorder,type Sample } from '../simulation/recorder';

export interface WalkRecording {samples:Sample[];distance:number;elapsed:number}
export interface WalkData {kind:'maze-lab-walk';version:1;id:string;maze:Maze;finished:boolean;status:'in-progress'|'stopped'|'finished';recording:WalkRecording}
export const WALK_LIMIT=12_000_000;
export function validateWalk(value:unknown):WalkData {
  const fail=():never=>{throw new Error('Некорректная запись прохождения.');};
  if(!value || typeof value!=='object')return fail();
  const raw=value as WalkData;
  if(raw.kind!=='maze-lab-walk'||raw.version!==1||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id)||typeof raw.finished!=='boolean'||!['in-progress','stopped','finished'].includes(raw.status))return fail();
  if(raw.finished!==(raw.status==='finished'))return fail();
  const maze=deserialize(JSON.stringify(raw.maze)),recording=raw.recording;
  if(!recording||!Array.isArray(recording.samples)||recording.samples.length<1||recording.samples.length>100_000 ||
    !Number.isFinite(recording.distance)||recording.distance<0||!Number.isFinite(recording.elapsed)||recording.elapsed<0||recording.elapsed>86400)return fail();
  const domain=domainOf(maze);let time=0,polyline=0;
  const samples=recording.samples.map((sample,i)=> {
    if(!sample||![sample.x,sample.z,sample.time].every(Number.isFinite)||sample.time<time||sample.time>recording.elapsed+1e-6||!domain.contains(sample))return fail();
    if(i===0&&sample.time!==0)return fail();
    if(i>0) {const a=recording.samples[i-1]!,length=Math.hypot(a.x-sample.x,a.z-sample.z);if(length>5)return fail();polyline+=length;}
    time=sample.time;return {x:sample.x,z:sample.z,time:sample.time};
  });
  if(polyline>recording.distance+.01)return fail();
  return {kind:'maze-lab-walk',version:1,id:raw.id,maze,finished:raw.finished,status:raw.status,
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
  return {kind:'maze-lab-walk',version:1,id,maze,finished,status,recording:{samples:[...recorder.samples],distance:recorder.distance,elapsed:recorder.elapsed}};
}
