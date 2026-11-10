import {walls,type Maze,type Wall} from './maze';
import {moduleFootprints,timberStructure} from './structure';
import {metrics} from './metrics';
/** Geometric rendered pieces, not purchased stock: no cutting/waste/fasteners. */
export function materialEstimate(maze:Maze){
 const s=timberStructure(maze),length=(w:Wall)=>Math.hypot(w.x2-w.x1,w.z2-w.z1),upperMetres=s.frames.reduce((n,w)=>n+length(w),0),lowerMetres=(s.lowerFrames??[]).reduce((n,w)=>n+length(w),0),braced=s.braceDrop>.06?(s.bracedFrames??s.frames):[],braceLength=Math.hypot(s.braceDrop,Math.min(s.braceDrop*1.15,maze.parameters.corridorWidth*.32)),bracePieces=braced.length*2,postPieces=s.posts.length*2,wallMetres=walls(maze).reduce((n,w)=>n+length(w),0),timberMetres=postPieces*maze.wallHeight+upperMetres+lowerMetres+bracePieces*braceLength,routeMetres=metrics(maze).optimalLength;
 return {modules:moduleFootprints(maze).length,width:maze.width,depth:maze.depth,area:metrics(maze).area,routeMetres,wallMetres,fabricSquareMetres:wallMetres*maze.wallHeight,posts:s.posts.length,postPieces,upperPieces:s.frames.length,upperMetres,lowerPieces:s.lowerFrames?.length??0,lowerMetres,bracePieces,braceMetres:bracePieces*braceLength,boardPieces:postPieces+s.frames.length+(s.lowerFrames?.length??0)+bracePieces,timberMetres,wallMetresPerRouteMetre:wallMetres/routeMetres,timberMetresPerRouteMetre:timberMetres/routeMetres};
}
