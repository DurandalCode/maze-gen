import {validCorridorPortal,overlappingCorridorPortals} from '../core/corridor-portals';
import {corridorSupports,validateFabricSupports} from '../core/corridor-supports';
import {metrics} from '../core/metrics';
import {DEFAULT_CONSTRUCTION,cellSize,neighbors,portalPoint,validateConstruction,validateParameters,walls,type Maze,type Parameters,type Portal,type Wall} from '../core/maze';
import {domainOf} from '../core/domain';
import {mergeWalls,validatePlacement,regionOwners,type CorridorLayout} from '../core/corridor-geometry';
import {corridorShell} from '../generators/corridor';
import {componentCount} from '../core/graph';
import {physicallySupported,validateCorridorSpaces} from '../core/corridor-navigation';
import {validateEnvironment} from '../core/environment';
const fail=(s='Некорректная геометрия коридорного лабиринта.'):never=>{throw Error(s);};
export function corridorWire(maze:Maze):Record<string,unknown>{
 const openings=(maze.portals??[maze.entrance,maze.exit]).map(p=>{const point=portalPoint(maze,p),size=cellSize(maze,p.cell);return {...point,side:p.side,width:p.width??(p.side==='west'||p.side==='east'?size.depth:size.width)};});
 const portals=maze.portals??[maze.entrance,maze.exit],index=(p:Portal)=>portals.findIndex(q=>q.cell===p.cell&&q.side===p.side);
 return {version:4,parameters:maze.parameters,width:maze.width,depth:maze.depth,layout:maze.layout,supports:corridorSupports(maze),panels:mergeWalls(walls(maze)),openings,entrance:index(maze.entrance),exit:index(maze.exit),wallHeight:maze.wallHeight,wallColor:maze.wallColor,translucentFabric:maze.translucentFabric, ...(maze.fabricTransmissionStrength===undefined?{}:{fabricTransmissionStrength:maze.fabricTransmissionStrength}),roof:maze.roof,...(maze.environment?{environment:maze.environment}:{})};
}
export function decodeCorridor(data:Record<string,unknown>):Maze{
 const p=data.parameters as Parameters;if(!p||p.generationType!=='corridor')fail();validateParameters(p);
 const layout=data.layout as CorridorLayout;if(!layout||!Array.isArray(layout.modules))fail();const maze=corridorShell(p,layout.modules,layout.spaces,layout.networkVersion);validatePlacement(maze);
 if(data.width!==maze.width||data.depth!==maze.depth)fail();
 const construction={wallHeight:data.wallHeight,wallColor:data.wallColor,translucentFabric:data.translucentFabric, ...(data.fabricTransmissionStrength===undefined?{}:{fabricTransmissionStrength:data.fabricTransmissionStrength}),roof:data.roof} as typeof DEFAULT_CONSTRUCTION;validateConstruction(construction);Object.assign(maze,construction);
 if(data.environment!==undefined){validateEnvironment(data.environment as NonNullable<Maze['environment']>);maze.environment=data.environment as Maze['environment'];}
 const d=domainOf(maze);
 if(Array.isArray(data.passages)){
  if(data.panels!==undefined||data.openings!==undefined)fail('Неоднозначное описание геометрии.');
  if(data.passages.length!==maze.passages.length)fail();maze.passages=data.passages.map((list:unknown,a:number)=>{if(!Array.isArray(list)||new Set(list).size!==list.length||list.some(b=>!Number.isInteger(b)||!neighbors(maze,a).includes(b)))fail();return [...(list as number[])];});
  maze.entrance=data.entrance as Portal;maze.exit=data.exit as Portal;maze.portals=data.portals as Portal[]|undefined;
 }else{
  if(!Array.isArray(data.panels)||data.panels.length>100000)fail();const panels=data.panels as Wall[];
  for(const w of panels)if(!w||![w.x1,w.z1,w.x2,w.z2].every(Number.isFinite)||(w.x1!==w.x2&&w.z1!==w.z2)||w.x1<0||w.x2<0||w.z1<0||w.z2<0||w.x1>maze.width||w.x2>maze.width||w.z1>maze.depth||w.z2>maze.depth)fail();
  for(const a of d.cells)for(const b of neighbors(maze,a))if(b>a){const r=d.rectangles[a]!,s=d.rectangles[b]!,vertical=r.x2===s.x1||s.x2===r.x1,fixed=vertical?Math.max(r.x1,s.x1):Math.max(r.z1,s.z1),lo=vertical?Math.max(r.z1,s.z1):Math.max(r.x1,s.x1),hi=vertical?Math.min(r.z2,s.z2):Math.min(r.x2,s.x2);const blocked=panels.some(w=>vertical?w.x1===w.x2&&Math.abs(w.x1-fixed)<1e-7&&Math.min(w.z1,w.z2)<=lo+1e-7&&Math.max(w.z1,w.z2)>=hi-1e-7:w.z1===w.z2&&Math.abs(w.z1-fixed)<1e-7&&Math.min(w.x1,w.x2)<=lo+1e-7&&Math.max(w.x1,w.x2)>=hi-1e-7);if(!blocked){maze.passages[a]!.push(b);maze.passages[b]!.push(a);}}
  if(!Array.isArray(data.openings)||data.openings.length<2||data.openings.length>d.boundary.length)fail();
  const openings=data.openings as {x:number;z:number;side:Portal['side'];width:number}[];
  maze.portals=openings.map(o=>{if(!o||![o.x,o.z,o.width].every(Number.isFinite)||o.width<1-1e-7||o.width>Math.max(2,p.corridorWidth)+1e-7)fail();
    for(const e of d.boundary){if(e.portal.side!==o.side)continue;const size=cellSize(maze,e.portal.cell),natural=e.portal.side==='west'||e.portal.side==='east'?size.depth:size.width,p:Portal=Math.abs(natural-o.width)<1e-7?e.portal:{...e.portal,width:o.width};const q=portalPoint(maze,p);if(Math.hypot(q.x-o.x,q.z-o.z)<1e-7&&validCorridorPortal(maze,p))return p;}return fail('Недопустимый проём.');});
  if(!Number.isInteger(data.entrance)||!Number.isInteger(data.exit))fail();maze.entrance=maze.portals[data.entrance as number]??fail();maze.exit=maze.portals[data.exit as number]??fail();
  if(JSON.stringify(mergeWalls(walls(maze)))!==JSON.stringify(mergeWalls(panels)))fail('Стены не соответствуют области или проёмам.');
 }
 const portalValid=(v:Portal)=>validCorridorPortal(maze,v);
 if(!portalValid(maze.entrance)||!portalValid(maze.exit)||maze.entrance.cell===maze.exit.cell&&maze.entrance.side===maze.exit.side)fail();
 const portals=maze.portals??[maze.entrance,maze.exit];if(portals.length<2||portals.some(p=>!portalValid(p))||new Set(portals.map(p=>`${p.cell}:${p.side}`)).size!==portals.length||![maze.entrance,maze.exit].every(p=>portals.some(q=>q.cell===p.cell&&q.side===p.side)))fail();
 for(let a=0;a<portals.length;a++)for(let b=a+1;b<portals.length;b++)if(overlappingCorridorPortals(maze,portals[a]!,portals[b]!))fail('Проёмы пересекаются.');
 const owners=regionOwners(maze);
 for(const a of d.cells)for(const b of neighbors(maze,a)){if(maze.passages[a]!.includes(b)!==maze.passages[b]!.includes(a))fail();if(owners[a]===owners[b]&&!maze.passages[a]!.includes(b))fail('Перегородка внутри открытого пространства.');}
 validateCorridorSpaces(maze);
 if(metrics(maze).cycles!==p.extraConnections)fail('Число независимых циклов не соответствует параметрам.');
 if(componentCount(maze)!==1)fail('Область и проходы должны быть связными.');
 // Validate each actual elementary unsupported span, not the length of a merged
 // collinear fabric run with module anchors along it.
 if(walls(maze).some(w=>!physicallySupported(maze,w)))fail('Неподдержанный пролёт ткани превышает 3 м.');
 validateFabricSupports(maze);
 if(data.supports!==undefined){if(!Array.isArray(data.supports))fail();const points=data.supports as {x:number;z:number}[];if(points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.z)))fail();const normalized=points.map(p=>({x:Math.round(p.x*1000)/1000,z:Math.round(p.z*1000)/1000})).sort((a,b)=>a.x-b.x||a.z-b.z);if(JSON.stringify(normalized)!==JSON.stringify(corridorSupports(maze)))fail('Incomplete wall and doorway supports.');}
 return maze;
}
export function corridorPhysicalIdentity(maze:Maze):unknown{
 const wire=corridorWire(maze);return {boundary:mergeWalls(domainOf(maze).boundary.map(e=>e.wall)),...(maze.layout!.spaces?{halls:maze.layout!.spaces.filter(r=>r.kind==='hall').map(r=>({...r})).sort((a,b)=>a.x-b.x||a.z-b.z)}:{}),modules:maze.layout!.modules.map(m=>({x:m.x,z:m.z,width:m.type==='2x6'&&m.rotation===0?6:2,depth:m.type==='2x6'&&m.rotation===90?6:2})).sort((a,b)=>a.x-b.x||a.z-b.z||a.width-b.width||a.depth-b.depth),supports:wire.supports,panels:wire.panels,openings:(wire.openings as {x:number;z:number;side:string}[]).sort((a,b)=>a.x-b.x||a.z-b.z||a.side.localeCompare(b.side))};
}
