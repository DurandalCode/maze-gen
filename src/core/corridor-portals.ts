import type {Maze,Portal,Wall} from './maze';
import {domainOf} from './domain';
import {regionOwners,mm} from './corridor-geometry';
/** A physical boundary opening may span several navigation cells. Width starts
 * at the low coordinate of its anchor edge; cell indices remain unchanged. */
export function corridorPortalWall(maze:Maze,p:Portal):Wall|null{
 const edge=domainOf(maze).boundary.find(e=>e.portal.cell===p.cell&&e.portal.side===p.side);if(!edge)return null;
 const w={...edge.wall};if(p.width!==undefined){if(w.x1===w.x2)w.z2=w.z1+p.width;else w.x2=w.x1+p.width;}return w;
}
export function validCorridorPortal(maze:Maze,p:Portal):boolean{
 if(!p)return false;const w=corridorPortalWall(maze,p);if(!w)return false;
 const vertical=w.x1===w.x2,lo=mm(vertical?w.z1:w.x1),hi=mm(vertical?w.z2:w.x2),width=(hi-lo)/1000;
 if(!Number.isFinite(width)||width<1-1e-7||width>Math.max(2,maze.parameters.corridorWidth)+1e-7)return false;
 const owners=regionOwners(maze),owner=owners[p.cell];let end=lo;
 const edges=domainOf(maze).boundary.filter(e=>e.portal.side===p.side&&owners[e.portal.cell]===owner&&(vertical?mm(e.wall.x1)===mm(w.x1):mm(e.wall.z1)===mm(w.z1))).map(e=>[mm(vertical?e.wall.z1:e.wall.x1),mm(vertical?e.wall.z2:e.wall.x2)]).sort((a,b)=>a[0]!-b[0]!);
 for(const [a,b]of edges){if(b!<=end)continue;if(a!>end)break;end=b!;if(end>=hi)return true;}return false;
}
export function corridorBoundaryPortals(maze:Maze,width=2):Portal[]{
 return domainOf(maze).boundary.map(e=>({...e.portal,width})).filter(p=>validCorridorPortal(maze,p));
}
export function overlappingCorridorPortals(maze:Maze,a:Portal,b:Portal):boolean{
 if(a.side!==b.side)return false;const x=corridorPortalWall(maze,a),y=corridorPortalWall(maze,b);if(!x||!y)return false;
 return x.x1===x.x2?mm(x.x1)===mm(y.x1)&&Math.min(mm(x.z2),mm(y.z2))>Math.max(mm(x.z1),mm(y.z1)):mm(x.z1)===mm(y.z1)&&Math.min(mm(x.x2),mm(y.x2))>Math.max(mm(x.x1),mm(y.x1));
}
