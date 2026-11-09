import {FileStore} from '../server/store';
import {validateLibraryExport,LIBRARY_EXPORT_LIMIT} from '../src/persistence/library-export';
const args=Bun.argv.slice(2),check=args.includes('--check'),file=args.find(a=>a!=='--check');
if(!file)throw new Error('Usage: bun scripts/import-library.ts [--check] export.json');
const source=Bun.file(file);if(source.size>LIBRARY_EXPORT_LIMIT)throw new Error('Файл больше 64 МБ.');
const data=validateLibraryExport(await source.json());
if(!check){
 const store=new FileStore(process.env.MAZE_DATA_DIR??'.local-data');
 for(const row of data.mazes)await store.saveMaze(row.maze,row.title);
 for(const walk of data.walks)await store.saveWalk(walk);
}
console.log(JSON.stringify({checked:true,imported:!check,mazes:data.mazes.length,walks:data.walks.length}));
