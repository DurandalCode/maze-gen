import {test,expect,afterEach} from 'bun:test';
import {mkdtemp,readFile,readdir,rm,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {migrateLibraries} from '../server/library-migration';
import {FileStore,topologyId} from '../server/store';
import {generate} from '../src/generators/generate';
import {cellCenter,walls} from '../src/core/maze';
import {Recorder} from '../src/simulation/recorder';
import {makeWalkData} from '../src/persistence/walk-json';
import {contentId} from '../src/persistence/identity';
import commute from '../src/data/commute-pack.json';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'maze-migrate-'));roots.push(root);
 const source=join(root,'source'),target=join(root,'result'),store=new FileStore(source);
 const maze=generate({columns:2,rows:2,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'one-off'});
 const saved=await store.saveMaze(maze,'Моя старая карта');
 await store.rejectMaze(saved.id,'Сохранить причину');
 const recording=new Recorder(cellCenter(maze,maze.entrance.cell));
 const walk=makeWalkData(maze,recording,'historical-run',false,'stopped');await store.saveWalk(walk);
 return {root,source,target,store,maze,saved,walk};
}
test('one-off migration preserves source bytes, metadata, physical walls and historical samples; updates all references',async()=>{
 const f=await fixture(),sourceFile=join(f.source,'mazes',f.saved.id+'.json'),bytes=await readFile(sourceFile,'utf8');
 const report=await migrateLibraries([f.source],f.target,()=>{}),store=new FileStore(join(f.target,'library'));
 expect(report.converted).toBe(1);expect(report.walks).toBe(1);
 const id=report.mapping[0]!.newId,row=(await store.getMaze(id))!,walk=(await store.getWalk(f.walk.id))!;
 expect(row.maze.version).toBe(5);expect(row.id).toBe(await contentId(row.maze));expect(walls(row.maze)).toEqual(walls(f.maze));
 expect(row.title).toBe('Моя старая карта');expect(row.status).toBe('rejected');expect(row.rejectionReason).toBe('Сохранить причину');
 expect(walk.mazeId).toBe(row.id);expect(walk.walk.recording).toEqual(f.walk.recording);expect(walk.topologyId).toBe(topologyId(row.maze));
 expect(await readFile(sourceFile,'utf8')).toBe(bytes);expect(await readFile(join(f.target,'backup','0','mazes',f.saved.id+'.json'),'utf8')).toBe(bytes);
 // A resumed checkpoint must retain the original recording ID, rather than fail as a foreign map.
 expect((await store.saveWalk(walk.walk)).id).toBe(f.walk.id);
 await expect(migrateLibraries([f.source],f.target,()=>{})).rejects.toThrow('уже существует');
});
test('invalid historical data aborts the whole migration without publishing a partial library',async()=>{
 const f=await fixture();await mkdir(join(f.source,'walks'),{recursive:true});
 await writeFile(join(f.source,'walks','broken.json'),JSON.stringify({id:'broken',walk:{...f.walk,recording:{...f.walk.recording,samples:[{x:-100,z:-100,time:0}]}}}));
 await expect(migrateLibraries([f.source],f.target,()=>{})).rejects.toThrow();
 expect((await readdir(f.root)).sort()).toEqual(['source']);expect(await f.store.getMaze(f.saved.id)).not.toBeNull();
});
test('migration cannot overwrite a source or nest output inside it',async()=>{
 const f=await fixture();await expect(migrateLibraries([f.source],join(f.source,'converted'),()=>{})).rejects.toThrow('разных каталогах');
});
test('two-storey maps and records are copied verbatim without new identities or geometry work',async()=>{
 const f=await fixture(),maze=commute.mazes.find(row=>row.maze.version===6)!.maze;
 const row={id:'keep-storey-id',title:'Два этажа',createdAt:'2026-01-01',updatedAt:'2026-01-02',maze};
 const walk={id:'keep-storey-walk',mazeId:row.id,createdAt:row.createdAt,updatedAt:row.updatedAt,walk:{...f.walk,id:'keep-storey-walk',version:2,maze},assessment:{historical:true}};
 await writeFile(join(f.source,'mazes',row.id+'.json'),JSON.stringify(row));await writeFile(join(f.source,'walks',walk.id+'.json'),JSON.stringify(walk));
 const report=await migrateLibraries([f.source],f.target,()=>{});expect(report.preservedTwoStorey).toBe(1);
 expect(JSON.parse(await readFile(join(f.target,'library','mazes',row.id+'.json'),'utf8'))).toEqual(row);
 expect(JSON.parse(await readFile(join(f.target,'library','walks',walk.id+'.json'),'utf8'))).toEqual(walk);
 const other=join(f.root,'different');await mkdir(join(other,'mazes'),{recursive:true});
 await writeFile(join(other,'mazes',row.id+'.json'),JSON.stringify({...row,maze:{...maze,roof:!maze.roof}}));
 await expect(migrateLibraries([f.source,other],join(f.root,'conflict'),()=>{})).rejects.toThrow('разным картам');
});
test('identical copies from two worktrees merge dates; conflicting titles remain an explicit error',async()=>{
 const f=await fixture(),other=join(f.root,'other');await mkdir(join(other,'mazes'),{recursive:true});
 const old=(await f.store.getMaze(f.saved.id))!,copy={...old,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2027-01-01T00:00:00Z'};
 await writeFile(join(other,'mazes',old.id+'.json'),JSON.stringify(copy));
 const report=await migrateLibraries([f.source,other],f.target,()=>{}),store=new FileStore(join(f.target,'library'));
 expect(report.mazes).toBe(1);const row=(await store.getMaze(report.mapping[0]!.newId))!;
 expect(row.createdAt).toBe(copy.createdAt);expect(row.updatedAt).toBe(copy.updatedAt);expect(report.mapping[1]!.newId).toBe(row.id);
 await writeFile(join(other,'mazes',old.id+'.json'),JSON.stringify({...copy,title:'Другой пользовательский заголовок'}));
 await expect(migrateLibraries([f.source,other],join(f.root,'conflict'),()=>{})).rejects.toThrow('разными метаданными');
 expect((await readdir(f.root)).sort()).toEqual(['other','result','source']);
});
