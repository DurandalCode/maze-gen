import {assembleStoreys,stairCandidates} from '../generators/two-storey';
import {makeFloors,minimumFloorChanges,SLAB_THICKNESS} from '../core/two-storey';
import {validateParameters,validateConstruction,type Maze,type Parameters,type Portal} from '../core/maze';
import {componentCount,independentCycles} from '../core/graph';
import {domainOf} from '../core/domain';
import {validateEnvironment} from '../core/environment';
export function storeyWire(maze:Maze):unknown {
  if(!maze.storeys?.floors)return maze;
  const {storeys,...rest}=maze,n=storeys!.floors[0].passages.length;
  return {...rest,storeys:{floorHeight:storeys!.floorHeight,slabThickness:SLAB_THICKNESS,stairs:storeys!.stairs.map(s=>({lower:s.lower,upper:s.upper%n,shaft:s.shaft,axis:s.axis}))}};
}
export function decodeStorey(data:Record<string,unknown>):Maze {
  const fail=():never=>{throw Error('Некорректный двухэтажный лабиринт: геометрия, лестницы или обязательные переходы.');};
  const p=data.parameters as Parameters;if(!p||p.generationType!=='two-storey')return fail();validateParameters(p);
  const raw=data.storeys as {floorHeight:number;slabThickness:number;stairs:{lower:number;upper:number;shaft:number[];axis:string}[]};
  if(!raw||raw.slabThickness!==SLAB_THICKNESS||!Number.isFinite(raw.floorHeight)||raw.floorHeight!==(data.wallHeight as number)+SLAB_THICKNESS||!Array.isArray(raw.stairs)||raw.stairs.length<2||raw.stairs.length>200)return fail();
  const floors=makeFloors(p),n=floors[0].passages.length,candidates=stairCandidates(floors,raw.floorHeight),reserved=new Set<number>();
  const stairs=raw.stairs.map(st=>{
    if(!st||!Array.isArray(st.shaft))return fail();
    const c=candidates.find(c=>c.lower===st.lower&&c.upper===(st.upper>=n&&st.upper<2*n?st.upper-n:st.upper)&&c.axis===st.axis&&JSON.stringify(c.shaft)===JSON.stringify(st.shaft));if(!c)return fail();
    for(const i of [c.lower,c.upper,...c.shaft]){if(reserved.has(i))return fail();reserved.add(i);}return c;
  });
  const maze=assembleStoreys(p,raw.floorHeight,stairs);
  const construction={wallHeight:data.wallHeight,wallColor:data.wallColor,translucentFabric:data.translucentFabric,roof:data.roof} as Maze;validateConstruction(construction);Object.assign(maze,construction);
  if(data.width!==maze.width||data.depth!==maze.depth)return fail();
  if(data.environment!==undefined){validateEnvironment(data.environment as Maze['environment'] & {});maze.environment=data.environment as Maze['environment'];}
  if(!Array.isArray(data.passages)||data.passages.length!==maze.passages.length)return fail();
  maze.passages=data.passages.map((list:unknown,i)=>{if(!Array.isArray(list)||new Set(list).size!==list.length||list.some(b=>!Number.isInteger(b)||!maze.storeys!.adjacent[i]!.includes(b)))return fail();return [...list] as number[];});
  for(const [a,links]of maze.passages.entries())for(const b of links)if(!maze.passages[b]!.includes(a))return fail();
  for(const st of maze.storeys!.stairs){const chain=[st.lower,...st.cells,st.upper];for(let i=1;i<chain.length;i++)if(!maze.passages[chain[i-1]!]!.includes(chain[i]!))return fail();}
  const portal=(v:unknown):Portal=>{const q=v as Portal;if(!q||!domainOf(maze).boundary.some(e=>e.portal.cell===q.cell&&e.portal.side===q.side))return fail();return {cell:q.cell,side:q.side};};
  maze.entrance=portal(data.entrance);maze.exit=portal(data.exit);
  if(maze.entrance.cell===maze.exit.cell)return fail();
  if(data.portals!==undefined){if(!Array.isArray(data.portals))return fail();maze.portals=data.portals.map(portal);if(new Set(maze.portals.map(p=>p.cell+':'+p.side)).size!==maze.portals.length||![maze.entrance,maze.exit].every(p=>maze.portals!.some(q=>q.cell===p.cell&&q.side===p.side)))return fail();}
  if(componentCount(maze)!==1||independentCycles(maze)!==p.extraConnections||minimumFloorChanges(maze)<(p.minFloorChanges??4))return fail();
  return maze;
}
