import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1420',assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const fixture=await readFile(new URL('../tests/fixtures/free-zones.json',import.meta.url));
await mkdir('test-results',{recursive:true});
try{for(const width of [1440,412]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}));await page.goto(base);
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Открыть',exact:true}).click();await (await picker).setFiles({name:'zones.json',mimeType:'application/json',buffer:fixture});await page.getByText('Лабиринт загружен. Топология восстановлена из файла.',{exact:true}).waitFor();
 await page.evaluate(()=>{(window as any).__ticks=0;setInterval(()=>(window as any).__ticks++,20);});
 const control=page.getByLabel('Критические стены',{exact:true}),status=page.getByLabel('Расчёт критических стен',{exact:true});
 await control.check();await status.getByText('Вычисляем критические стены…',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Приблизить',exact:true}).click();await control.uncheck();await control.check();
 await status.filter({hasText:'Защищённых стен:'}).waitFor({timeout:30000});assert(await page.evaluate(()=>(window as any).__ticks)>3,'Main UI was blocked by critical calculation');
 await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'⇄ Поменять местами',exact:true}).click();await page.getByRole('button',{name:'Лабиринт',exact:true}).click();await control.check();await status.filter({hasText:'Защищённых стен:'}).waitFor({timeout:30000});
 await page.getByLabel('Ловушки на карте',{exact:true}).check();await page.getByLabel('Кратчайший путь',{exact:true}).check();await page.getByRole('button',{name:'Проанализировать',exact:true}).click();await page.getByLabel('Метрики колдспотов',{exact:true}).waitFor({timeout:60000});
 await page.screenshot({path:`test-results/free-grid-audit-${width}.png`,fullPage:true});assert(errors.length===0,errors.join('\n'));console.log(`free grid audit ${width}: worker cancel/restart, responsive UI, reversed portals, traps, route, heat passed`);await page.close();
 }
 // The same asynchronous UI also handles the original grid model.
 const page=await browser.newPage();await page.goto(base);await page.getByLabel('Критические стены',{exact:true}).check();await page.getByLabel('Расчёт критических стен',{exact:true}).filter({hasText:'Защищённых стен:'}).waitFor({timeout:30000});
 console.log('legacy grid critical walls passed');await page.close();
 const failed=await browser.newPage();await failed.route('**/src/analysis/critical-walls-worker.ts*',route=>route.fulfill({contentType:'application/javascript',body:"throw new Error('audit worker failure');"}));await failed.goto(base);await failed.getByLabel('Критические стены',{exact:true}).check();await failed.getByLabel('Расчёт критических стен',{exact:true}).filter({hasText:'Не удалось рассчитать:'}).waitFor();await failed.getByRole('button',{name:'Приблизить',exact:true}).click();await failed.unroute('**/src/analysis/critical-walls-worker.ts*');await failed.getByRole('button',{name:'Повторить расчёт',exact:true}).click();await failed.getByLabel('Расчёт критических стен',{exact:true}).filter({hasText:'Защищённых стен:'}).waitFor({timeout:30000});console.log('worker error and retry preserve application passed');await failed.close();
}finally{await browser.close();}
