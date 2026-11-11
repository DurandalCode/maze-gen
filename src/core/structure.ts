import {bridgeGeometry} from '../free/bridges';
import {storeyView} from './two-storey';
import {freeRuntime,modulePolygon,size} from '../free/layout';
import {edges,ends,segmentDistance} from '../free/geometry';
import {corridorSupports} from './corridor-supports';
import {footprint,metres,mergeWalls} from './corridor-geometry';
import { domainOf } from './domain';
import { walls, type Maze, type Point, type Wall } from './maze';

export const BOARD_WIDTH = 0.12;
export const BOARD_THICKNESS = 0.04;
export const FRAME_POST_SIZE = BOARD_WIDTH;
export const HEADER_DEPTH = 0.14;

export interface LowerFrame extends Wall { inward:Point }

export interface TimberStructure {
  posts: Point[];
  frames: Wall[];
  braceDrop: number;
  lowerFrames?:LowerFrame[];
  /** Physical module sides eligible for knee braces; omitted means every frame. */
  bracedFrames?:Wall[];
  /** Hall roof girders attach to neighbouring module rails, without centre posts. */
  roofFrames?:Wall[];
}

export interface ModuleFootprint { angle?:number; x: number; z: number; size: number; width?:number; depth?:number }
export function moduleFootprints(maze: Maze): ModuleFootprint[] {
  if(maze.storeys)return moduleFootprints(storeyView(maze,0));
  if((maze.version===5||maze.version===7))return maze.free!.modules.map(m=>{const [width,depth]=size(m);return {x:m.x-width/2,z:m.z-depth/2,width,depth,size:2,angle:m.angle};});
  if(maze.version===4)return maze.layout!.modules.map(m=>{const r=footprint(m);return {x:m.x,z:m.z,size:2,width:metres(r.x2-r.x1),depth:metres(r.z2-r.z1)};});
  const { moduleSize, columns, rows, corridorWidth: gap } = maze.parameters;
  if (moduleSize === undefined) return [];
  const modules: ModuleFootprint[] = [];
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++)
    if (domainOf(maze).modules[z*columns+x]) modules.push({ x: (maze.version === 1 ? gap : 0)+x*(moduleSize+gap), z: (maze.version === 1 ? gap : 0)+z*(moduleSize+gap), size: moduleSize });
  return modules;
}

