import {criticalWalls} from './critical-walls';
self.onmessage=e=>{let last=0;try{self.postMessage({walls:criticalWalls(e.data,(done,total)=>{const now=performance.now();if(done===0||done===total||now-last>=100){last=now;self.postMessage({progress:{done,total}});}})});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};
