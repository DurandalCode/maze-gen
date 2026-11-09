import type {Maze} from '../core/maze';
import {routingSize} from '../core/maze';
import {shapeMask,domainOf} from '../core/domain';
import {generateBase} from './generate';
import {withPortals,mazePortals} from '../core/portals';

/** Conservative P-shape fallback: same module count first, then growth inside the user's budget. */
export function shapeAlternatives(base:Maze):Maze[]{
  const design=base.parameters.design;if(!design?.allowReshape||base.parameters.moduleSize===undefined||mazePortals(base).length!==2)return [];
  const {columns:w,rows:h}=base.parameters,mask=shapeMask(base.parameters);
  let thickness=0;while(mask[(h-1)*w+thickness])thickness++;
  if(thickness<2||2*thickness>=w)return [];
  for(let z=0;z<h;z++)for(let x=0;x<w;x++)if(Boolean(mask[z*w+x])!==(z<thickness||x<thickness||x>=w-thickness))return [];
  const old=domainOf(base).modules.reduce((a,b)=>a+b,0),max=Math.floor(old*(1+design.maxModuleGrowth)+1e-8);
  const choices:{w:number;h:number;t:number;n:number}[]=[];
  for(let t=thickness;t<=Math.min(thickness+2,6);t++)for(let x=2*t+1;x<=Math.min(20,w+6);x++)for(let z=t+3;z<=Math.min(16,h+4);z++){
    const n=t*(x+2*z-2*t);
    if(n<old||n>max||x===w&&z===h&&t===thickness)continue;
    choices.push({w:x,h:z,t,n});
  }
  choices.sort((a,b)=>Number(a.n!==old)-Number(b.n!==old)||Number(!(a.w===w&&a.h===h))-Number(!(b.w===w&&b.h===h))||a.n-b.n||Math.abs(a.w-w)+Math.abs(a.h-h)-Math.abs(b.w-w)-Math.abs(b.h-h)||a.w-b.w||a.t-b.t);
  return choices.slice(0,16).map(c=>{
    const parameters={...base.parameters,columns:c.w,rows:c.h,shape:{kind:'grid-rectangles' as const,rectangles:[{x:0,z:0,width:c.w,height:c.h,operation:'add' as const},{x:c.t,z:c.t,width:c.w-2*c.t,height:c.h-c.t,operation:'subtract' as const}]}};
    const raw=generateBase(parameters),size=routingSize(raw),entrance={cell:(size.rows-1)*size.columns,side:'south' as const},exit={cell:size.rows*size.columns-1,side:'south' as const};
    return withPortals({...raw,wallHeight:base.wallHeight,wallColor:base.wallColor,translucentFabric:base.translucentFabric,roof:base.roof,...(base.environment?{environment:base.environment}:{}),entrance,exit},[entrance,exit]);
  });
}
