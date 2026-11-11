import {criticalWalls} from './critical-walls';
self.onmessage=e=>{try{self.postMessage({walls:criticalWalls(e.data)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};
