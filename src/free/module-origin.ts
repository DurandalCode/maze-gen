import type {Wall} from '../core/maze';
import type {FreeLayout,FreeIssue} from './model';
import {connectionGeometry,modulePolygon,physical} from './layout';
import {distance,edges,ends,segmentDistance} from './geometry';
export interface ModuleWallOrigin{id:string;kind:'module'|'span';modules:string[];wall:Wall}
export interface ModuleWallAudit{origins:ModuleWallOrigin[];walls:{wall:Wall;origins:string[]}[];issues:FreeIssue[]}
/** Structural roots are actual 2x2/2x6 room frames. Navigation rooms, visible
 * loose posts and frameOnly decoration cannot certify a fabric partition. */
export function auditModuleWalls(l:FreeLayout,panels:Wall[]=physical(l).panels):ModuleWallAudit{
 const origins:ModuleWallOrigin[]=[],issues:FreeIssue[]=[],modules=new Map(l.modules.filter(m=>!m.frameOnly&&(m.type==='2x2'||m.type==='2x6')).map(m=>[m.id,m]));
 for(const m of modules.values())edges(modulePolygon(m)).forEach((wall,i)=>origins.push({id:`module:${m.id}:${i}`,kind:'module',modules:[m.id],wall}));
 const spans=[...l.moduleConstruction?.spans??[],...l.connections.filter(c=>modules.has(c.a.room)&&modules.has(c.b.room))],seen=new Set<string>();
 for(const c of spans){if(seen.has(c.id))continue;seen.add(c.id);
  if(c.a.room===c.b.room||!modules.has(c.a.room)||!modules.has(c.b.room)){issues.push({code:'module-origin',message:'Пролёт должен крепиться к двум настоящим модулям2×2/2×6.',ids:[c.id]});continue;}
  try{const g=connectionGeometry(l,c);if(g.sides.some(w=>distance(...ends(w))>3+1e-7)){issues.push({code:'module-origin',message:'Межмодульная стенка длиннее3м; отдельная стойка не заменяет модульную опору.',ids:[c.id]});continue;}g.sides.forEach((wall,i)=>{if(distance(...ends(wall))>1e-7)origins.push({id:`span:${c.id}:${i}`,kind:'span',modules:[c.a.room,c.b.room],wall});});}catch{issues.push({code:'module-origin',message:'Не найдены реальные точки крепления межмодульного пролёта.',ids:[c.id]});}
 }
 for(const post of physical(l).posts)if(!origins.some(o=>segmentDistance(post,o.wall)<1e-6))issues.push({code:'module-origin',message:'Отдельная стойка не связана с модульным каркасом или межмодульным пролётом.',ids:[]});
 const walls=panels.map(wall=>({wall,origins:origins.filter(o=>ends(wall).every(p=>segmentDistance(p,o.wall)<1e-6)).map(o=>o.id)}));
 for(const w of walls)if(!w.origins.length)issues.push({code:'module-origin',message:'Стена не принадлежит модульному каркасу или пролёту между двумя настоящими модулями.',ids:[]});
 return {origins,walls,issues};
}
