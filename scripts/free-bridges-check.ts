/** Real free generation/editor/3D/traversal/library acceptance for elevated v7 maps. */
import {chromium,type Page} from 'playwright';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileStore} from '../server/store';
import {createFileApi} from '../server/api';
import {recordJson} from '../src/persistence/record-codec';
import {validateLibraryExport} from '../src/persistence/library-export';
import {validateWalk} from '../src/persistence/walk-json';
const root=await mkdtemp(join(tmpdir(),'maze-bridges-browser-')),store=new FileStore(root),api=createFileApi(store);
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1420';
await mkdir('test-results',{recursive:true});
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
async function saveFile(page:Page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить',exact:true}).click();return JSON.parse(await readFile((await (await pending).path())!,'utf8'));}
try{
 for(const width of [1440,412]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.stack??e.message));
  await page.route('**/api/**',async route=>{
   const r=route.request(),response=await api(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.method()==='POST'?{body:r.postData()}: {})}));
   if(!response){await route.continue();return;}
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  try{
   await page.goto(base);
   await page.getByRole('button',{name:'Настройки',exact:true}).click();
   await page.getByLabel('Размещение',{exact:true}).selectOption('free');
   await page.getByLabel('Ширина площадки, м',{exact:true}).fill('30');await page.getByLabel('Глубина площадки, м',{exact:true}).fill('30');
   await page.getByLabel('Алгоритм',{exact:true}).selectOption('prim');await page.locator('.seed-input input').fill('bridges-5');
   await page.getByLabel('Крытые мосты',{exact:true}).fill('');
   assert(await page.getByLabel('Дополнительные соединения',{exact:true}).inputValue()==='0','Clearing bridge count corrupted the loop setting');
   await page.getByLabel('Крытые мосты',{exact:true}).fill('2');
   await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.generate')?.hasAttribute('disabled'),{},{timeout:45000});
   await page.getByRole('button',{name:'Лабиринт',exact:true}).click();
   await page.getByRole('heading',{name:'Свободный лабиринт 30 × 30',exact:true}).waitFor();
   await page.getByText(/Крытых мостов: 2/).waitFor();
   await page.getByRole('button',{name:'Настройки',exact:true}).click();
   assert(await page.getByLabel('Высота стен',{exact:true}).isDisabled(),'Direct height edit can invalidate bridge clearance');
   await page.getByRole('button',{name:'Лабиринт',exact:true}).click();
   const wire=await saveFile(page);assert(wire.version===7&&wire.layout.bridges.length===2,'Generation did not produce both bridges');
   assert(wire.layout.modules.length>20&&wire.layout.modules.some(m=>m.type==='2x6'),'Generation replaced the mixed organic network');
   await page.getByLabel('Кратчайший путь',{exact:true}).check();
   await page.screenshot({path:`test-results/free-bridges-map-${width}.png`,fullPage:true});
   // The same map remains editable and a broken clearance is actionable.
   await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();
   await page.getByLabel('Выбрать объект',{exact:true}).selectOption(wire.layout.bridges[0].id);
   const height=page.getByLabel('Высота настила, м',{exact:true});await height.fill('2.2');
   await page.getByRole('button',{name:'Под мостом недостаточно высоты над стенами и крышей нижнего прохода.',exact:true}).waitFor();
   assert(await page.getByRole('button',{name:'Сохранить карту',exact:true}).isDisabled(),'Invalid bridge was accepted');
   await page.getByRole('button',{name:'Отменить правку',exact:true}).click();
   await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
   await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).uncheck();
   // Import goes through the public file control, with canonical geometry rebuild.
   const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Открыть',exact:true}).click();
   await (await picker).setFiles({name:'bridges.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(wire))});
   await page.getByText('Лабиринт загружен. Топология восстановлена из файла.',{exact:true}).waitFor();
   assert(JSON.stringify(await saveFile(page))===JSON.stringify(wire),'v7 round trip changed geometry');
   await page.getByRole('button',{name:'В библиотеку',exact:true}).click();
   await page.getByText('Лабиринт сохранён в общей библиотеке.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Проанализировать',exact:true}).click();await page.getByLabel('Метрики колдспотов',{exact:true}).waitFor();
   await page.getByLabel('Использование мостов',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Улучшить размещение',exact:true}).click();
   await page.getByRole('button',{name:'Отмена',exact:true}).click();
   await page.getByText('Оптимизация отменена.',{exact:true}).waitFor();
   assert(JSON.stringify(await saveFile(page))===JSON.stringify(wire),'Cancellation changed the current free map');
   await page.evaluate(async()=>{const {Player}=await import('/src/simulation/player.ts'),update=Player.prototype.updateAnalog;Player.prototype.updateAnalog=function(...args){(window as any).__bridgePlayer=this;return update.apply(this,args);};});
   await page.getByRole('button',{name:/Пройти от первого лица/}).click();
   await page.getByLabel('Управление двумя джойстиками').check();await page.getByRole('button',{name:/Начать прохождение/}).click();
   await page.waitForFunction(()=>!!(window as any).__bridgePlayer);
   // Walk the real UI Player continuously, without setting position or teleporting.
   const lower=await page.evaluate(async()=>{
    const p=(window as any).__bridgePlayer,{freeRoute,freeRuntime}=await import('/src/free/layout.ts'),{bridgeGeometry}=await import('/src/free/bridges.ts');
    const r=freeRuntime(p.maze),bridges=p.maze.free.bridges;
    const go=(q:any)=>{let n=0;while(Math.hypot(q.x-p.position.x,q.z-p.position.z)>.01&&!p.finished){if(n++>2000)throw Error('Stuck '+JSON.stringify(p.position)+' toward '+JSON.stringify(q));const dx=q.x-p.position.x,dz=q.z-p.position.z;p.yaw=Math.atan2(-dx,-dz);p.updateAnalog(Math.min(.02,Math.hypot(dx,dz)/1.4),1,0);}};
    const under=r.rooms.findIndex(v=>v.id==='bridge-underpass');for(const q of freeRoute(p.maze,p.maze.entrance.cell,under).points)go(q);
    const g=bridgeGeometry(p.maze.free,bridges[0]),mid=g.at(.5),a={x:mid.x-g.uz*.7,z:mid.z+g.ux*.7},b={x:mid.x+g.uz*.7,z:mid.z-g.ux*.7};
    go(a);go(b);if(p.position.bridge!==undefined||(p.position.y??0)!==0)throw Error('Lower crossing incorrectly climbed bridge');
    (window as any).__bridgeGo=go;p.pitch=-.5;return {height:p.position.y,bridge:p.position.bridge??null};
   });
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.screenshot({path:`test-results/free-bridges-under-${width}.png`});
   await page.evaluate(async()=>{
    const p=(window as any).__bridgePlayer,go=(window as any).__bridgeGo,{freeRoute,freeRuntime}=await import('/src/free/layout.ts'),{bridgeGeometry}=await import('/src/free/bridges.ts');
    const g=bridgeGeometry(p.maze.free,p.maze.free.bridges[0]),r=freeRuntime(p.maze),under=r.rooms.findIndex(v=>v.id==='bridge-underpass'),a=r.rooms.findIndex(v=>v.id===g.bridge.a.room);
    go(r.centers[under]);for(const q of freeRoute(p.maze,under,a).points)go(q);
    go(g.path[0]);go(g.path[1]);go(g.at(.5));p.pitch=.1;
   });
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.screenshot({path:`test-results/free-bridges-above-${width}.png`});
   const walked=await page.evaluate(async()=>{
    const p=(window as any).__bridgePlayer,go=(window as any).__bridgeGo,{freeRoute,freeRuntime}=await import('/src/free/layout.ts'),{bridgeGeometry}=await import('/src/free/bridges.ts');
    const r=freeRuntime(p.maze),first=bridgeGeometry(p.maze.free,p.maze.free.bridges[0]);
    go(first.path[2]);go(first.path[3]);for(const q of [...first.path].reverse())go(q);
    let current=r.rooms.findIndex(v=>v.id===first.bridge.a.room);go(r.centers[current]);
    for(const bridge of p.maze.free.bridges.slice(1)){
     const g=bridgeGeometry(p.maze.free,bridge),a=r.rooms.findIndex(v=>v.id===bridge.a.room),b=r.rooms.findIndex(v=>v.id===bridge.b.room);
     for(const q of freeRoute(p.maze,current,a).points)go(q);for(const q of g.path)go(q);go(r.centers[b]);current=b;
    }
    for(const q of freeRoute(p.maze,current,p.maze.exit.cell).points)go(q);
    return {finished:p.finished,bridges:[...new Set(p.recorder.samples.map(s=>s.bridge).filter(Boolean))],distance:p.recorder.distance};
   });
   assert(walked.finished&&walked.bridges.length===2,'UI traversal did not use both bridges and reach the exit');
   await page.getByText('ВЫХОД НАЙДЕН',{exact:true}).waitFor();
   await page.getByText('Маршрут сохранён в общей библиотеке.',{exact:true}).waitFor();
   const rows=await store.listWalks(),last=(await store.getWalk(rows.find(r=>r.distance===walked.distance)!.id))!;
   const restored=validateWalk(JSON.parse(JSON.stringify(last.walk)));
   assert(restored.version===2&&restored.maze.version===7&&restored.recording.samples.some(s=>s.bridge),'Saved walk lost bridge/elevation state');
   await page.goto(base+`/?offline=1&test=${width===1440?'711144':'711412'}`);
   await page.evaluate(async record=>{const {offlineRequest}=await import('/src/persistence/offline-library.ts');await offlineRequest('/api/walks',record);},JSON.parse(recordJson(last.walk)));
   await page.getByRole('button',{name:'Обновить библиотеку',exact:true}).click();
   await page.getByRole('button',{name:'Открыть прохождение '+last.id,exact:true}).click();
   await page.getByLabel('Результаты прохождения',{exact:true}).waitFor();
   await page.getByText(/Крытых мостов: 2/).waitFor();
   await page.getByRole('button',{name:'Библиотека',exact:true}).click();
   const exportPending=page.waitForEvent('download');await page.getByRole('button',{name:'Экспортировать записи',exact:true}).click();
   const exported=validateLibraryExport(JSON.parse(await readFile((await (await exportPending).path())!,'utf8')));
   assert(exported.walks.some(w=>w.id===last.id&&w.maze.version===7&&w.recording.samples.some(s=>s.bridge)),'Offline export lost elevated bridge data');
   await page.reload();await page.getByRole('button',{name:'Открыть прохождение '+last.id,exact:true}).click();
   await page.getByLabel('Результаты прохождения',{exact:true}).waitFor();
   await page.goto(base+'/?preset=free-bridges');
   await page.getByRole('heading',{name:'Свободный лабиринт 30 × 30',exact:true}).waitFor({timeout:45000});
   await page.getByText(/Крытых мостов: 2/).waitFor();
   await page.screenshot({path:`test-results/free-bridges-preset-${width}.png`,fullPage:true});
   await page.evaluate(async()=>{const {Player}=await import('/src/simulation/player.ts'),update=Player.prototype.updateAnalog;Player.prototype.updateAnalog=function(...args){(window as any).__inspectionPlayer=this;return update.apply(this,args);};});
   await page.getByRole('button',{name:'Осмотреть снаружи',exact:true}).click();
   await page.getByLabel('Управление двумя джойстиками').check();await page.getByRole('button',{name:'Начать осмотр',exact:false}).click();
   await page.waitForFunction(()=>!!(window as any).__inspectionPlayer);
   const inspection=await page.evaluate(async()=>{
    const p=(window as any).__inspectionPlayer,{bridgeGeometry}=await import('/src/free/bridges.ts'),g=bridgeGeometry(p.maze.free,p.maze.free.bridges[0]);
    p.position={x:g.a.mid.x-g.ux*.35,z:g.a.mid.z-g.uz*.35,y:0,floor:0};p.yaw=Math.atan2(-g.ux,-g.uz);p.updateAnalog(1,1,0);
    if(g.progress(p.position)>.001)throw Error('Inspection passed through the stair body');
    const mid=g.at(.5);p.position={x:mid.x-g.uz*.7,z:mid.z+g.ux*.7,y:0,floor:0};p.yaw=Math.atan2(-g.uz,g.ux);p.updateAnalog(1,1,0);
    if(Math.hypot(p.position.x-(mid.x+g.uz*.7),p.position.z-(mid.z-g.ux*.7))>.02)throw Error('Inspection lower crossing was blocked');
    p.position={x:mid.x-g.uz*30,z:mid.z+g.ux*30,y:0,floor:0};p.yaw=Math.atan2(p.position.x-mid.x,p.position.z-mid.z);p.pitch=-.18;
    return {mode:p.mode,distance:p.recorder.distance,elapsed:p.recorder.elapsed};
   });
   assert(inspection.mode==='inspection'&&inspection.distance===0&&inspection.elapsed===0,'Inspection created a walk');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.screenshot({path:`test-results/free-bridges-exterior-${width}.png`});
   await page.getByRole('button',{name:/Вернуться к карте/}).click();
   assert(!errors.length,errors.join('\n'));
   console.log(JSON.stringify({width,generation:'passed',editor:'passed',json:'passed',analysis:'passed',lower,walked,library:'passed',offlineExport:'passed',reload:'passed',preset:'passed',inspection:'passed'}));
  }catch(e){console.error({errors,body:(await page.locator('body').innerText()).slice(-4000)});await page.screenshot({path:`test-results/free-bridges-error-${width}.png`,fullPage:true});throw e;}
  finally{await page.close();}
 }
}finally{await browser.close();await rm(root,{recursive:true,force:true});}
