/** Isolated production-browser smoke: configure, cancel, generate, export, edit. */
import {chromium} from 'playwright';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '../server/store';
import {createFileApi} from '../server/api';
import {deserialize} from '../src/persistence/maze-json';
import {metrics} from '../src/core/metrics';
import {freeGroundLengths} from '../src/free/path-limits';
const output=process.env.MAZE_OUTPUT_DIR??'test-results';
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'maze-generator-controls-')),api=createFileApi(new FileStore(root));
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.stack??e.message));
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
try{
 await page.route('**/api/**',async route=>{
  const r=route.request(),response=await api(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.method()==='POST'?{body:r.postData()}: {})}));
  if(!response){await route.continue();return;}
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 });
 await page.goto(process.env.MAZE_TEST_URL??'http://127.0.0.1:1422');
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByLabel('Размещение',{exact:true}).selectOption('free');
 await page.getByLabel('Ширина площадки, м',{exact:true}).fill('100');await page.getByLabel('Глубина площадки, м',{exact:true}).fill('100');
 await page.getByLabel('Алгоритм',{exact:true}).selectOption('prim');await page.locator('.seed-input input').fill('ninety-switch-1');
 await page.getByLabel('Рисунок свободной планировки',{exact:true}).selectOption('switchbacks');
 await page.getByLabel('Модулей при генерации, цель',{exact:true}).fill('90');
 await page.getByLabel('Пролёт соединения, м',{exact:true}).fill('3');await page.getByLabel('До связей в промежутках',{exact:true}).fill('2');
 await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
 await page.getByRole('button',{name:'Отменить генерацию',exact:true}).click();
 await page.getByText('Генерация отменена. Текущий лабиринт сохранён.',{exact:true}).waitFor();
 const start=performance.now();await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.generate')?.hasAttribute('disabled'),{},{timeout:30000});
 const generationMs=performance.now()-start;
 await page.getByRole('button',{name:'Лабиринт',exact:true}).click();
 await page.getByRole('heading',{name:'Свободный лабиринт 100 × 100',exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 const wire=await readFile((await (await download).path())!,'utf8'),maze=deserialize(wire),lengths=freeGroundLengths(maze);
 assert(maze.free?.modules.length===90,'UI did not generate the selected inventory');assert(maze.parameters.seed==='ninety-switch-1','UI changed the seed');
 assert(metrics(maze).cycles===4,'UI did not apply infill');assert(lengths.straight<=8+1e-7&&lengths.run<=16+1e-7,'Generated UI geometry violates 8/16 limits');
 await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();
 await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
 assert(await page.getByLabel('Рисунок свободной планировки',{exact:true}).inputValue()==='switchbacks','Editor lost generation pattern');
 assert(await page.getByLabel('Пролёт соединения, м',{exact:true}).inputValue()==='3','Editor lost span');
 assert(await page.getByLabel('До связей в промежутках',{exact:true}).inputValue()==='2','Editor lost infill budget');
 assert(!errors.length,errors.join('\n'));
 const report={cancel:'passed',generation:'passed',generationMs:Math.round(generationMs),modules:maze.free!.modules.length,cycles:metrics(maze).cycles,straight:lengths.straight,run:lengths.run,export:'passed',editor:'passed',pageErrors:errors};
 await writeFile(join(output,'free-generator-controls-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await rm(root,{recursive:true,force:true});}
