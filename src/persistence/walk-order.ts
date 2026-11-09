import {canonical} from './identity';
import type {WalkData} from './walk-json';
/** A late checkpoint must never replace a finished run or a more recent position. */
export function preferWalk(old:WalkData|undefined|null,incoming:WalkData):WalkData{
 if(!old)return incoming;
 if(old.id!==incoming.id||canonical(old.maze)!==canonical(incoming.maze))throw new Error('Одинаковый идентификатор относится к разным прохождениям.');
 if(old.finished||old.recording.elapsed>incoming.recording.elapsed||(old.status==='stopped'&&incoming.status==='in-progress'&&old.recording.elapsed>=incoming.recording.elapsed))return old;
 return incoming;
}
