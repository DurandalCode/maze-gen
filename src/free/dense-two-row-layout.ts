import type {FreeDraft} from './model';
import {anchorGeometry,validateFree} from './layout';
import {replaceTwoRowAssembly,addTwoRowAlcove} from './two-row-assembly';
import {selectOppositePortals} from './opposite-portals';
export interface DenseTwoRowVariant {draft:FreeDraft;rows:number;kept:string[]}
const opposed=(draft:FreeDraft)=>{const gates=draft.layout.openings.filter(o=>o.id===draft.layout.entrance||o.id===draft.layout.exit);return selectOppositePortals(draft.layout,gates,Math.min(...gates.map(o=>o.width))).length>0;};
function addAlcoves(source:FreeDraft,prefix:string){let draft=source,count=0,checks=0;
 for(const parent of source.layout.modules.filter(m=>m.id.startsWith(prefix)&&m.id.includes('-rows-top-1'))){
  const base=source.layout.modules.find(m=>m.id===parent.id.replace('-top-','-base-'))!;const dx=parent.x-base.x,dz=parent.z-base.z;
  for(const edge of [0,2]){if(count>=2||checks++>=8)return draft;const n=anchorGeometry(draft.layout,{room:parent.id,edge,offset:0},2).normal;if(n.x*dx+n.z*dz<0)continue;
   const next=structuredClone(draft);try{addTwoRowAlcove(next,parent.id,parent.id+'-micro',edge);}catch{continue;}if(validateFree(next,false).length||!opposed(next))continue;draft=next;count++;break;
  }
 }
 return draft;
}
/** Fit a second row beside newly added sectors, never move the dense base.
 * A long frame that cannot accept a row stays an ordinary unscreened room.
 * Public physical length acceptance remains mandatory in either case. */
export function denseTwoRowVariants(source:FreeDraft,prefix:string):DenseTwoRowVariant[]{
 let variants:DenseTwoRowVariant[]=[{draft:source,rows:0,kept:[]}];
 const ids=source.layout.modules.filter(m=>m.id.startsWith(prefix+'-')&&m.type==='2x6').map(m=>m.id);
 for(const id of ids){const next:DenseTwoRowVariant[]=[];
  for(const variant of variants){let fitted=false;
   for(const side of [1,-1]as const){const draft=structuredClone(variant.draft);try{replaceTwoRowAssembly(draft,id,id+'-rows',side);}catch{continue;}
    if(validateFree(draft,false).length||!opposed(draft))continue;fitted=true;next.push({draft,rows:variant.rows+1,kept:[...variant.kept]});
   }
   if(!fitted)next.push({draft:variant.draft,rows:variant.rows,kept:[...variant.kept,id]});
  }
  variants=next.sort((a,b)=>b.rows-a.rows).slice(0,4);
 }
 return variants.filter(v=>v.rows>=3).map(v=>({...v,draft:addAlcoves(v.draft,prefix)}));
}
