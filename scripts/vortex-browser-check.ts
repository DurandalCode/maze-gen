import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('test-results',{recursive:true});
try{
 await page.route('**/api/walks',route=>route.request().method()==='POST'?route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'vortex-browser-smoke'})}):route.continue());
 await page.goto(`http://127.0.0.1:1423/?maze=${process.env.MAZE_GEOMETRY_ID??'b59909aab73104c49ed461bc'}&blind=1`);
 await page.getByLabel('Управление двумя джойстиками').check({timeout:20000});await page.getByRole('button',{name:/Начать прохождение/}).click();
 await page.locator('.touch-stick-move .front').waitFor();const zone=(await page.getByLabel('Левый джойстик: движение').boundingBox())!;
 await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2);await page.mouse.down();await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2-45,{steps:6});await page.waitForTimeout(700);await page.mouse.up();
 const hud=await page.locator('.walk-hud').innerText();await page.getByRole('button',{name:/Пауза/}).click();await page.getByRole('button',{name:/Вернуться к карте/}).click();
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByLabel('Рисунок свободной планировки',{exact:true}).selectOption('vortex');
 await page.locator('.seed-input input').fill('vortex-01');await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.getAttribute('aria-label')==='Сгенерировать'&&!b.disabled),null,{timeout:20000});
 await page.getByRole('button',{name:'Лабиринт',exact:true}).click();await page.screenshot({path:'test-results/vortex-map.png',fullPage:true});
 await page.getByLabel('Редактор свободного размещения',{exact:true}).check();if(await page.getByLabel('Рисунок свободной планировки',{exact:true}).inputValue()!=='vortex')throw Error('Editor lost vortex settings');
 if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({playableLoad:'passed',joystickMovement:hud,pause:'passed',vortexOption:'passed',errors}));
}catch(e){console.error((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:'test-results/vortex-error.png',fullPage:true});throw e;}finally{await browser.close();}