/** Each separate module owns four corner uprights and a closed top perimeter. */
export function timberStructure(maze: Maze): TimberStructure {
  if(maze.shaftRects){const {shaftRects,...plain}=maze,base=timberStructure(plain);const inShaft=(x:number,z:number)=>shaftRects.some(r=>x>=r.x1-.1&&x<=r.x2+.1&&z>=r.z1-.1&&z<=r.z2+.1);return {...base,posts:base.posts.filter(p=>!inShaft(p.x,p.z)),frames:base.frames.filter(w=>!shaftRects.some(r=>Math.max(w.x1,w.x2)>=r.x1-.1&&Math.min(w.x1,w.x2)<=r.x2+.1&&Math.max(w.z1,w.z2)>=r.z1-.1&&Math.min(w.z1,w.z2)<=r.z2+.1))};}
  if(maze.storeys)return timberStructure(storeyView(maze,0));
  if((maze.version===5||maze.version===7)){
    const r=freeRuntime(maze),frames=maze.free!.modules.flatMap(m=>edges(modulePolygon(m))),lowerFrames:LowerFrame[]=[];
    for(const m of maze.free!.modules.filter(m=>m.type==='2x6')){
      const perimeter=edges(modulePolygon(m));
      for(const w of r.panels){
        const edge=perimeter.find(e=>segmentDistance(ends(w)[0],e)<1e-7&&segmentDistance(ends(w)[1],e)<1e-7);
        if(!edge)continue;
        const dx=edge.x2-edge.x1,dz=edge.z2-edge.z1,length=Math.hypot(dx,dz);
        // The offset must be perpendicular even when a doorway trims one end.
        lowerFrames.push({...w,inward:{x:-dz/length,z:dx/length}});
      }
    }
    const headers=r.panels.filter(w=>!frames.some(e=>segmentDistance(ends(w)[0],e)<1e-7&&segmentDistance(ends(w)[1],e)<1e-7));
    return {posts:r.posts,frames:[...frames,...headers],bracedFrames:frames,lowerFrames,braceDrop:Math.min(.42,Math.max(0,maze.wallHeight-HEADER_DEPTH-1.88))};
  }
  if(maze.navigation)return timberStructure(maze.navigation.source);
  if(maze.version===4){
    const posts:Point[]=corridorSupports(maze),frames:Wall[]=[],lowerFrames:LowerFrame[]=[];
    for(const m of moduleFootprints(maze)){
      const corners=[{x:m.x,z:m.z},{x:m.x+(m.width??m.size),z:m.z},{x:m.x+(m.width??m.size),z:m.z+(m.depth??m.size)},{x:m.x,z:m.z+(m.depth??m.size)}];
      for(let i=0;i<4;i++){const a=corners[i]!,b=corners[(i+1)%4]!;frames.push({x1:a.x,z1:a.z,x2:b.x,z2:b.z});}
      if((m.width??m.size)>2||(m.depth??m.size)>2)for(const w of walls(maze)){
        const vertical=w.x1===w.x2;
        if(vertical&&(w.x1===m.x||w.x1===m.x+(m.width??m.size))){const a=Math.max(m.z,Math.min(w.z1,w.z2)),b=Math.min(m.z+(m.depth??m.size),Math.max(w.z1,w.z2));if(b>a)lowerFrames.push({x1:w.x1,z1:a,x2:w.x1,z2:b,inward:{x:w.x1===m.x?1:-1,z:0}});}
        if(!vertical&&(w.z1===m.z||w.z1===m.z+(m.depth??m.size))){const a=Math.max(m.x,Math.min(w.x1,w.x2)),b=Math.min(m.x+(m.width??m.size),Math.max(w.x1,w.x2));if(b>a)lowerFrames.push({x1:a,z1:w.z1,x2:b,z2:w.z1,inward:{x:0,z:w.z1===m.z?1:-1}});}
      }
    }
    // Preserve each module perimeter for braces; navigation cuts are not uprights.
    const bracedFrames=[...frames];
    // Only physical construction gets headers. Navigation region boundaries do
    // not introduce beams across open streets or subdivide long modules.
    for(const w of mergeWalls(walls(maze))){
      const vertical=w.x1===w.x2,fixed=vertical?w.x1:w.z1;
      let spans:[number,number][]=[[vertical?w.z1:w.x1,vertical?w.z2:w.x2]];
      for(const f of bracedFrames){
        if(vertical?f.x1!==f.x2||f.x1!==fixed:f.z1!==f.z2||f.z1!==fixed)continue;
        const lo=Math.min(vertical?f.z1:f.x1,vertical?f.z2:f.x2),hi=Math.max(vertical?f.z1:f.x1,vertical?f.z2:f.x2);
        spans=spans.flatMap(([a,b]):[number,number][]=>hi<=a||lo>=b?[[a,b]]:[...(lo>a?[[a,lo] as [number,number]]:[]),...(hi<b?[[hi,b] as [number,number]]:[])]);
      }
      for(const [lo,hi]of spans){
        const cuts=[lo,...posts.filter(p=>Math.abs((vertical?p.x:p.z)-fixed)<1e-7).map(p=>vertical?p.z:p.x).filter(v=>v>lo+1e-7&&v<hi-1e-7),hi].sort((a,b)=>a-b);
        for(let i=1;i<cuts.length;i++)frames.push(vertical?{x1:fixed,x2:fixed,z1:cuts[i-1]!,z2:cuts[i]!}:{z1:fixed,z2:fixed,x1:cuts[i-1]!,x2:cuts[i]!});
      }
    }
    const roofFrames:Wall[]=[];
    if(maze.roof&&maze.layout!.networkVersion!==undefined)for(const h of maze.layout!.spaces??[])if(h.kind==='hall'){if(h.width>=h.height){for(let x=h.x+2;x<h.x+h.width;x+=2)roofFrames.push({x1:x,z1:h.z,x2:x,z2:h.z+h.height});}else for(let z=h.z+2;z<h.z+h.height;z+=2)roofFrames.push({x1:h.x,z1:z,x2:h.x+h.width,z2:z});}
    frames.push(...roofFrames);
    return {posts,frames,lowerFrames,bracedFrames,roofFrames,braceDrop:Math.min(0.42,2*0.28,Math.max(0,maze.wallHeight-HEADER_DEPTH-1.88))};
  }
  const { corridorWidth: s } = maze.parameters;
  const posts: Point[] = [], frames: Wall[] = [];
  if (maze.parameters.moduleSize !== undefined) {
    const uniquePosts = new Map<string, Point>();
    const addFrame = (a: Point, b: Point) => {
      uniquePosts.set(`${a.x.toFixed(6)},${a.z.toFixed(6)}`, a);
      uniquePosts.set(`${b.x.toFixed(6)},${b.z.toFixed(6)}`, b);
      frames.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
    };
    for (const m of moduleFootprints(maze)) {
      const corners = [{ x: m.x, z: m.z }, { x: m.x+(m.width??m.size), z: m.z },
        { x: m.x+(m.width??m.size), z: m.z+(m.depth??m.size) }, { x: m.x, z: m.z+(m.depth??m.size) }];
      for (let i = 0; i < 4; i++) addFrame(corners[i]!, corners[(i+1)%4]!);
    }
    // Preserve geometry only when opening a previously saved v1 modular file.
    if (maze.version === 1) for (const w of walls(maze)) if (w.x1 === 0 && w.x2 === 0 || w.z1 === 0 && w.z2 === 0 ||
      Math.abs(w.x1-maze.width)<1e-6 && Math.abs(w.x2-maze.width)<1e-6 ||
      Math.abs(w.z1-maze.depth)<1e-6 && Math.abs(w.z2-maze.depth)<1e-6)
      addFrame({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 });
    return { posts: [...uniquePosts.values()], frames,
      braceDrop: Math.min(0.42, maze.parameters.moduleSize*0.28, Math.max(0, maze.wallHeight-HEADER_DEPTH-1.88)) };
  }
  // Legacy files retain their continuous-grid layout.
  const domain = domainOf(maze), uniquePosts = new Map<string,Point>(), uniqueFrames = new Map<string,Wall>();
  for (const cell of domain.cells) {
    const r=domain.rectangles[cell]!;
    const corners=[{x:r.x1,z:r.z1},{x:r.x2,z:r.z1},{x:r.x2,z:r.z2},{x:r.x1,z:r.z2}];
    for(let i=0;i<4;i++) {
      const a=corners[i]!,b=corners[(i+1)%4]!;
      uniquePosts.set(`${a.x}:${a.z}`,a);
      const endpoints=[`${a.x}:${a.z}`,`${b.x}:${b.z}`].sort();
      uniqueFrames.set(endpoints.join('/'),{x1:Math.min(a.x,b.x),z1:Math.min(a.z,b.z),x2:Math.max(a.x,b.x),z2:Math.max(a.z,b.z)});
    }
  }
  posts.push(...uniquePosts.values()); frames.push(...uniqueFrames.values());
  return {
    posts, frames,
    // At the minimum wall height omit braces rather than putting them at eye level.
    braceDrop: Math.min(0.42, s * 0.28, Math.max(0, maze.wallHeight - HEADER_DEPTH - 1.88)),
  };
}

/** Uprights occupy a conservative 12 × 12 cm envelope at lattice intersections. */
export function supportColliders(maze: Maze): Wall[] {
  if(maze.storeys)return [0,1].flatMap(floor=>supportColliders(storeyView(maze,floor)).filter(w=>!maze.storeys!.stairs.some(st=>st.shaft.some(c=>{const r=domainOf(maze.storeys!.floors[0]).rectangles[c]!;return w.x1>=r.x1-.1&&w.x1<=r.x2+.1&&w.z1>=r.z1-.1&&w.z1<=r.z2+.1;}))).map(w=>({...w,y:floor*maze.storeys!.floorHeight,height:maze.wallHeight,floor})));
  return timberStructure(maze).posts.map(p => {const bridge=maze.free?.bridges?.find(b=>bridgeGeometry(maze.free!,b).deck.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<1e-7));return {x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:FRAME_POST_SIZE,...(maze.free?.bridges?.length?{y:0,height:bridge?bridge.rise+maze.wallHeight:maze.wallHeight}:{})};});
}
