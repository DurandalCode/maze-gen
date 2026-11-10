import type {Maze,Point,Portal,Wall} from '../core/maze';
import {domainOf,shapeMask} from '../core/domain';
import {mergeWalls,type CorridorLayout} from '../core/corridor-geometry';
import {physicalStoreyIdentity} from '../core/two-storey';
import {corridorShell} from '../generators/corridor';
import {freeIdentity} from '../free/json';
import type {FreeLayout} from '../free/model';
import {deserialize} from './maze-json';
import {corridorPhysicalIdentity} from './corridor-json';
/** Persisted snapshots contain physical data, not their expensive navigation caches. */
type StoredMaze=Omit<Maze,'layout'|'width'|'depth'>&{
 width?:number;depth?:number;layout?:CorridorLayout|FreeLayout;supports?:Point[];panels?:Wall[];
 openings?:({x:number;z:number;side:Portal['side'];width:number})[];
};
export function storedModuleCount(maze:Maze):number|null{
 const m=maze as StoredMaze,p=m.parameters;
 if(p.moduleSize===undefined)return null;
 if(m.version===4||m.version===5)return (m.free??m.layout)!.modules.length;
 const count=(shape=p.shape)=>shapeMask({...p,shape}).reduce((a,b)=>a+b,0);
 return count()+(m.version===6?count(p.upperShape??p.shape):0);
}
/** Same identity as the runtime map; free navigation never needs to be rebuilt. */
export function storedTopologyPayload(maze:Maze):unknown{
 const m=maze as StoredMaze;
 if(m.version===5)return freeIdentity({...m,width:m.width??m.parameters.columns,depth:m.depth??m.parameters.rows,free:m.free??m.layout} as Maze);
 if(m.version===4&&m.panels&&m.openings&&m.supports){
  const l=m.layout as CorridorLayout,shell=corridorShell(m.parameters,l.modules,l.spaces,l.networkVersion);
  return {boundary:mergeWalls(domainOf(shell).boundary.map(e=>e.wall)),...(l.spaces?{halls:l.spaces.filter(r=>r.kind==='hall').map(r=>({...r})).sort((a,b)=>a.x-b.x||a.z-b.z)}:{}),
   modules:l.modules.map(v=>({x:v.x,z:v.z,width:v.type==='2x6'&&v.rotation===0?6:2,depth:v.type==='2x6'&&v.rotation===90?6:2})).sort((a,b)=>a.x-b.x||a.z-b.z||a.width-b.width||a.depth-b.depth),
   supports:[...m.supports].sort((a,b)=>a.x-b.x||a.z-b.z),panels:mergeWalls(m.panels),openings:[...m.openings].sort((a,b)=>a.x-b.x||a.z-b.z||a.side.localeCompare(b.side))};
 }
 if(m.version===4)return corridorPhysicalIdentity(deserialize(JSON.stringify(m)));
 // Older two-storey files lack node positions; only this legacy identity fallback
 // reconstructs them. Newly saved records persist their topology ID directly.
 if(m.version===6)return physicalStoreyIdentity(m.storeys?.nodes?maze:deserialize(JSON.stringify(m)));
 const {seed:_,algorithm:__,extraConnections:___,routeTrapCount:____,design:_____,loopTrapCount:______,generationType:_______,...geometry}=m.parameters;
 return {version:m.version,geometry,passages:m.passages,portals:m.portals??[m.entrance,m.exit]};
}
