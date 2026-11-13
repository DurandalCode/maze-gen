import {chromium} from 'playwright';
import {generate} from '../src/generators/generate';
import {deserialize} from '../src/persistence/maze-json';
import {validateWalk} from '../src/persistence/walk-json';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1428',out=process.env.MAZE_OUTPUT_DIR??'test-results';
const maze=process.env.MAZE_MARKER_MAP?deserialize(await readFile(process.env.MAZE_MARKER_MAP,'utf8')):generate({columns:4,rows:4,corridorWidth:2,extraConnections:1,algorithm:'prim',seed:'direction-marker-browser'});
maze.roof=true;
const saved=await (await fetch(base+'/api/mazes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({maze,title:'F · проверка направления'})})).json() as {id:string};
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base+'/?maze='+saved.id);await page.getByRole('button',{name:/Пройти от первого лица/}).click();
 await page.getByLabel('Управление двумя джойстиками').check();await page.getByRole('button',{name:/Начать прохождение/}).click();
 const stick=page.getByLabel('Правый джойстик: обзор',{exact:true});await stick.locator('.front').waitFor();const box=(await stick.boundingBox())!;await page.keyboard.press('KeyF');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2);await page.waitForTimeout(500);await page.mouse.up();
 await page.keyboard.press('KeyF');await page.getByRole('status').filter({hasText:'Направление предполагаемого выхода записано'}).waitFor();
 await page.keyboard.down('KeyF');await page.keyboard.down('KeyF');await page.keyboard.up('KeyF');
 // One pre-turn press, one post-turn press and one ordinary press; the extra keydown is repeat.
 await page.getByRole('button',{name:'Ⅱ Пауза',exact:true}).click();await page.keyboard.press('KeyF');await page.waitForTimeout(250);
 await page.getByRole('button',{name:/Продолжить/}).first().click();await page.waitForTimeout(150);await page.keyboard.press('KeyF');
 const stopped=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/walks')&&JSON.parse(r.request().postData()??'{}').status==='stopped');
 await page.getByRole('button',{name:'← Вернуться к карте',exact:true}).click();if(!(await stopped).ok())throw Error('Stopped recording save failed');
 const panel=page.getByLabel('Метки предполагаемого выхода',{exact:true});await panel.waitFor();
 if(await panel.locator('li').count()!==4)throw Error('Repeat/pause produced wrong marker count');
 await panel.getByLabel('Показывать стрелки меток').uncheck();await panel.getByLabel('Показывать стрелки меток').check();await panel.locator('li button').last().click();
 const list=await (await fetch(base+'/api/walks')).json() as {walks:{id:string;mazeId:string}[]};let walk;
 for(const row of list.walks.filter(row=>row.mazeId===saved.id)){const savedWalk=await (await fetch(base+'/api/walks/'+row.id)).json() as {walk:unknown};const value=validateWalk(savedWalk.walk);if(value.recording.markers?.length===4){walk=value;break;}}
 if(!walk)throw Error('Saved markers missing');if(Math.abs(walk.recording.markers![0]!.yaw-walk.recording.markers![1]!.yaw)<.1)throw Error('Joystick yaw not captured');
 await page.reload();await page.getByRole('button',{name:/Библиотека/}).first().click();await page.getByLabel('Открыть прохождение '+walk.id,{exact:true}).click();await panel.waitFor();
 if(await panel.locator('li').count()!==4)throw Error('Library restore lost markers');if(errors.length)throw Error(errors.join('\n'));
 if(maze.free){await page.getByRole('switch',{name:'Редактор свободного размещения',exact:true}).check();await page.getByLabel('Метки предполагаемого выхода',{exact:true}).waitFor();if(await page.locator('svg g[aria-label^="Метка ощущения выхода"] line').count()===0)throw Error('Free editor arrows missing');}
 await mkdir(out,{recursive:true});await page.screenshot({path:out+'/direction-markers-map.png'});
 const report={url:base+'/?maze='+saved.id,walkId:walk.id,markers:walk.recording.markers,repeatAndPausedIgnored:true,libraryRestore:true,arrowsToggle:true,pageErrors:errors};
 await writeFile(out+'/direction-markers-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
