import {emptyMaze,type Parameters} from './maze';
import {domainOf} from './domain';
/** Convert the legacy footprint once, without reinterpreting module indices as
 * metres. Later type switches restore each type's own geometry draft. */
export function corridorParameters(p:Parameters):Parameters{
 if(p.generationType==='corridor')return {...p};const maze=emptyMaze(p),d=domainOf(maze);
 if(maze.width>100||maze.depth>100)throw Error('Для коридорного типа задайте площадку не больше 100×100 м.');
 const rectangles:{x:number;z:number;width:number;height:number;operation:'add'}[]=[];
 if(p.shape)for(const c of d.cells){const r=d.rectangles[c]!,previous=rectangles.at(-1);if(previous&&Math.abs(previous.z-r.z1)<1e-7&&Math.abs(previous.height-(r.z2-r.z1))<1e-7&&Math.abs(previous.x+previous.width-r.x1)<1e-7)previous.width=Math.round((r.x2-previous.x)*10)/10;else rectangles.push({x:r.x1,z:r.z1,width:r.x2-r.x1,height:r.z2-r.z1,operation:'add'});}
 const {shape:_,...rest}=p;return {...rest,generationType:'corridor',columns:Math.round(maze.width*10)/10,rows:Math.round(maze.depth*10)/10,moduleSize:2,corridorWidth:Math.min(3,Math.max(1,p.corridorWidth)),...(p.shape?{shape:{kind:'grid-rectangles',rectangles}}:{})};
}
