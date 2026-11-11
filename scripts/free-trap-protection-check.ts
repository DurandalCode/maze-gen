import {landmarkMapBounds} from '../src/core/environment';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {serialize} from '../src/persistence/maze-json';
import {freeLoopTrapFixture,freeRouteTrapFixture} from '../tests/fixtures/free-traps';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1420',assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
try{for(const [width,kind,maze] of [[1440,'loop',freeLoopTrapFixture()],[412,'trap',freeRouteTrapFixture()]] as const){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}));await page.goto(base);
 await page.evaluate(()=>{const W=window.Worker;window.Worker=class extends W{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',e=>{if(e.data.walls)(window as any).__critical=e.data.walls;});}};(window as any).__ticks=0;setInterval(()=>(window as any).__ticks++,20);});
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Открыть',exact:true}).click();await(await picker).setFiles({name:'protection.json',mimeType:'application/json',buffer:Buffer.from(serialize(maze))});await page.getByText('Лабиринт загружен. Топология восстановлена из файла.',{exact:true}).waitFor();
 const save=async()=>{const d=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить',exact:true}).click();return readFile((await(await d).path())!,'utf8');},before=await save(),control=page.getByLabel('Критические стены',{exact:true}),status=page.getByLabel('Расчёт критических стен',{exact:true});
 await control.check();await status.filter({hasText:'Вычисляем критические стены'}).waitFor();await page.getByRole('button',{name:'Приблизить',exact:true}).click();
 // Cancellation really terminates an in-flight calculation, then a fresh worker completes it.
 await control.uncheck();assert(!(await status.count()),'Cancelled status remained visible');await control.check();await status.filter({hasText:'Защищённых стен:'}).waitFor({timeout:180000});
 const state=await page.evaluate(({kind,bounds})=>{const result=(window as any).__critical,item=result.find((w:any)=>w.protections.some((p:any)=>p.kind===kind)),canvas=document.querySelector('.map-canvas') as HTMLCanvasElement,w=canvas.clientWidth,h=canvas.clientHeight,scale=Math.max(.1,Math.min((w-150)/(bounds.maxX-bounds.minX),(h-160)/(bounds.maxZ-bounds.minZ))*1.25),left=w/2-(bounds.minX+bounds.maxX)*scale/2,top=h/2-(bounds.minZ+bounds.maxZ)*scale/2;return {count:result.length,item:item?{x:left+(item.wall.x1+item.wall.x2)/2*scale,y:top+(item.wall.z1+item.wall.z2)/2*scale}:null,ticks:(window as any).__ticks};},{kind,bounds:landmarkMapBounds(maze)});
 assert(state.item,`No ${kind} protections reached the real map`);assert(state.ticks>20,'UI heartbeat stopped');const box=await page.locator('.map-canvas').boundingBox();await page.mouse.move(box!.x+state.item!.x,box!.y+state.item!.y);await page.locator('.heat-tooltip').filter({hasText:'Критическая стена:'}).waitFor();
 assert(await save()===before,'Critical-wall analysis mutated the loaded map');assert(errors.length===0,errors.join('\n'));console.log(JSON.stringify({width,kind,count:state.count,cancel:'passed',tooltip:'passed',immutable:'passed',responsive:'passed'}));await page.close();
}}finally{await browser.close();}
