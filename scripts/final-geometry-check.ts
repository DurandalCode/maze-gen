/** Production browser roundtrip for a supplied final map, in an isolated API. */
import {chromium,type Page} from 'playwright';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '../server/store';
import {createFileApi} from '../server/api';
import {serialize,deserialize} from '../src/persistence/maze-json';
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1422',id=process.env.MAZE_GEOMETRY_ID;
if(!id)throw Error('Set MAZE_GEOMETRY_ID to the final saved map.');
const response=await fetch(`${base}/api/mazes/${id}`);if(!response.ok)throw Error('Final map is unavailable.');
const source=await response.json() as Awaited<ReturnType<FileStore['saveMaze']>>;
const root=await mkdtemp(join(tmpdir(),'maze-final-geometry-')),store=new FileStore(root),api=createFileApi(store),saved=await store.saveMaze(source.maze,source.title);
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const download=async(p:Page,name:string)=>{const pending=p.waitForEvent('download');await p.getByRole('button',{name,exact:true}).click();return deserialize(await readFile((await (await pending).path())!,'utf8'));};
try{
 await page.route('**/api/**',async route=>{
  const r=route.request(),reply=await api(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.method()==='POST'?{body:r.postData()}: {})}));
  if(!reply){await route.continue();return;}await route.fulfill({status:reply.status,headers:Object.fromEntries(reply.headers),body:await reply.text()});
 });
 await page.goto(`${base}/?maze=${saved.id}`);
 await page.getByLabel('Количество модулей',{exact:true}).filter({hasText:String(source.maze.free!.modules.length)}).waitFor();
 // Regenerate the exact saved recipe through the ordinary form. This proves
 // the bundled entry point, not merely the readability of a scripted card.
 const regenerate=async()=>{await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.generate')?.hasAttribute('disabled'),{},{timeout:45000});await page.getByRole('button',{name:'Лабиринт',exact:true}).click();return download(page,'Сохранить');};
 const exported=await regenerate(),differences:unknown[]=[];let engineDelta=0;
 // Bun/JSC and Chromium/V8 differ by a few ULPs in sin/cos. Require the same
 // full structure and sub-nanometre numeric agreement across engines; require
 // a byte-exact second replay inside the same browser below. Do not quantize
 // production geometry or change existing saved identities to satisfy a test.
 const compare=(a:any,b:any,path:string)=>{if(differences.length>=12||Object.is(a,b))return;if(typeof a==='number'&&typeof b==='number'){engineDelta=Math.max(engineDelta,Math.abs(a-b));if(Math.abs(a-b)<=1e-10)return;}if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[key],b[key],path+'.'+key);}else differences.push({path,expected:a,actual:b});};
 compare(JSON.parse(serialize(source.maze)),JSON.parse(serialize(exported)),'maze');if(differences.length)throw Error('Map export changed final geometry: '+JSON.stringify(differences));
 if(serialize(await regenerate())!==serialize(exported))throw Error('Same-browser seed replay changed the generated map.');
 const posted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/mazes'));
 await page.getByRole('button',{name:'В библиотеку',exact:true}).click();if(!(await posted).ok())throw Error('Library save failed.');
 await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();
 await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
 await page.getByLabel('Выбрать объект',{exact:true}).selectOption(source.maze.free!.modules[0]!.id);
 await page.getByLabel('X, м',{exact:true}).fill('1000');
 if(!await page.getByRole('button',{name:'Сохранить карту',exact:true}).isDisabled())throw Error('Invalid geometry remained saveable.');
 await page.getByRole('button',{name:'Отменить правку',exact:true}).click();
 await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
 const edited=await download(page,'Сохранить карту');if(serialize(edited)!==serialize(exported))throw Error('Undo/editor roundtrip changed geometry.');
 if(errors.length)throw Error(errors.join('\n'));
 const output=process.env.MAZE_OUTPUT_DIR??'test-results';await mkdir(output,{recursive:true});
 const report={id,modules:source.maze.free!.modules.length,moduleConstruction:!!source.maze.free!.moduleConstruction,ordinaryFormReplay:'byte-exact within browser',crossEngineMaximumNumericDelta:engineDelta,mapExport:'passed',librarySave:'passed',invalidEditRejected:'passed',undo:'passed',editorExport:'passed',pageErrors:errors};
 await writeFile(join(output,'final-geometry-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await rm(root,{recursive:true,force:true});}
