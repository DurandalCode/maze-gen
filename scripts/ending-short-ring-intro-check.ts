import {chromium} from 'playwright';
import {resolve} from 'node:path';
const base=process.env.MAZE_BASE_URL??'http://127.0.0.1:1428',id=process.env.MAZE_GEOMETRY_ID;if(!id)throw Error('Set MAZE_GEOMETRY_ID');
const before=await(await fetch(base+'/api/walks')).json(),original=await(await fetch(base+'/api/mazes/fe439a2a8187852f5c730a2f')).json(),browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors:string[]=[],walkWrites:string[]=[],prepareRequests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/api\/walks(?:$|\?)/.test(r.url()))walkWrites.push(r.url());if(r.method()==='POST'&&r.url().endsWith('/api/prepare-walk'))prepareRequests.push(r.url());});
 await page.goto(base+'/?maze='+id);await page.locator('.cavity-report summary').waitFor();await page.locator('.map-canvas').screenshot({path:resolve(process.env.ENDING_RING_OUTPUT??'test-results','vortex-f11-short-ring-overview.png')});
 await page.goto(base+'/?maze='+id+'&blind=1');await page.getByRole('button',{name:/Начать прохождение/}).waitFor({timeout:60000});await page.locator('.direction-marker-help').filter({hasText:'F'}).waitFor();if(errors.length||walkWrites.length)throw Error(JSON.stringify({errors,walkWrites}));
 const after=await(await fetch(base+'/api/walks')).json(),originalAfter=await(await fetch(base+'/api/mazes/fe439a2a8187852f5c730a2f')).json();if(JSON.stringify(original.maze)!==JSON.stringify(originalAfter.maze))throw Error('Original saved geometry changed');
 const report={id,url:page.url(),mapOpened:true,intro:'passed',FHelp:'visible',started:false,walkWrites:0,readOnlyPrepareRequests:prepareRequests.length,walkLibraryUnchanged:JSON.stringify(before)===JSON.stringify(after),originalMapUnchanged:true,pageErrors:errors};await Bun.write(resolve(process.env.ENDING_RING_OUTPUT??'test-results','vortex-f11-short-ring-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
