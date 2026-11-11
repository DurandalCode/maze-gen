/** Browser regressions for the repairs, plus the retained grid generators.
 * Run against Vite with MAZE_TEST_URL and optionally MAZE_BROWSER. */
import {chromium, type Page} from 'playwright';
import {mkdir, readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {deserialize} from '../src/persistence/maze-json';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:process.env.MAZE_HEADLESS!=='0',args:['--enable-unsafe-swiftshader']});
const fallback=process.env.MAZE_VERIFY_LOCK_FALLBACK==='1';
const touch=!fallback&&(process.env.MAZE_TOUCH==='1'||process.env.MAZE_TOUCH===undefined&&process.env.MAZE_HEADLESS!=='0');
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1420';
await mkdir('test-results',{recursive:true});
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
async function download(page:Page){
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  return JSON.parse(await readFile((await (await pending).path())!,'utf8'));
}
try{
 for(const width of [1440,412].filter(w=>!process.env.MAZE_TEST_WIDTH||w===Number(process.env.MAZE_TEST_WIDTH))){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  // The test gets its own walk preparation; it never adds attempts to the user's library.
  await page.route('**/api/prepare-walk',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({maze:deserialize(JSON.stringify(r.request().postDataJSON().maze)),firstAttempt:false,roofEnforced:false})}));
  await page.route('**/api/walks',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({saved:true,walks:[]})}));
  try{
   await page.goto(base);
   for(const [type,label,size,seed] of [
    ['classical','Классический','5','FIELD-024'],
    ['living','Живой','7','living-proof'],
    ['corridor','Коридорный','18','CORRIDOR-TEST'],
   ].filter(([type])=>!process.env.MAZE_ONLY_TYPE||type===process.env.MAZE_ONLY_TYPE)){
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    await page.getByLabel('Тип лабиринта',{exact:true}).selectOption(type!);
    await page.getByLabel(type==='corridor'?'Ширина площадки, м':'Столбцы',{exact:true}).fill(size!);
    await page.getByLabel(type==='corridor'?'Глубина площадки, м':'Строки',{exact:true}).fill(size!);
    await page.getByLabel('Дополнительные соединения',{exact:true}).fill('2');
    await page.locator('.seed-input input').fill(seed!);
    await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.generate')?.hasAttribute('disabled'));
    await page.getByRole('button',{name:'Лабиринт',exact:true}).click();
    await page.getByRole('heading',{name:new RegExp(label!+' лабиринт '+size+' × '+size)}).waitFor();
    const wire=await download(page);
    assert((wire.parameters.generationType??'classical')===type,'Wrong generator in saved file');
    assert(wire.parameters.extraConnections===2,'Lost cycle setting');
    const picker=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'Открыть',exact:true}).click();
    await (await picker).setFiles({name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(wire))});
    await page.getByText('Лабиринт загружен. Топология восстановлена из файла.',{exact:true}).waitFor();
    assert(isDeepStrictEqual(await download(page),wire),'JSON round trip changed topology');
    await page.getByRole('button',{name:/Пройти от первого лица/}).click();
    await page.getByRole('button',{name:/Начать прохождение/}).waitFor();
    await page.getByRole('button',{name:/Вернуться к карте/}).click();
    assert(await page.getByLabel('Результаты прохождения',{exact:true}).count()===0,'Unstarted walk produced a result');
    await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
    await page.getByLabel('Метрики колдспотов',{exact:true}).waitFor();
    await page.screenshot({path:`test-results/main-${type}-${width}.png`,fullPage:true});
    console.log(JSON.stringify({width,type,generation:'passed',json:'passed',cancelPreview:'passed',analysis:'passed'}));
   }
   // Start and finish a real keyboard walk, then ensure preview cancellation
   // preserves the previous result, instead of replacing it by an empty attempt.
   await page.getByRole('button',{name:'Настройки',exact:true}).click();
   await page.getByLabel('Тип лабиринта',{exact:true}).selectOption('classical');
   await page.getByLabel('Столбцы',{exact:true}).fill('1');await page.getByLabel('Строки',{exact:true}).fill('1');
   await page.getByLabel('Дополнительные соединения',{exact:true}).fill('0');
   await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
   await page.getByRole('button',{name:'Лабиринт',exact:true}).click();
   await page.getByRole('button',{name:/Пройти от первого лица/}).click();
   await page.getByLabel('Управление двумя джойстиками').setChecked(touch);
   await page.getByRole('button',{name:/Начать прохождение/}).click();
   if(fallback)await page.getByRole('button',{name:'Продолжить с джойстиками',exact:true}).click();
   if(touch||fallback){
    await page.locator('.touch-stick-move .front').waitFor();
    const zone=(await page.getByLabel('Левый джойстик: движение').boundingBox())!;
    await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2);await page.mouse.down();
    await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2-45,{steps:6});
    await page.getByText('ВЫХОД НАЙДЕН',{exact:true}).waitFor({timeout:15000});await page.mouse.up();
   }else{await page.keyboard.down('w');await page.getByText('ВЫХОД НАЙДЕН',{exact:true}).waitFor({timeout:15000});await page.keyboard.up('w');}
   const result=await page.getByLabel('Результаты прохождения',{exact:true}).innerText();
   await page.getByRole('button',{name:/Пройти от первого лица/}).click();
   await page.getByRole('button',{name:/Начать прохождение/}).waitFor();
   await page.getByRole('button',{name:/Вернуться к карте/}).click();
   assert(await page.getByLabel('Результаты прохождения',{exact:true}).innerText()===result,'Preview cancellation replaced the previous result');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows viewport');
   assert(!errors.length,errors.join('\n'));
   console.log(JSON.stringify({width,[fallback?'pointerLockFallback':touch?'touchTraversal':'keyboardTraversal']:'passed',preservedResult:'passed',layout:'passed'}));
  }catch(e){console.error({errors,body:(await page.locator('body').innerText()).slice(-4000)});await page.screenshot({path:`test-results/main-repair-error-${width}.png`,fullPage:true});throw e;}
  finally{await page.close();}
 }
}finally{await browser.close();}
