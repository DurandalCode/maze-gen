import {storeyWire} from './two-storey-json';
import {freeWire} from '../free/json';
import {deserialize} from './maze-json';
import {corridorWire} from './corridor-json';
import type {Maze} from '../core/maze';
/** Storage/export boundary: v4 never persists its navigation raster. */
export function recordJson(value:unknown):string{return JSON.stringify(value,(key,v)=>key==='maze'&&v?.version===6?storeyWire(v as Maze):key==='maze'&&(v?.version===5||v?.version===7)?freeWire(v as Maze):key==='maze'&&v?.version===4?corridorWire(v as Maze):v);}
export function restoreRecord<T>(value:T):T{
 const row=value as {maze?:Maze;walk?:{maze:Maze}}|null;
 if((row?.maze?.version===4||(row?.maze?.version===5||row?.maze?.version===7)||row?.maze?.version===6))row.maze=deserialize(JSON.stringify(row.maze));
 if((row?.walk?.maze?.version===4||(row?.walk?.maze?.version===5||row?.walk?.maze?.version===7)||row?.walk?.maze?.version===6))row.walk.maze=deserialize(JSON.stringify(row.walk.maze));
 return value;
}
