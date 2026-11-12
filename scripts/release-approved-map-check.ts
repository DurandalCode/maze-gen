/** Short production check; use a server with its own MAZE_DATA_DIR. */
import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deserialize,serialize} from '../src/persistence/maze-json';
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1425',out=resolve(process.env.MAZE_OUTPUT_DIR??'test-results');
const example=resolve('examples/maps/approved-vortex-hybrid09.json'),raw=await readFile(example,'utf8');
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const download=async(name:string)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await (await pending).path())!,'utf8');};
await mkdir(out,{recursive:true});
try{
 await page.route('**/api/walks',route=>route.request().method()==='POST'?route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'release-browser-smoke'})}):route.continue());
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByLabel('Тип лабиринта',{exact:true}).selectOption('classical');
 await page.getByLabel('Столбцы',{exact:true}).fill('5');await page.getByLabel('Строки',{exact:true}).fill('5');
 await page.getByLabel('Дополнительные соединения',{exact:true}).fill('2');await page.locator('.seed-input input').fill('release-classical');
 await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
 await page.getByText('Лабиринт сгенерирован. Seed сохранён.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Лабиринт',exact:true}).click();
 const generated=deserialize(await download('Сохранить'));if(generated.parameters.columns!==5||(generated.parameters.generationType??'classical')!=='classical')throw Error('Ordinary generation failed');
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Открыть',exact:true}).click();await (await picker).setFiles(example);
 await page.getByText('Лабиринт загружен. Топология восстановлена из файла.',{exact:true}).waitFor();
 await page.getByLabel('Количество модулей',{exact:true}).getByText('96',{exact:true}).waitFor();
 if(serialize(deserialize(await download('Сохранить')))!==raw)throw Error('Historical example changed during browser import/export');
 const posted=page.waitForResponse(r=>r.url().endsWith('/api/mazes')&&r.request().method()==='POST');await page.getByRole('button',{name:'В библиотеку',exact:true}).click();
 const reply=await posted,record=await reply.json();if(!reply.ok()||record.id!=='5acfbf0115ba3765582b24f5')throw Error('Clean library import changed the historical ID');
 await page.getByRole('button',{name:'Библиотека',exact:true}).click();await page.getByRole('heading',{name:'Общая библиотека',exact:true}).waitFor();await page.getByLabel('Закрыть библиотеку',{exact:true}).click();
 await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();
 await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
 if(!await page.getByLabel('Глубокий возврат · 3 витка · 8/64 м',{exact:true}).isChecked())throw Error('Editor lost the explicit deep64 profile');
 await page.getByLabel('Выбрать объект',{exact:true}).selectOption('spiral0-0');await page.getByLabel('X, м',{exact:true}).fill('1000');
 if(!await page.getByRole('button',{name:'Сохранить карту',exact:true}).isDisabled())throw Error('Invalid geometry stayed saveable');
 await page.getByRole('button',{name:'Отменить правку',exact:true}).click();await page.getByText('Связность, пролёты, проёмы и физическая проходимость проверены.',{exact:true}).waitFor();
 if(serialize(deserialize(await download('Сохранить карту')))!==raw)throw Error('Undo/editor export changed the approved map');
 await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).uncheck();
 const start=performance.now();await page.getByLabel('Ловушки на карте',{exact:true}).check();await page.getByLabel('Выбрать ловушку',{exact:true}).waitFor();const seconds=(performance.now()-start)/1000;
 const labels=await page.getByLabel('Выбрать ловушку',{exact:true}).locator('option').allTextContents();if(!['Л1','Л2','К1','К2'].every(k=>labels.includes(k)))throw Error('Basic overlay lost approved traps');
 await page.getByRole('button',{name:/Пройти от первого лица/}).click();await page.getByLabel('Управление двумя джойстиками').check();await page.getByRole('button',{name:/Начать прохождение/}).click();
 await page.locator('.touch-stick-move .front').waitFor();const zone=(await page.getByLabel('Левый джойстик: движение').boundingBox())!;
 await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2);await page.mouse.down();await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2-45,{steps:6});await page.waitForTimeout(700);await page.mouse.up();const hud=await page.locator('.walk-hud').innerText();
 await page.getByRole('button',{name:/Пауза/}).click();await page.getByRole('button',{name:/Вернуться к карте/}).click();
 if(errors.length)throw Error(errors.join('\n'));
 await page.screenshot({path:resolve(out,'release-approved-map.png'),fullPage:true});console.log(JSON.stringify({ordinaryGeneration:'passed',exactExampleJSON:'passed',cleanLibraryId:record.id,editorUndo:'passed',deep64:'passed',basicOverlaySeconds:seconds,labels,movement:hud,pause:'passed',errors}));
}catch(error){console.error((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:resolve(out,'release-approved-map-error.png'),fullPage:true});throw error;}
finally{await browser.close();}
