import{prepareOfflineWalk}from'./offline-walk-preparation';
let queue=Promise.resolve();
self.onmessage=(event:MessageEvent<{id:number;text:string}>)=>{
 const {id,text}=event.data;
 queue=queue.then(async()=>{try{self.postMessage({id,prepared:await prepareOfflineWalk(JSON.parse(text))});}
 catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}});
};
