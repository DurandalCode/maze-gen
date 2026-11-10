/** Shared view / free-placement toggle regression, using an isolated library. */
import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '../server/store';
import {freeMaze} from '../src/free/layout';
import {emptyLayout} from '../src/free/model';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {serialize} from '../src/persistence/maze-json';
import {routePoints} from '../src/core/pathfinding';
import {Recorder} from '../src/simulation/recorder';
import {makeWalkData} from '../src/persistence/walk-json';
const root=await mkdtemp(join(tmpdir(),'maze-free-common-')),store=new FileStore(root),layout=emptyLayout();
layout.modules=[{id:'a',type:'2x2',x:10,z:10,angle:0},{id:'b',type:'2x2',x:14,z:10,angle:0},{id:'c',type:'2x2',x:10,z:14,angle:0}];
layout.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4},{id:'ac',a:{room:'a',edge:2,offset:0},b:{room:'c',edge:0,offset:0},width:1.4}];
layout.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';
const maze=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:24,rows:24,moduleSize:2,corridorWidth:2,extraConnections:0,seed:'free-common-ui',algorithm:'backtracker'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout}),saved=await store.saveMaze(JSON.parse(serialize(maze)),'Free UI fixture'),route=routePoints(maze),recorder=new Recorder(route[0]!);
route.slice(1).forEach((p,i)=>recorder.record(p,i+1,true));const walk=await store.saveWalk(makeWalkData(maze,recorder,crypto.randomUUID(),true,'finished'));
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});await mkdir('test-results',{recursive:true});
try{
 for(const width of [1280,412]){
  const page=await browser.newPage({viewport:{width,height:915}}),errors:string[]=[];let walkWrites=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async request=>{
   const p=new URL(request.request().url()).pathname;let value:unknown={};
   if(p==='/api/mazes')value={mazes:await store.listMazes()};
   else if(p==='/api/walks'){if(request.request().method()==='POST')walkWrites++;value={walks:await store.listWalks()};}
   else if(p==='/api/mazes/'+saved.id)value=saved;
   else if(p==='/api/walks/'+walk.id)value=walk;
   else if(p==='/api/prepare-walk')value={maze:JSON.parse(request.request().postData()!).maze,firstAttempt:false,roofEnforced:false};
   await request.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  });
  try{
   await page.goto(process.env.MAZE_TEST_URL??'http://127.0.0.1:1457');
   await page.getByRole('button',{name:'Библиотека',exact:true}).click();
   await page.getByRole('button',{name:'Открыть лабиринт Free UI fixture',exact:true}).click();
   await page.locator('.workspace h2').filter({hasText:'Свободный лабиринт'}).waitFor();
   if(await page.locator('.free-app').count())throw Error('Library still forces the free editor');
   await page.getByRole('button',{name:'Библиотека',exact:true}).click();
   await page.getByRole('button',{name:'Открыть прохождение '+walk.id,exact:true}).click();
   await page.getByLabel('Результаты прохождения',{exact:true}).waitFor();
   await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();
   await page.locator('.free-app').waitFor();
   await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).uncheck();
   await page.getByLabel('Результаты прохождения',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
   await page.getByLabel('Метрики колдспотов',{exact:true}).waitFor();
   await page.screenshot({path:`test-results/free-common-heat-${width}.png`});
   await page.evaluate(async()=>{const {Player}=await import('/src/simulation/player.ts'),update=Player.prototype.updateAnalog;Player.prototype.updateAnalog=function(...args){(window as any).__inspectionPlayer=this;return update.apply(this,args);};});
   await page.getByRole('button',{name:'Осмотреть снаружи',exact:true}).click();
   await page.getByLabel('Управление двумя джойстиками',{exact:true}).check();
   await page.getByRole('button',{name:/Начать осмотр/}).click();
   await page.waitForFunction(()=>(window as any).__inspectionPlayer?.mode==='inspection');
   const outside=await page.evaluate(()=>{const p=(window as any).__inspectionPlayer;p.updateAnalog(1,-1,0);return {z:p.position.z,distance:p.recorder.distance,finished:p.finished};});
   if(outside.z<=maze.depth||outside.distance||outside.finished)throw Error('Inspection entered traversal recording');
   await page.getByRole('button',{name:'← Вернуться к карте',exact:true}).click();
   await page.getByLabel('Результаты прохождения',{exact:true}).waitFor();
   if(walkWrites)throw Error('Inspection wrote a walk');
   await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();
   await page.getByLabel('Выбрать объект',{exact:true}).selectOption('a');await page.getByLabel('Угол, °',{exact:true}).fill('15');
   await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).uncheck();
   const download=page.waitForEvent('download');await page.locator('.file-actions button').filter({hasText:'Сохранить'}).click();const file=await download,wire=await Bun.file((await file.path())!).json();
   if(wire.version!==5||wire.layout.modules.find(m=>m.id==='a').angle!==15)throw Error('Toggle lost edited geometry');
   if(await page.getByLabel('Результаты прохождения',{exact:true}).count())throw Error('Changed geometry retained the old route');
   // JSON import also stays in the shared interface.
   const picker=page.waitForEvent('filechooser');await page.locator('.file-actions button').filter({hasText:'Открыть'}).click();await (await picker).setFiles({name:'free.json',mimeType:'application/json',buffer:Buffer.from(serialize(maze))});
   await page.locator('.workspace h2').filter({hasText:'Свободный лабиринт'}).waitFor();if(await page.locator('.free-app').count())throw Error('JSON import forces the editor');
   await page.getByRole('button',{name:'Настройки',exact:true}).click();if(await page.getByLabel('Размещение',{exact:true}).inputValue()!=='free')throw Error('Common settings changed placement');
   if(!await page.getByLabel('Ширина площадки, м',{exact:true}).count())throw Error('Free site uses grid units');
   if(errors.length)throw Error(errors.join('\n'));
   console.log(JSON.stringify({width,library:'passed',recording:'passed',toggle:'passed',heat:'passed',inspection:'passed',import:'passed'}));
  }finally{await page.close();}
 }
}finally{await browser.close();await rm(root,{recursive:true,force:true});}
