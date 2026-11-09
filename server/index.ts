import { fileURLToPath } from 'node:url';
import { resolve,relative,extname } from 'node:path';
import { FileStore } from './store';
import { createFileApi } from './api';
const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
const api=createFileApi(new FileStore(process.env.MAZE_DATA_DIR??resolve(root,'.local-data')));
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT??1420),maxRequestBodySize:12_000_000,
  async fetch(request){
    const response=await api(request);if(response)return response;
    if(request.method!=='GET')return new Response('Not found',{status:404});
    const path=resolve(dist,'.'+new URL(request.url).pathname);
    if(relative(dist,path).startsWith('..'))return new Response('Not found',{status:404});
    let file=Bun.file(path);
    if(!await file.exists()) {
      if(extname(path))return new Response('Not found',{status:404});file=Bun.file(resolve(dist,'index.html'));
    }
    if(!await file.exists())return new Response('Run bun run build first.',{status:503});
    return new Response(file);
  }});
console.log(`Maze Lab and shared file library: ${server.url}`);
