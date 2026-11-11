import {chromium} from 'playwright';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(Bun.argv[2]??'../migrated-library'),base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1422';
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
await mkdir('test-results',{recursive:true});
try{
 for(const width of [1440,412]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('button',{name:'Библиотека',exact:true}).click();
  const panel=page.getByRole('region',{name:'Общая библиотека'});
  await panel.getByRole('heading',{name:`Лабиринты · ${manifest.mazes}`,exact:true}).waitFor();
  await panel.getByRole('heading',{name:`Прохождения · ${manifest.walks}`,exact:true}).waitFor();
  const list=await (await page.request.get(base+'/api/mazes')).json();
  for(const from of [2,4,'framed-halls']){
   const hall=manifest.mapping.find((m:any)=>m.oldId==='cdba4e7fd05997cfb29dfd17');
   const ids=new Set(manifest.mapping.filter((r:any)=>r.from===from&&r.to===5).map((r:any)=>r.newId));
   const row=from==='framed-halls'?list.mazes.find((r:any)=>r.id===hall?.newId):list.mazes.filter((r:any)=>ids.has(r.id)&&r.modules>=20).sort((a:any,b:any)=>a.modules-b.modules)[0];
   if(!row)throw Error('Missing converted map version '+from);
   await panel.getByRole('button',{name:'Открыть лабиринт '+row.title,exact:true}).first().click();
   await panel.waitFor({state:'hidden'});
   await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).waitFor();
   const count=await page.getByLabel('Количество модулей',{exact:true}).textContent();
   if(Number(count!.match(/\d+/)![0])!==row.modules)throw Error('Construction module count changed');
   await page.getByLabel('Кратчайший путь',{exact:true}).check();
   await page.screenshot({path:`test-results/migrated-v${from}-${width}.png`,fullPage:true});
   console.log(JSON.stringify({width,map:from,loaded:true}));
   await page.getByRole('button',{name:'Библиотека',exact:true}).click();
  }
  const files=await readdir(join(root,'backup','0','walks'));let historical:string|undefined;
  for(const f of files){const row=JSON.parse(await readFile(join(root,'backup','0','walks',f),'utf8'));if(row.walk.maze.version<4&&row.walk.recording.samples.length>5){historical=row.id;break;}}
  if(!historical)throw Error('Missing historical recording');
  await panel.getByRole('button',{name:'Открыть прохождение '+historical,exact:true}).click();
  await panel.waitFor({state:'hidden'});
  await page.getByText('Прохождение открыто из общей библиотеки.',{exact:true}).waitFor();
  await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).waitFor();
  await page.screenshot({path:`test-results/migrated-recording-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Библиотека',exact:true}).click();
  const row=list.mazes.filter((r:any)=>manifest.mapping.some((m:any)=>m.newId===r.id&&m.from===2)&&r.modules>=20).sort((a:any,b:any)=>a.modules-b.modules)[0];
  await panel.getByRole('button',{name:'Пройти вслепую '+row.title,exact:true}).first().click();
  await page.getByRole('button',{name:/Начать прохождение/}).waitFor();
  await page.getByRole('button',{name:/Вернуться к карте/}).click();
  await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();
  await page.getByRole('button',{name:'Перестроить стены',exact:true}).click();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Экспорт черновика',exact:true}).click();
  const draft=JSON.parse(await readFile((await (await downloaded).path())!,'utf8'));
  if(draft.layout.preservedPanels!==undefined||draft.layout.preservedSupports!==undefined)throw Error('Rebuild retained imported construction');
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({width,mazes:manifest.mazes,walks:manifest.walks,gridToFree:true,corridorToFree:true,framedHalls:true,historicalRecording:historical,blindPreview:true,rebuild:true,pageErrors:errors}));
  await page.close();
 }
}finally{await browser.close();}
