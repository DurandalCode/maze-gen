/** Browser and Android-like offline acceptance. Run with a local Vite server. */
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
await page.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:`export function createHotContext(){return {accept(){},dispose(){},on(){},invalidate(){},prune(){},data:{}}} export function injectQuery(u){return u} export function updateStyle(id,text){let s=document.getElementById(id);if(!s){s=document.createElement('style');s.id=id;document.head.appendChild(s)}s.textContent=text} export function removeStyle(id){document.getElementById(id)?.remove()}` }));
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1437';
await mkdir('test-results',{recursive:true});
try{
  console.log('generation and upper editor');
  await page.goto(base);await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByLabel('Тип лабиринта',{exact:true}).selectOption('two-storey');
  if(await page.getByLabel('Минимум смен этажей').inputValue()!=='4')throw Error('Missing default transition count');
  await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
  await page.getByRole('heading',{name:/Двухэтажный лабиринт/}).waitFor();
  if(await page.getByLabel('Конструкция',{exact:true}).count())throw Error('Two-storey construction must be fixed');
  await page.getByRole('button',{name:'Этаж 2',exact:true}).click();
  await page.getByRole('button',{name:'Редактировать форму',exact:true}).click();
  await page.getByLabel('Редактор формы лабиринта').waitFor();
  await page.getByLabel('Прямоугольники',{exact:true}).selectOption('0');
  await page.getByLabel('Прямоугольник: width',{exact:true}).fill('4');
  await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
  await page.getByRole('button',{name:'Сгенерировать',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.generate')?.hasAttribute('disabled'));
  if(await page.locator('.shape-editor').count())throw Error('Partial upper generation did not finish');
  await page.screenshot({path:'test-results/two-storey-upper.png',fullPage:true});
  await page.getByRole('button',{name:'Этаж 1',exact:true}).click();
  await page.screenshot({path:'test-results/two-storey-lower.png',fullPage:true});
  await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
  await page.getByLabel('Метрики колдспотов').waitFor();
  await page.getByRole('button',{name:'Этаж 2',exact:true}).click();
  await page.screenshot({path:'test-results/two-storey-heat.png',fullPage:true});
  console.log('full browser traversal');
  // Capture the real player instance through a test-only prototype wrapper.
  await page.evaluate(async()=>{
    const {Player}=await import('/src/simulation/player.ts');const original=Player.prototype.updateAnalog;
    Player.prototype.updateAnalog=function(dt:number,forward:number,right:number,sprint=false){(window as any).__storeyPlayer=this;return original.call(this,dt,forward,right,sprint);};
  });
  await page.getByRole('button',{name:/Пройти от первого лица/}).click();
  if(process.env.MAZE_TOUCH==='1')await page.getByLabel('Управление двумя джойстиками').check();
  await page.getByRole('button',{name:'Начать прохождение'}).click();
  if(process.env.MAZE_TOUCH!=='1')await page.keyboard.down('w');
  await page.waitForFunction(()=>!!(window as any).__storeyPlayer);
  if(process.env.MAZE_TOUCH!=='1')await page.keyboard.up('w');
  await page.evaluate(async()=>{
    const {routePoints}=await import('/src/core/pathfinding.ts'),p=(window as any).__storeyPlayer,points=routePoints(p.maze);
    for(let i=1;i<points.length;i++){const q=points[i]!;let steps=0;while(Math.hypot(q.x-p.position.x,q.z-p.position.z)>.015){if(steps++>1500)throw Error('Stuck approaching stair');const dx=q.x-p.position.x,dz=q.z-p.position.z;p.yaw=Math.atan2(-dx,-dz);p.updateAnalog(Math.min(.02,Math.hypot(dx,dz)/1.4),1,0);}
      if(p.position.stair!==undefined&&p.position.y>0){(window as any).__storeyRemaining=points.slice(i+1);p.pitch=-.08;break;}
    }
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:'test-results/two-storey-stair.png',fullPage:true});
  const simulation=await page.evaluate(async()=>{
    const p=(window as any).__storeyPlayer,points=(window as any).__storeyRemaining;
    let upstairs=false;
    for(const q of points){
      let steps=0;while(Math.hypot(q.x-p.position.x,q.z-p.position.z)>.015&&!p.finished){if(steps++>1500)throw Error('Stuck during full browser traversal');const dx=q.x-p.position.x,dz=q.z-p.position.z;p.yaw=Math.atan2(-dx,-dz);p.updateAnalog(Math.min(.02,Math.hypot(dx,dz)/1.4),1,0);upstairs ||= p.position.floor===1;}
    }
    return {finished:p.finished,upstairs,samples:p.recorder.samples.length};
  });
  if(!simulation.finished||!simulation.upstairs)throw Error('Browser traversal did not use both floors');
  await page.getByText('ВЫХОД НАЙДЕН',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/two-storey-finished.png',fullPage:true});
  console.log('offline and touch');
  // Android/offline route: native bridge + actual IndexedDB, no server persistence.
  await page.addInitScript(()=>{(window as any).MazeAndroid={getPlatform:()=> 'android',exportData:()=>{}};});
  await page.goto(base+'/?offline=1&test=611024');
  await page.getByRole('button',{name:'Закрыть библиотеку',exact:true}).click();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByLabel('Тип лабиринта',{exact:true}).selectOption('two-storey');
  await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();await page.getByRole('heading',{name:/Двухэтажный лабиринт/}).waitFor();
  await page.getByRole('button',{name:'В библиотеку',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.generate')?.hasAttribute('disabled'));
  const stored=await page.evaluate(async()=>{const {offlineRequest}=await import('/src/persistence/offline-library.ts');return await offlineRequest('/api/mazes') as {mazes:{generationType:string}[]};});
  if(!stored.mazes.some(m=>m.generationType==='two-storey'))throw Error('Offline library lost the map');
  await page.getByRole('button',{name:/Пройти от первого лица/}).click();await page.getByRole('button',{name:'Начать прохождение'}).waitFor();
  if(!await page.getByLabel('Управление двумя джойстиками').isChecked())await page.getByLabel('Управление двумя джойстиками').check();
  await page.getByRole('button',{name:'Начать прохождение'}).click();await page.locator('.touch-controls').waitFor();
  await page.screenshot({path:'test-results/two-storey-touch.png',fullPage:true});
  await page.locator('.touch-stick-move .front').waitFor();
  const zone=await page.getByLabel('Левый джойстик: движение').boundingBox();if(!zone)throw Error('Missing movement zone');
  await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2);await page.mouse.down();await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2-45,{steps:6});
  await page.waitForFunction(()=>Number(document.querySelector('.walk-hud strong:last-child')?.textContent?.replace(/[^0-9.]/g,''))>0);await page.mouse.up();
  await page.getByRole('button',{name:/Вернуться к карте/}).click();
  await page.getByText('Маршрут сохранён на устройстве.',{exact:false}).waitFor();
  const exported=await page.evaluate(async()=>{const {buildLibraryExport,validateLibraryExport}=await import('/src/persistence/library-export.ts'),{recordJson}=await import('/src/persistence/record-codec.ts');const data=validateLibraryExport(JSON.parse(recordJson(await buildLibraryExport())));return {version:data.modelVersion,walks:data.walks.filter(w=>w.maze.version===6).length};});
  if(exported.version!==11||!exported.walks)throw Error('Offline recording/export lost floor state');
  await page.reload();const restarted=await page.evaluate(async()=>{const {offlineRequest}=await import('/src/persistence/offline-library.ts');return await offlineRequest('/api/walks') as {walks:unknown[]};});if(!restarted.walks.length)throw Error('Offline recording did not survive restart');
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({browser:'passed',traversal:simulation,offline:'passed',touch:'passed'}));
}catch(e){await page.screenshot({path:'test-results/two-storey-error.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-6000));console.error(errors);throw e;}finally{await browser.close();}
