import {environmentOf} from './environment';
import {portalPoint,type Maze} from './maze';

/** Describe the finish relative to the start and the forest, without reading a route. */
export function exitLandmarkHint(maze:Maze):string {
  const side=environmentOf(maze).forest.side;
  const towardForest={north:{x:0,z:-1},east:{x:1,z:0},south:{x:0,z:1},west:{x:-1,z:0}}[side];
  const start=portalPoint(maze,maze.entrance),finish=portalPoint(maze,maze.exit);
  const progress=(finish.x-start.x)*towardForest.x+(finish.z-start.z)*towardForest.z;
  if(Math.abs(progress)<1e-6)return 'Выход — вдоль опушки';
  return progress>0?'Выход — к лесу':'Выход — к полю';
}
