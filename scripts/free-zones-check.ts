/** Public browser flow: blind generation, real 3D, JSON, editor and analysis. */
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1420',assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
await mkdir('test-results',{recursive:true});
try{for(const width of [1440,412]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 // Deliberately slow preparation to expose the formerly visible future map.
 await page.route('**/api/**',async route=>{if(route.request().url().includes('prepare'))await new Promise(resolve=>setTimeout(resolve,700));await route.fulfill({status:503,body:'offline'});});
 await page.goto(base+'/?preset=free-zones&blind=1');
 await page.locator('.blind-preparing').waitFor();
 await page.evaluate(()=>{(window as any).__blindLeaks=0;const tick=()=>{const cover=document.querySelector('.blind-preparing'),walk=document.querySelector('.walk-canvas');if(cover&&!walk){const c=document.querySelector('.map-canvas')?.getBoundingClientRect();if(c&&document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)?.classList.contains('map-canvas'))(window as any).__blindLeaks++;}if(cover)requestAnimationFrame(tick);};tick();});
 await page.locator('.walk-canvas').waitFor({timeout:45000});await page.locator('.blind-preparing').waitFor({state:'detached'});
 assert(await page.evaluate(()=>(window as any).__blindLeaks)===0,'Future map flashed before blind walk');
 await page.screenshot({path:`test-results/free-zones-blind-${width}.png`});
 await page.getByRole('button',{name:'← Вернуться к карте',exact:true}).click();
 await page.getByText(/Зон: 3 · замкнутых островов: 3/).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить',exact:true}).click();const wire=JSON.parse(await readFile((await (await download).path())!,'utf8'));
 assert(wire.version===7&&wire.layout.zones.length===3&&wire.layout.bridges.length===2,'Incomplete zone map');assert(wire.roof===true,'Blind walk lost roof');
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Открыть',exact:true}).click();await (await picker).setFiles({name:'zones.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(wire))});await page.getByText('Лабиринт загружен. Топология восстановлена из файла.',{exact:true}).waitFor();
 await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();assert(await page.getByLabel('Зоны',{exact:true}).inputValue()==='3','Editor lost zones');await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
 await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).uncheck();
 await page.getByRole('button',{name:'Проанализировать',exact:true}).click();await page.getByLabel('Метрики колдспотов',{exact:true}).waitFor({timeout:60000});await page.getByLabel('Использование мостов',{exact:true}).waitFor();
 assert(errors.length===0,errors.join('\n'));console.log(`zones browser ${width}: blind generation, roof, v7 round trip, editor, analysis passed`);await page.close();
}}finally{await browser.close();}
