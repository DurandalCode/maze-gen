import { fileURLToPath } from 'node:url';
import type { Plugin,ViteDevServer,PreviewServer } from 'vite';
import { createFileApi } from './api';
import { FileStore } from './store';
import { WALK_LIMIT } from '../src/persistence/walk-json';

export const dataDirectory=()=>process.env.MAZE_DATA_DIR??fileURLToPath(new URL('../.local-data/',import.meta.url));
export function fileLibraryPlugin():Plugin {
  const api=createFileApi(new FileStore(dataDirectory()));
  const configure=(server:ViteDevServer|PreviewServer)=>{
    server.middlewares.use(async(req,res,next)=> {
      if(!req.url?.startsWith('/api/')){next();return;}
      try {
        const chunks:Buffer[]=[];let bytes=0;
        for await(const chunk of req) {
          const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=value.length;
          if(bytes>WALK_LIMIT){res.statusCode=413;res.end(JSON.stringify({error:'Слишком большой файл.'}));return;}chunks.push(value);
        }
        const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
        const body=chunks.length?Buffer.concat(chunks).toString('utf8'):undefined;
        const request=new Request(`http://${req.headers.host??'127.0.0.1:1420'}${req.url}`,{method:req.method,headers,...(req.method==='POST'?{body}: {})});
        const response=await api(request);
        if(!response){next();return;}
        res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.end(await response.text());
      }catch{res.statusCode=500;res.end(JSON.stringify({error:'Ошибка файлового сервера.'}));}
    });
  };
  return {name:'maze-file-library',configureServer:configure,configurePreviewServer:configure};
}
