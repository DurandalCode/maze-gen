import {generate} from './generate';
import type {Maze,Parameters} from '../core/maze';
self.onmessage=(event:MessageEvent<{parameters:Parameters;previous:Maze}>)=>{
  try{self.postMessage({maze:generate(event.data.parameters,event.data.previous,message=>self.postMessage({progress:message}))});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
