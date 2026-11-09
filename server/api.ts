import type { FileStore } from './store';
import { WALK_LIMIT } from '../src/persistence/walk-json';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export function createFileApi(store:FileStore) {
  return async(request:Request):Promise<Response|null>=> {
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/api/'))return null;
    const origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return json({error:'Запрос разрешён только с этого приложения.'},403);
    try {
      if(request.method==='GET') {
        if(path==='/api/health')return json({ok:true,storage:'files'});
        if(path==='/api/mazes')return json({mazes:await store.listMazes()});
        if(path==='/api/walks')return json({walks:await store.listWalks()});
        const match=path.match(/^\/api\/(mazes|walks)\/([a-zA-Z0-9_-]{1,80})$/);
        if(match) {
          const row=match[1]==='mazes'?await store.getMaze(match[2]!):await store.getWalk(match[2]!);
          return row?json(row):json({error:'Запись не найдена.'},404);
        }
      } else if(request.method==='POST'&&(path==='/api/mazes'||path==='/api/walks'||path==='/api/prepare-walk')) {
        if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Нужен JSON.'},415);
        const limit=path==='/api/walks'?WALK_LIMIT:5_000_000;
        if(Number(request.headers.get('content-length'))>limit)return json({error:'Слишком большой файл.'},413);
        const text=await request.text();if(new TextEncoder().encode(text).length>limit)return json({error:'Слишком большой файл.'},413);
        const value=JSON.parse(text);
        if(path==='/api/prepare-walk')return json(await store.prepareWalk(value.maze));
        if(path==='/api/mazes')return json(await store.saveMaze(value.maze,value.title),201);
        const saved=await store.saveWalk(value);
        return json({id:saved.id,mazeId:saved.mazeId,updatedAt:saved.updatedAt,assessment:saved.assessment},201);
      }
      return json({error:'Неизвестный адрес или метод.'},404);
    }catch(error) {
      if(error instanceof SyntaxError)return json({error:'Некорректный JSON.'},400);
      if((error as NodeJS.ErrnoException).code)return json({error:'Не удалось прочитать или сохранить файлы библиотеки.'},500);
      return json({error:error instanceof Error?error.message:'Некорректные данные.'},400);
    }
  };
}
