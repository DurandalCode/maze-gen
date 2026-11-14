import {chromium} from 'playwright';
import {strict as assert} from 'node:assert';
import {resolve} from 'node:path';

const cdp=process.env.MAZE_CDP_URL;
const embeddedOnly=Bun.argv.includes('--embedded-only');
const browser=cdp?await chromium.connectOverCDP(cdp):await chromium.launch({
 executablePath:process.env.MAZE_BROWSER??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
 args:['--enable-unsafe-swiftshader']});
const context=cdp?browser.contexts()[0]!:await browser.newContext();
if(!cdp)await context.addInitScript(()=>Object.defineProperty(globalThis,'isTauri',{value:true}));
const page=cdp?(context.pages()[0]??await context.newPage()):await context.newPage();
const errors:string[]=[],requests:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(request.url());});
try{
 if(!cdp)await page.goto(process.env.MAZE_TEST_URL??'http://127.0.0.1:1420/',{waitUntil:'domcontentloaded'});
 assert(await page.evaluate(()=>!!(globalThis as {isTauri?:boolean}).isTauri));
 await page.getByRole('button',{name:'Библиотека',exact:true}).click();
 await page.getByRole('button',{name:'Пройти вслепую 03 · Органический гибрид с дворами',exact:true}).waitFor({timeout:120000});
 assert.equal(await page.getByRole('button',{name:/^Пройти вслепую /}).count(),5);
 if(!embeddedOnly){
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Импортировать записи',exact:true}).click();
  await (await chooser).setFiles(resolve('examples/bundles/distribution-v2/bundle.json'));
  await page.getByText('Импорт: 0 прохождений и 5 карт.',{exact:true}).waitFor({timeout:120000});
 }
 assert.equal(await page.getByRole('button',{name:/^Пройти вслепую /}).count(),5);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Библиотека',exact:true}).click();
 await page.getByRole('button',{name:'Пройти вслепую 03 · Органический гибрид с дворами',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/^Пройти вслепую /}).count(),5);
 await page.getByRole('button',{name:'Пройти вслепую 03 · Органический гибрид с дворами',exact:true}).click();
 const hint=page.getByLabel('Направление выхода',{exact:true});
 await hint.waitFor({timeout:120000});assert.equal(await hint.innerText(),'Выход — к полю');
 await page.screenshot({path:cdp?'test-results/pc-native-start.png':'test-results/pc-bundle-start.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 console.log(JSON.stringify({native:!!cdp,embeddedMaps:5,manualImportTested:!embeddedOnly,persistedAfterReload:5,walkStart:true,noHttpApi:true,errors}));
}finally{await browser.close();}
