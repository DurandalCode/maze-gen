import type {Maze} from '../core/maze';
export function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export async function contentId(value:unknown):Promise<string>{
 const bytes=new TextEncoder().encode(canonical(value)),hash=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);
}
export async function browserTopologyId(maze:Maze):Promise<string>{
 const {seed:_,algorithm:__,extraConnections:___,routeTrapCount:____,design:_____,loopTrapCount:______,...geometry}=maze.parameters;
 return contentId({version:maze.version,geometry,passages:maze.passages,portals:maze.portals??[maze.entrance,maze.exit]});
}
