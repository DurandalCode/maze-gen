/** Isolated production verification: no real library or player recording is changed. */
import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{resolve,join,relative,extname}from'node:path';import{FileStore}from'../server/store';import{createFileApi}from'../server/api';
const root=await mkdtemp(join(tmpdir(),'maze-release-ending-')),api=createFileApi(new FileStore(root)),dist=resolve('dist');
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){const reply=await api(request);if(reply)return reply;const path=resolve(dist,'.'+new URL(request.url).pathname);if(relative(dist,path).startsWith('..'))return new Response('Not found',{status:404});let file=Bun.file(path);if(!await file.exists()){if(extname(path))return new Response('Not found',{status:404});file=Bun.file(resolve(dist,'index.html'));}return new Response(file);}});
process.env.MAZE_TEST_URL=server.url.toString().replace(/\/$/,'');process.env.MAZE_MARKER_MAP=resolve('examples/maps/approved-vortex-ending-ring.json');
try{await import('./direction-markers-check');}finally{server.stop(true);await rm(root,{recursive:true,force:true});}
