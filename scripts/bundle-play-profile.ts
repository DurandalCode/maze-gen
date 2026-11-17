/** Run against a Vite dev server: instrument the actual shared application modules.
 * MAZE_BROWSER selects an installed Chromium; isolated contexts never use live saves. */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.MAZE_TEST_URL??'http://127.0.0.1:1458';
const output=process.env.MAZE_PROFILE_OUTPUT??'test-results/bundle-play-profile.json';
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER,headless:true,args:['--enable-unsafe-swiftshader',...(process.env.MAZE_SOFTWARE_GL==='1'?['--use-gl=angle','--use-angle=swiftshader']:[])]});
const results:any[]=[];
try{
 for(const title of ['03 · Органический гибрид с дворами','04 · Гибридный вортекс','05 · Мостовой'].filter(title=>!process.env.MAZE_MAPS||process.env.MAZE_MAPS.split(',').includes(title.slice(0,2)))){
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:Number(process.env.MAZE_DEVICE_SCALE??1)});
  await context.addInitScript(()=>Object.defineProperty(globalThis,'isTauri',{value:true}));
  const page=await context.newPage(),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
   const load=new Function('p','return import(p)');
   const [{Player},{WalkScene}]=await Promise.all([load('/src/simulation/player.ts'),load('/src/renderer/scene.ts')]);
   const state=(window as any).__playProfile={frames:[],moves:[],render:[],calls:[],last:0,enabled:false};
   const move=Player.prototype.updateAnalog;
   Player.prototype.updateAnalog=function(...args:any[]){state.player=this;const t=performance.now();const value=move.apply(this,args);if(state.enabled)state.moves.push(performance.now()-t);return value;};
   const render=WalkScene.prototype.render;
   WalkScene.prototype.render=function(...args:any[]){state.scene=this;const t=performance.now();const drawArgs=state.cameraPosition?[{...args[0],position:state.cameraPosition}]:args;const value=render.apply(this,drawArgs);if(state.enabled){state.render.push(performance.now()-t);state.calls.push(this.renderer.info.render.calls);if(state.last)state.frames.push(t-state.last);state.last=t;}return value;};
  });
  await page.getByRole('button',{name:'Библиотека',exact:true}).click();
  const t=Date.now();
  await page.getByRole('button',{name:'Пройти вслепую '+title,exact:true}).click();
  if(process.env.MAZE_LOW_GRAPHICS==='1')await page.getByLabel('Сниженная нагрузка на графику',{exact:true}).check();
  await page.getByLabel('Управление двумя джойстиками').check();
  await page.getByRole('button',{name:/Начать прохождение/}).click();
  const right=page.getByLabel('Правый джойстик: обзор',{exact:true});
  await right.locator('.front').waitFor();
  const startupMs=Date.now()-t;
  await page.waitForTimeout(800);
  const capture=async(name:string,action?:()=>Promise<void>)=>{
   await page.evaluate(()=>{const s=(window as any).__playProfile;for(const k of ['frames','moves','render','calls'])s[k]=[];s.last=0;s.enabled=true;});
   if(action)await action();else await page.waitForTimeout(2200);
   const profile=await page.evaluate(()=>{const s=(window as any).__playProfile;s.enabled=false;const stat=(a:number[])=>{a.sort((a,b)=>a-b);return{count:a.length,mean:a.reduce((s,v)=>s+v,0)/(a.length||1),p50:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0,max:a.at(-1)??0};};return{frameMs:stat(s.frames),movementMs:stat(s.moves),renderMs:stat(s.render),finalOutputPassDrawCalls:stat(s.calls)};});
   return{name,...profile};
  };
  const idle=await capture('idle');
  const rotating=await capture('rotating',async()=>{const b=(await right.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+25,b.y+b.height/2);await page.waitForTimeout(2200);await page.mouse.up();});
  const left=page.getByLabel('Левый джойстик: движение',{exact:true});
  const moving=await capture('moving',async()=>{const b=(await left.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2-25);await page.waitForTimeout(2200);await page.mouse.up();});
  const interiors:any[]=[];
  for(const fraction of [.25,.5,.75]){
   await page.evaluate(async fraction=>{const s=(window as any).__playProfile,load=new Function('p','return import(p)'),{routePoints}=await load('/src/core/pathfinding.ts'),points=routePoints(s.player.maze),index=Math.floor((points.length-2)*fraction),point=points[index],next=points[index+1];s.cameraPosition={...point};s.player.yaw=Math.atan2(-(next.x-point.x),-(next.z-point.z));},fraction);
   interiors.push(await capture('interior-'+fraction,async()=>{const b=(await right.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+25,b.y+b.height/2);await page.waitForTimeout(2200);await page.mouse.up();}));
  }
  await page.keyboard.press('KeyF');
  await page.getByRole('status').filter({hasText:'Направление предполагаемого выхода записано'}).waitFor();
  const device=await page.evaluate(()=>{const renderer=(window as any).__playProfile.scene.renderer,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),pixelRatio:renderer.getPixelRatio(),width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};});
  const result={title,device,reducedGraphics:process.env.MAZE_LOW_GRAPHICS==='1',startupMs,idle,rotating,moving,interiors,fMarker:true,errors};results.push(result);console.log(JSON.stringify(result));
  await context.close();
 }
 await mkdir(output.slice(0,output.lastIndexOf('/'))||'.',{recursive:true});
 await writeFile(output,JSON.stringify({base,renderer:'headless software WebGL; timings are diagnostic, not hardware FPS guarantees',results},null,2));
 if(results.some(r=>r.errors.length))throw Error('Browser page errors');
}finally{await browser.close();}
