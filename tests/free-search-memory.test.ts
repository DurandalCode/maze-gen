import {test,expect} from 'bun:test';
import pack from '../src/data/commute-pack.json';
import {deserialize} from '../src/persistence/maze-json';
import {analyzeFree} from '../src/free/quality';

test('directional searches finish the free map instead of making mandatory rooms cold',()=>{
  const source=pack.mazes.find(row=>row.maze.version===5&&row.maze.parameters.seed==='commute-free-6')!;
  const wire=JSON.parse(JSON.stringify(source.maze));
  // The edge entrance used in the reported heat-map failure.
  const entrance=wire.layout.openings.find((o:{id:string})=>o.id===wire.layout.entrance);
  Object.assign(entrance,{room:'m-1292',edge:2,offset:0});
  wire.parameters.loopTrapCount=0;
  const maze=deserialize(JSON.stringify(wire)),mandatory:number[]=[];
  // Independently identify rooms required by every possible entrance-exit route.
  for(let blocked=0;blocked<maze.passages.length;blocked++){
    if(blocked===maze.entrance.cell||blocked===maze.exit.cell){mandatory.push(blocked);continue;}
    const seen=new Set([maze.entrance.cell]),queue=[maze.entrance.cell];
    for(const cell of queue)for(const next of maze.passages[cell]!)if(next!==blocked&&!seen.has(next)){seen.add(next);queue.push(next);}
    if(!seen.has(maze.exit.cell))mandatory.push(blocked);
  }
  expect(mandatory.length).toBeGreaterThan(30);
  for(const profile of ['explorer','compass','outline'] as const){
    const result=analyzeFree(maze,32,profile);
    expect(result.finishedRatio).toBe(1);
    for(const cell of mandatory)expect(result.probability[cell]).toBe(1);
    expect(result.expectedLength).toBeGreaterThanOrEqual(result.optimalLength);
    expect(Math.max(...result.visits)).toBeLessThan(maze.passages.length);
    const repeated=analyzeFree(maze,32,profile);
    expect(repeated.visits).toEqual(result.visits);
    expect(repeated.expectedLength).toBe(result.expectedLength);
  }
},60000);
