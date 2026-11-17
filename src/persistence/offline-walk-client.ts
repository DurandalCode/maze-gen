import{recordJson}from'./record-codec';
import{prepareOfflineWalk,type PreparedOfflineWalk}from'./offline-walk-preparation';
let worker:Worker|undefined,unavailable=false,nextId=0;
const pending=new Map<number,{text:string;resolve:(value:PreparedOfflineWalk)=>void;reject:(error:unknown)=>void}>();
function fallback(){
 worker?.terminate();worker=undefined;unavailable=true;
 for(const [id,job]of pending){pending.delete(id);void Promise.resolve().then(()=>prepareOfflineWalk(JSON.parse(job.text))).then(job.resolve,job.reject);}
}
/** Only this module accepts messages from its own worker. No caller can mark
 * untrusted data as already validated or bypass the normal recording checks. */
export function prepareOfflineWalkForStorage(raw:unknown):Promise<PreparedOfflineWalk>{
 if(unavailable||typeof document==='undefined'||typeof Worker==='undefined')return prepareOfflineWalk(raw);
 if(!worker){try{
  worker=new Worker(new URL('./offline-walk-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=(event:MessageEvent<{id:number;prepared?:PreparedOfflineWalk;error?:string}>)=>{
   const job=pending.get(event.data.id);if(!job)return;pending.delete(event.data.id);
   if(event.data.error!==undefined)job.reject(new Error(event.data.error));else if(event.data.prepared)job.resolve(event.data.prepared);else job.reject(new Error('Не удалось проверить локальную запись.'));
  };
  worker.onerror=()=>fallback();worker.onmessageerror=()=>fallback();
 }catch{unavailable=true;return prepareOfflineWalk(raw);}}
 const text=recordJson(raw),id=++nextId;
 return new Promise((resolve,reject)=>{pending.set(id,{text,resolve,reject});try{worker!.postMessage({id,text});}catch{fallback();}});
}
