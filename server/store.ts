import {physicalStoreyIdentity} from '../src/core/two-storey';
import {freeIdentity} from '../src/free/json';
import {recordJson,restoreRecord} from '../src/persistence/record-codec';
import {corridorPhysicalIdentity} from '../src/persistence/corridor-json';
import { mkdir,readFile,readdir,rename,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { deserialize } from '../src/persistence/maze-json';
import { validateWalk,type WalkData } from '../src/persistence/walk-json';
import { assessWalk,type WalkAssessment } from '../src/analysis/walk-assessment';
import { domainOf } from '../src/core/domain';
import type { Maze } from '../src/core/maze';

export interface SavedMaze {id:string;title:string;createdAt:string;updatedAt:string;maze:Maze;status?:'candidate'|'rejected';rejectionReason?:string}
export function topologyId(maze:Maze):string {if(maze.storeys)return createHash('sha256').update(canonical(physicalStoreyIdentity(maze))).digest('hex').slice(0,24);if(maze.version===5)return createHash('sha256').update(canonical(freeIdentity(maze))).digest('hex').slice(0,24);if(maze.version===4)return createHash('sha256').update(canonical(corridorPhysicalIdentity(maze))).digest('hex').slice(0,24);const {seed:_,algorithm:__,extraConnections:___,routeTrapCount:____,design:_____,loopTrapCount:______,generationType:_______,...geometry}=maze.parameters;return createHash('sha256').update(canonical({version:maze.version,geometry,passages:maze.passages,portals:maze.portals??[maze.entrance,maze.exit]})).digest('hex').slice(0,24);}
export interface SavedWalk {id:string;mazeId:string;createdAt:string;updatedAt:string;walk:WalkData;assessment:WalkAssessment}
const validId=(id:string)=>/^[a-zA-Z0-9_-]{1,80}$/.test(id);
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
export class FileStore {
  private pending=new Map<string,Promise<unknown>>();
  constructor(readonly root:string){}
  private file(folder:string,id:string) {
    if(!validId(id))throw new Error('Некорректный идентификатор.');
    return join(this.root,folder,id+'.json');
  }
  private async read<T>(folder:string,id:string):Promise<T|null> {
    try{return restoreRecord(JSON.parse(await readFile(this.file(folder,id),'utf8')) as T);}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  private async write(folder:string,id:string,value:unknown) {
    await mkdir(join(this.root,folder),{recursive:true});
    const file=this.file(folder,id),temp=file+'.'+randomUUID()+'.tmp';
    await writeFile(temp,recordJson(value),'utf8');await rename(temp,file);
  }
  private async locked<T>(key:string,task:()=>Promise<T>):Promise<T> {
    const previous=this.pending.get(key)??Promise.resolve();
    const next=previous.catch(()=>{}).then(task);this.pending.set(key,next);
    try{return await next;}finally{if(this.pending.get(key)===next)this.pending.delete(key);}
  }
  async prepareWalk(raw:unknown) {
    const maze=deserialize(JSON.stringify(raw)),id=topologyId(maze);
    const known=(await this.listWalks()).some(row=>row.topologyId===id&&row.distance>.01);
    const firstAttempt=!known,roofEnforced=firstAttempt;
    return {maze:roofEnforced?{...maze,roof:true}:maze,firstAttempt,roofEnforced};
  }
  async saveMaze(raw:unknown,title?:unknown):Promise<SavedMaze> {
    const maze=deserialize(JSON.stringify(raw)),id=createHash('sha256').update(canonical(maze)).digest('hex').slice(0,24);
    if(title!==undefined&&(typeof title!=='string'||title.length>120))throw new Error('Название должно содержать до 120 символов.');
    return this.locked('maze:'+id,async()=> {
      const previous=await this.read<SavedMaze>('mazes',id),now=new Date().toISOString();
      const record:SavedMaze={id,title:typeof title==='string'&&title.trim()?title.trim():previous?.title??`${maze.parameters.columns} × ${maze.parameters.rows} · ${maze.parameters.seed}`.slice(0,120),
        createdAt:previous?.createdAt??now,updatedAt:now,maze,status:previous?.status??'candidate',rejectionReason:previous?.rejectionReason};
      await this.write('mazes',id,record);return record;
    });
  }
  getMaze(id:string){return this.read<SavedMaze>('mazes',id);}
  async rejectMaze(id:string,reason:string):Promise<SavedMaze> {
    if(typeof reason!=='string'||!reason.trim()||reason.length>500)throw new Error('Нужна причина отклонения до 500 символов.');
    return this.locked('maze:'+id,async()=>{const previous=await this.getMaze(id);if(!previous)throw new Error('Лабиринт не найден.');const row:SavedMaze={...previous,status:'rejected',rejectionReason:reason.trim(),updatedAt:new Date().toISOString()};await this.write('mazes',id,row);return row;});
  }
  async restoreMazeCandidate(id:string):Promise<SavedMaze> {
    return this.locked('maze:'+id,async()=>{const previous=await this.getMaze(id);if(!previous)throw new Error('Лабиринт не найден.');const row:SavedMaze={...previous,status:'candidate',rejectionReason:undefined,updatedAt:new Date().toISOString()};await this.write('mazes',id,row);return row;});
  }
  getWalk(id:string){return this.read<SavedWalk>('walks',id);}
  private async list<T>(folder:string):Promise<T[]> {
    let names:string[];try{names=await readdir(join(this.root,folder));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    const rows=await Promise.all(names.filter(name=>/^[a-zA-Z0-9_-]{1,80}\.json$/.test(name)).map(name=>this.read<T>(folder,name.slice(0,-5))));
    return rows.filter(row=>row!==null) as T[];
  }
  async listMazes() {
    return (await this.list<SavedMaze>('mazes')).sort((a,b)=>(a.status==='rejected'?1:0)-(b.status==='rejected'?1:0)||b.updatedAt.localeCompare(a.updatedAt)).map(row=>({id:row.id,title:row.title,createdAt:row.createdAt,updatedAt:row.updatedAt,status:row.status??'candidate',rejectionReason:row.rejectionReason,
      columns:row.maze.parameters.columns,rows:row.maze.parameters.rows,generationType:row.maze.parameters.generationType??'classical',modules:row.maze.parameters.moduleSize===undefined?null:domainOf(row.maze).modules.reduce((a,b)=>a+b,0)}));
  }
  async listWalks() {
    return (await this.list<SavedWalk>('walks')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(row=>({id:row.id,mazeId:row.mazeId,createdAt:row.createdAt,updatedAt:row.updatedAt,
      topologyId:topologyId(row.walk.maze),status:row.walk.status,finished:row.walk.finished,elapsed:row.walk.recording.elapsed,distance:row.walk.recording.distance,assessment:assessWalk(row.walk.maze,row.walk.recording.samples,row.walk.recording.distance,row.walk.finished),
      columns:row.walk.maze.parameters.columns,rows:row.walk.maze.parameters.rows}));
  }
  async saveWalk(raw:unknown):Promise<SavedWalk> {
    const walk=validateWalk(raw),maze=await this.saveMaze(walk.maze);
    return this.locked('walk:'+walk.id,async()=> {
      const previous=await this.getWalk(walk.id);
      if(previous&&previous.mazeId!==maze.id)throw new Error('Запись относится к другому лабиринту.');
      if(previous&&(previous.walk.finished || previous.walk.recording.elapsed>walk.recording.elapsed ||
        (previous.walk.status==='stopped'&&walk.status==='in-progress'&&previous.walk.recording.elapsed>=walk.recording.elapsed)))return previous;
      const now=new Date().toISOString();
      const record:SavedWalk={id:walk.id,mazeId:maze.id,createdAt:previous?.createdAt??now,updatedAt:now,walk,
        assessment:assessWalk(walk.maze,walk.recording.samples,walk.recording.distance,walk.finished)};
      await this.write('walks',walk.id,record);return record;
    });
  }
}
