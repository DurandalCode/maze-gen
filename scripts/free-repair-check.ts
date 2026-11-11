/** Exercise the repaired geometry through the actual free editor UI. */
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {emptyLayout,type FreeDraft} from '../src/free/model';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
await mkdir('test-results',{recursive:true});
try{
 for(const width of [1440,412]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   const layout=emptyLayout();
   layout.modules=[{id:'a',type:'2x2',x:10,z:10,angle:0},{id:'b',type:'2x2',x:14,z:10,angle:0}];
   layout.connections=[{id:'link',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4}];
   layout.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];
   layout.entrance='in';layout.exit='out';
   layout.walls=[{id:'blocked-entry',x1:9.01,z1:9,x2:9.01,z2:11}];
   const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:30,rows:30,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'backtracker',seed:'repair-ui'},construction:{...DEFAULT_CONSTRUCTION},layout};
   await page.goto(process.env.MAZE_TEST_URL??'http://127.0.0.1:1420');
   await page.getByRole('button',{name:'Создать свободную копию',exact:true}).click();
   const upload=async(d:FreeDraft)=>page.getByLabel('Импорт JSON',{exact:true}).setInputFiles({name:'repair.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});
   await upload(draft);
   await page.getByRole('button',{name:'Нет прохода с учётом радиуса игрока, стен и стоек.',exact:true}).waitFor();
   if(!await page.getByRole('button',{name:'Сохранить карту',exact:true}).isDisabled())throw Error('Blocked map can be published');
   if(!await page.getByRole('button',{name:'Пройти от первого лица',exact:true}).isDisabled())throw Error('Blocked map can be walked');
   await page.getByLabel('Выбрать объект',{exact:true}).selectOption('blocked-entry');
   await page.getByRole('button',{name:'Удалить выбранное',exact:true}).click();
   await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
   // The hall is physically valid even though its average vertex position is outside.
   draft.layout.walls=[];draft.layout.modules=draft.layout.modules.slice(0,1);
   draft.layout.spaces=[{id:'hall',kind:'hall',polygon:[{x:13,z:9},{x:19,z:9},{x:19,z:11},{x:15,z:11},{x:15,z:15},{x:13,z:15}]}];
   draft.layout.connections[0]!.b={room:'hall',edge:5,offset:2};
   draft.layout.openings[1]={id:'out',room:'hall',edge:1,offset:0,width:1.4};
   draft.layout.supports=[{x:16,z:9},{x:17,z:11},{x:15,z:13},{x:13,z:12}];
   await upload(draft);
   await page.getByLabel('Выбрать объект',{exact:true}).selectOption('hall');
   await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
   if(!await page.getByRole('button',{name:'Пройти от первого лица',exact:true}).isEnabled())throw Error('Valid concave hall remains blocked');
   await page.screenshot({path:`test-results/free-concave-repaired-${width}.png`,fullPage:true});
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить карту',exact:true}).click();
   const path=(await (await pending).path())!;
   // Re-import the saved v5 map through the same UI, including derived navigation.
   await page.getByLabel('Импорт JSON',{exact:true}).setInputFiles(path);
   await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Пройти от первого лица',exact:true}).click();
   await page.getByRole('button',{name:/Начать прохождение/}).waitFor();
   await page.getByRole('button',{name:/Вернуться к карте/}).click();
   await page.getByLabel('Проверка конструкции',{exact:true}).waitFor();
   if(errors.length)throw Error(errors.join('\n'));
   console.log(JSON.stringify({width,blockedPortal:'passed',removeWall:'passed',concaveHall:'passed',v5Roundtrip:'passed',walkPreview:'passed'}));
  }catch(e){await page.screenshot({path:`test-results/free-repair-error-${width}.png`,fullPage:true});console.error(errors);throw e;}
  finally{await page.close();}
 }
}finally{await browser.close();}
