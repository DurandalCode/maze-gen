import {validateWalk} from './walk-json';
/** Cold queue recovery must not build a navigation graph on the rendering thread. */
self.onmessage=(event:MessageEvent<string>)=>{
  try{self.postMessage({walk:validateWalk(JSON.parse(event.data))});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'Некорректная отложенная запись.'});}
};
