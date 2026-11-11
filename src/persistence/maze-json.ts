import {decodeStorey,storeyWire} from './two-storey-json';
import {decodeFree,freeWire} from '../free/json';
import {corridorWire} from './corridor-json';
import {readLegacyMaze} from '../compat/legacy-maze';
import type {Maze} from '../core/maze';

export function deserialize(json:string):Maze{
 if(json.length>5_000_000)throw Error('Файл слишком большой (максимум 5 МБ).');
 const data=JSON.parse(json);
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Некорректный файл Maze Lab: проверьте формат и топологию.');
 if(data.version===6)return decodeStorey(data);
 if(data.version===5||data.version===7)return decodeFree(data);
 return readLegacyMaze(json);
}

export function serialize(maze: Maze): string {
  return JSON.stringify(maze.storeys?storeyWire(maze):(maze.version===5||maze.version===7)?freeWire(maze):maze.version===4?corridorWire(maze):maze, null, 2);
}
