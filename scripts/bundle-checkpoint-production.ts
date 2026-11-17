/** Exercise real embedded/offline checkpoints under the desktop CSP on a production build. */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1459';
const output=process.env.MAZE_PROFILE_OUTPUT??'test-results/bundle-checkpoint-production.json';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER,headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  if(route.request().resourceType()!=='document')return route.continue();
  const response=await route.fetch();
  await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost; font-src 'self'"}});
 });
 await page.addInitScript(()=>{
  Object.defineProperty(globalThis,'isTauri',{value:true});
  const state=(window as any).__checkpointProfile={active:false,frames:[],longTasks:[],jobs:[],last:0};
  const frame=(now:number)=>{if(state.active&&state.last)state.frames.push(now-state.last);state.last=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  new PerformanceObserver(list=>{if(state.active)for(const entry of list.getEntries())state.longTasks.push(entry.duration);}).observe({type:'longtask'});
  const NativeWorker=Worker;
  (window as any).Worker=class extends NativeWorker{
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',e=>{const job=state.jobs.find((j:any)=>j.id===e.data?.id);if(job){job.ms=performance.now()-job.start;job.error=e.data.error;}});}
   postMessage(message:any,transfer?:any){if(typeof message?.id==='number'&&typeof message?.text==='string')state.jobs.push({id:message.id,start:performance.now()});super.postMessage(message,transfer);}
  };
 });
 await page.goto(base+'/?test=631830');
 await page.getByRole('button',{name:'Библиотека',exact:true}).click();
 await page.getByRole('button',{name:'Пройти вслепую 03 · Органический гибрид с дворами',exact:true}).click();
 await page.getByLabel('Управление двумя джойстиками').check();
 await page.getByRole('button',{name:/Начать прохождение/}).click();
 await page.waitForTimeout(1600);
 await page.evaluate(()=>{const p=(window as any).__checkpointProfile;p.active=true;p.last=0;});
 const stick=async(label:string,dx:number,dy:number,ms:number)=>{const box=(await page.getByLabel(label,{exact:true}).boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy);await page.waitForTimeout(ms);await page.mouse.up();};
 for(let i=0;i<4;i++){
  await stick('Левый джойстик: движение',0,-25,2300);
  await stick('Левый джойстик: движение',0,25,2300);
  if(i===1){await page.keyboard.press('KeyF');await page.getByRole('status').filter({hasText:'Направление предполагаемого выхода записано'}).waitFor();}
 }
 await page.waitForTimeout(2200);
 await page.evaluate(()=>{(window as any).__checkpointProfile.active=false;});
 await page.getByRole('button',{name:'Ⅱ Пауза',exact:true}).click();
 const hud=await page.locator('.walk-hud').innerText();
 await page.getByLabel('Сниженная нагрузка на графику',{exact:true}).check();
 if(await page.locator('.walk-hud').innerText()!==hud)throw Error('Graphics change reset the active run');
 await page.getByRole('button',{name:/Продолжить/}).first().click();
 await page.waitForTimeout(500);
 await page.getByRole('button',{name:'Ⅱ Пауза',exact:true}).click();
 await page.getByLabel('Сниженная нагрузка на графику',{exact:true}).uncheck();
 await page.getByRole('button',{name:'← Вернуться к карте',exact:true}).click();
 await page.getByLabel('Метки предполагаемого выхода',{exact:true}).waitFor();
 // Poll asynchronous IDB reads outside waitForFunction: a returned Promise is
 // truthy before its boolean result is known in Playwright's predicate poller.
 const deadline=Date.now()+30000;let persisted=false;
 while(Date.now()<deadline){
  persisted=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('maze-lab-offline-test-631830');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise<boolean>(resolve=>{const request=db.transaction('walks','readonly').objectStore('walks').getAll();request.onsuccess=()=>resolve(request.result.some((row:any)=>row.walk.status==='stopped'&&row.walk.recording.markers?.length===1)&&!Object.keys(localStorage).some(k=>k.startsWith('maze-lab:pending-walk:')));});}finally{db.close();}});
  if(persisted)break;await page.waitForTimeout(100);
 }
 if(!persisted)throw Error('Final offline recording did not commit');
 const result=await page.evaluate(async()=>{
  const p=(window as any).__checkpointProfile,frames=(p.frames as number[]).sort((a,b)=>a-b),db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('maze-lab-offline-test-631830');request.onsuccess=()=>resolve(request.result);});
  const rows=await new Promise<any[]>(resolve=>{const request=db.transaction('walks','readonly').objectStore('walks').getAll();request.onsuccess=()=>resolve(request.result);});db.close();
  return{frames:frames.length,frameP95:frames[Math.floor(frames.length*.95)],maxFrame:Math.max(...frames),longTasks:p.longTasks,workerJobs:p.jobs,walks:rows.map(row=>({status:row.walk.status,distance:row.walk.recording.distance,elapsed:row.walk.recording.elapsed,markers:row.walk.recording.markers?.length??0})),pending:Object.keys(localStorage).filter(k=>k.startsWith('maze-lab:pending-walk:')).length};
 });
 await mkdir(output.slice(0,output.lastIndexOf('/'))||'.',{recursive:true});await writeFile(output,JSON.stringify({csp:'desktop',...result,errors},null,2));console.log(JSON.stringify({...result,errors}));
 if(errors.length||result.workerJobs.length<2||result.workerJobs.some((j:any)=>j.error)||result.walks.length!==1||result.walks[0]!.markers!==1||result.pending)throw Error('Production offline checkpoint regression');
}finally{await browser.close();}
