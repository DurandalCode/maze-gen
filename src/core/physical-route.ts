import {corridorRoute} from './corridor-navigation';
import {domainOf} from './domain';
import {cellCenter,type Maze,type Point} from './maze';
/** Doorway-to-doorway reference inside the existing classical cells. This
 * permits corner cuts inside open cells without changing the saved graph or
 * the legacy centre-based metric used by old recordings. */
export function classicalPhysicalRoute(source:Maze):Point[]{
 if(![1,2,3].includes(source.version)||source.navigation)throw Error('Нужна исходная классическая карта.');
 const d=domainOf(source),count=source.passages.length,identity=Array.from({length:count},(_,i)=>i),maze={...source};Object.defineProperty(maze,'navigation',{value:{source,domain:d,centers:identity.map(i=>cellCenter(source,i)),representatives:identity,originalToRegion:Int32Array.from(identity)},enumerable:false});return corridorRoute(maze).points;
}
