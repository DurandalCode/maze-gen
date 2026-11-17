/** Direct renderer comparison on the actual shipped maps. Isolated Vite page;
 * no library/API, simulations, data writes or reduced rendering settings. */
import{createServer}from'vite';import{chromium}from'playwright';import{mkdir,writeFile}from'node:fs/promises';import{resolve}from'node:path';import{createServer as reservePort}from'node:net';
const reservation=reservePort();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
const server=await createServer({server:{host:'127.0.0.1',port,hmr:false},appType:'mpa',plugins:[{name:'isolated-render-page',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/__render-performance'){next();return;}res.setHeader('Content-Type','text/html');res.end('<canvas id="before" style="width:1280px;height:724px"></canvas><canvas id="after" style="width:1280px;height:724px"></canvas>');});}}]});await server.listen();
const browser=await chromium.launch({executablePath:process.env.MAZE_BROWSER??'/Applications/Yandex.app/Contents/MacOS/Yandex',headless:true,args:['--enable-unsafe-swiftshader',...(process.env.MAZE_SOFTWARE?['--use-gl=angle','--use-angle=swiftshader']:[])]});
try{const page=await browser.newPage({viewport:{width:1280,height:724}});await page.goto(server.resolvedUrls!.local[0]!+'__render-performance');
 const results=await page.evaluate(async(selected:string)=>{
  // Vite transforms these imports in the browser, keeping production rendering code intact.
  const load=(path:string)=>import(/* @vite-ignore */path);
  const[{WalkScene},{deserialize},{routePoints},{bridgeGeometry}]=await Promise.all([load('/src/renderer/scene.ts'),load('/src/persistence/maze-json.ts'),load('/src/core/pathfinding.ts'),load('/src/free/bridges.ts')]);
  const manifest=await(await fetch('/examples/bundles/distribution-v2/manifest.json')).json(),results=[];
  const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
  for(const row of manifest.maps.slice(2).filter((row:any)=>!selected||row.file===selected)){
   const maze=deserialize(await(await fetch('/examples/bundles/distribution-v2/'+row.file)).text()),a=new WalkScene(document.querySelector('#before')!,false),b=new WalkScene(document.querySelector('#after')!),start=performance.now();a.setMaze(maze);const beforeConstruction=performance.now()-start,startB=performance.now();b.setMaze(maze);const afterConstruction=performance.now()-startB,ra=(a as any).renderer,rb=(b as any).renderer;
   ra.shadowMap.autoUpdate=true;ra.info.autoReset=rb.info.autoReset=false;
   const points=routePoints(maze),poses=[{name:'interior-turn',p:points[Math.floor(points.length/2)],move:false},{name:'interior-walk',p:points[Math.floor(points.length/3)],move:true}];
   if(maze.free.bridges?.length)poses.push({name:'bridge-deck-turn',p:bridgeGeometry(maze.free,maze.free.bridges[0]).at(.5),move:false});
   const runs=[];let unequalPixels=0;
   for(const pose of poses){const framesA:any[]=[],framesB:any[]=[];for(let i=0;i<24;i++){
    // Walk a short fraction of one real reference segment; no collision cost is included.
    const index=Math.max(0,points.indexOf(pose.p)),next=points[index+1]??pose.p,dx=next.x-pose.p.x,dz=next.z-pose.p.z,length=Math.hypot(dx,dz)||1,walk=pose.move?Math.min(length*.8,i*.04):0;
    const player={position:{x:pose.p.x+dx/length*walk,z:pose.p.z+dz/length*walk,y:pose.p.y??0},pitch:0,yaw:.6+Math.sin(i/8)};
    for(const[scene,renderer,frames]of[[a,ra,framesA],[b,rb,framesB]]as any){renderer.info.reset();const t=performance.now();scene.render(player);renderer.getContext().finish();if(i>=4)frames.push({ms:performance.now()-t,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});}
    if(i===12){const size={x:ra.domElement.width,y:ra.domElement.height},pixelsA=new Uint8Array(size.x*size.y*4),pixelsB=new Uint8Array(pixelsA.length);ra.getContext().readPixels(0,0,size.x,size.y,ra.getContext().RGBA,ra.getContext().UNSIGNED_BYTE,pixelsA);rb.getContext().readPixels(0,0,size.x,size.y,rb.getContext().RGBA,rb.getContext().UNSIGNED_BYTE,pixelsB);for(let j=0;j<pixelsA.length;j++)if(pixelsA[j]!==pixelsB[j])unequalPixels++;}
    await new Promise(requestAnimationFrame);
   }
   const summary=(frames:any[])=>({submissionMedianMs:percentile(frames.map(f=>f.ms),.5),submissionP95Ms:percentile(frames.map(f=>f.ms),.95),meanCalls:frames.reduce((s,f)=>s+f.calls,0)/frames.length,meanTriangles:frames.reduce((s,f)=>s+f.triangles,0)/frames.length});runs.push({pose:pose.name,before:summary(framesA),after:summary(framesB)});}
   let invalidations=0;(b as any).shadowRegion.invalidate=()=>invalidations++;a.dispose();b.dispose();b.canvas.dispatchEvent(new Event('webglcontextrestored'));if(invalidations)throw Error('Disposed scene retained context listener');
   if(unequalPixels)throw Error('Shadow reuse changed rendered pixels: '+row.file+' '+unequalPixels);
   const gl=ra.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');results.push({file:row.file,device:debug?{vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)}:null,constructionMs:{before:beforeConstruction,after:afterConstruction},runs,unequalPixelChannels:unequalPixels,disposedMemory:{before:{...ra.info.memory},after:{...rb.info.memory}},contextListenerRemoved:true});
  }return results;
 },process.env.MAZE_RENDER_MAP??'');const output=process.env.MAZE_OUTPUT_DIR??'test-results';await mkdir(output,{recursive:true});await writeFile(resolve(output,'free-render-performance.json'),JSON.stringify({viewport:[1280,724],software:!!process.env.MAZE_SOFTWARE,devicePixelRatio:1,baseline:'whole-maze opaque instances and legacy shadowMap.autoUpdate=true',cache:'production shadow-region cache and spatial opaque instances',limits:'Renderer submission CPU (including gl.finish), NOT GPU/present/FPS timing. No collision/React/recording time. Use visible RAF app profiling on actual Windows/WebView2 for frame rate.',results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await server.close();}
