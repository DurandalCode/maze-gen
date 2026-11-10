/** Focused browser regression: configure both floors without leaving Settings. */
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1457';
await mkdir('test-results',{recursive:true});
try{
 for(const width of [1280,412]){
  const page=await browser.newPage({viewport:{width,height:915}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(base);
   await page.getByRole('button',{name:'Настройки',exact:true}).click();
   await page.getByLabel('Столбцы',{exact:true}).fill('5');await page.getByLabel('Строки',{exact:true}).fill('5');
   await page.locator('.seed-input input').fill('two-test');
   await page.getByLabel('Тип лабиринта',{exact:true}).selectOption('two-storey');
   const floor=page.getByLabel('Редактируемый этаж',{exact:true});await floor.selectOption('1');
   await page.getByRole('button',{name:'Редактировать форму',exact:true}).click();
   await page.getByLabel('Прямоугольники',{exact:true}).selectOption('0');
   await page.getByLabel('Прямоугольник: width',{exact:true}).fill('4');
   await floor.selectOption('0');
   if(await page.getByLabel('Форма',{exact:true}).inputValue()!=='rectangle')throw Error('Upper editing changed lower shape');
   await floor.selectOption('1');await page.getByLabel('Прямоугольники',{exact:true}).selectOption('0');
   if(await page.getByLabel('Прямоугольник: width',{exact:true}).inputValue()!=='4')throw Error('Upper draft was lost');
   if(!await page.locator('.app-shell').evaluate(e=>e.classList.contains('settings-open')))throw Error('Editing left Settings');
   // Observe the real map delivered by the UI; no production test hook is needed.
   await page.evaluate(async()=>{
    const {MapView}=await import('/src/ui/map-view.ts'),draw=MapView.prototype.draw;
    MapView.prototype.draw=function(){const maze=(this as any).maze;if(maze?.version===6)(window as any).__generationUx=maze.parameters;return draw.call(this);};
   });
   await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
   await page.waitForFunction(()=>!!(window as any).__generationUx,{},{timeout:30000});
   const p=await page.evaluate(()=>(window as any).__generationUx);
   if(p.columns!==5||p.rows!==5||p.shape!==undefined||p.upperShape.rectangles[0].width!==4)throw Error('Generated wrong floor shapes');
   if(!await page.locator('.app-shell').evaluate(e=>e.classList.contains('settings-open')))throw Error('Generation unexpectedly left Settings');
   await floor.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/generation-settings-${width}.png`});
   await page.getByRole('button',{name:'Лабиринт',exact:true}).click();
   await page.getByRole('button',{name:'Этаж 2',exact:true}).click();
   const positions=await page.evaluate(()=>{const nav=document.querySelector('nav.workspace-tabs')!,floors=document.querySelector('.floor-tabs')!;const a=nav.getBoundingClientRect(),b=floors.getBoundingClientRect();return {floorPosition:getComputedStyle(floors).position,overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top};});
   if(positions.floorPosition==='fixed'||positions.overlap)throw Error('Floor selection overlaps application navigation');
   await page.getByRole('button',{name:'Настройки',exact:true}).click();
   if(await floor.inputValue()!=='1')throw Error('Floor selection reset across sections');
   if(errors.length)throw Error(errors.join('\n'));
   console.log(JSON.stringify({width,settingsGeneration:'passed',separateFloorShapes:'passed',navigation:'passed'}));
  }finally{await page.close();}
 }
}finally{await browser.close();}
