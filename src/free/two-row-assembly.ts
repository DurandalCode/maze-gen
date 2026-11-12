import type {Anchor,FreeConnection,FreeDraft,FreeModule} from './model';
import {anchorGeometry} from './layout';
import {distance} from './geometry';

export interface TwoRowAssembly {modules:FreeModule[];connections:FreeConnection[]}
/** Replace a newly added long frame atomically. Its base footprint and every
 * external door remain exact; the added row creates a genuine alternative.
 * Placement, whole-map collision and 8/16 checks belong to the caller. */
export function replaceTwoRowAssembly(draft:FreeDraft,id:string,prefix:string,side:1|-1):TwoRowAssembly{
 if(side!==1&&side!==-1)throw Error('Сторона второго ряда должна быть +1 или -1.');
 const old=draft.layout.modules.find(m=>m.id===id);
 if(!old||old.type!=='2x6'||old.frameOnly)throw Error('Нужна настоящая новая рама 2×6.');
 if(draft.layout.preservedPanels||draft.layout.preservedSupports)throw Error('Сборка требует нативных модульных стен и стоек.');
 const layout=structuredClone(draft.layout),angle=old.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const modules=[0,1].flatMap(row=>[-2,0,2].map((x,column):FreeModule=>({id:`${prefix}-${row?'top':'base'}-${column}`,type:'2x2',x:old.x+x*c-row*side*5*s,z:old.z+x*s+row*side*5*c,angle:old.angle,...(old.zone!==undefined?{zone:old.zone}:{})})));
 const reserved=new Set([...layout.modules,...layout.spaces,...layout.connections,...layout.openings,...layout.bridges??[]].map(v=>v.id));
 if(modules.some(m=>reserved.has(m.id)))throw Error('Идентификаторы новой сборки уже заняты.');
 const cells=new Set<number>(),addedEdge=side===1?2:0;
 const remap=(a:Anchor,width:number,external:boolean):Anchor=>{
  if(a.room!==id)return a;
  const piece=a.edge===1?2:a.edge===3?0:Math.max(0,Math.min(2,Math.floor(((a.edge===0?a.offset:-a.offset)+3)/2))),center=(piece-1)*2;
  const mapped={room:modules[piece]!.id,edge:a.edge,offset:a.edge===0?a.offset-center:a.edge===2?a.offset+center:a.offset};
  if(external){
   if(a.edge===addedEdge)throw Error('Второй ряд перекроет существующий внешний проём; выберите другую сторону.');
   const before=anchorGeometry(draft.layout,a,width),after=anchorGeometry({...layout,modules:[...layout.modules,...modules]},mapped,width);
   if(distance(before.mid,after.mid)>1e-7||distance(before.from,after.from)>1e-7||distance(before.to,after.to)>1e-7)throw Error('Невозможно сохранить точное положение внешнего проёма.');
   cells.add(piece);
  }else anchorGeometry({...layout,modules:[...layout.modules,...modules]},mapped,width);
  return mapped;
 };
 for(const connection of [...layout.connections,...layout.bridges??[]])for(const end of ['a','b']as const)connection[end]=remap(connection[end],connection.width,true);
 for(const opening of layout.openings)Object.assign(opening,remap(opening,opening.width,true));
 for(const connection of layout.moduleConstruction?.spans??[])for(const end of ['a','b']as const)connection[end]=remap(connection[end],connection.width,false);
 if(cells.size!==2)throw Error('Сборке нужны два разных базовых модуля с внешними проёмами.');
 const endpoints=[...cells].sort(),openBase= endpoints[0]===1?0:1;
 const connections:FreeConnection[]=[];
 const append=(a:number,edgeA:number,b:number,edgeB:number)=>{
  const connection:FreeConnection={id:`${prefix}-link-${connections.length}`,a:{room:modules[a]!.id,edge:edgeA,offset:0},b:{room:modules[b]!.id,edge:edgeB,offset:0},width:2};
  if(reserved.has(connection.id))throw Error('Идентификатор связи новой сборки уже занят.');
  connections.push(connection);
 };
 for(let i=0;i<3;i++)append(i,addedEdge,i+3,(addedEdge+2)%4);
 append(3,1,4,3);append(4,1,5,3);append(openBase,1,openBase+1,3);
 layout.modules=layout.modules.filter(m=>m.id!==id);layout.modules.push(...modules);layout.connections.push(...connections);
 if(layout.moduleConstruction)layout.moduleConstruction.spans.push(...structuredClone(connections));
 draft.layout=layout;
 return {modules,connections};
}

/** A visible single-room recess, never a substitute for a real route fork.
 * The caller validates the added footprint against the rest of the map. */
export function addTwoRowAlcove(draft:FreeDraft,parentId:string,prefix:string,outwardEdge:number):{module:FreeModule;connection:FreeConnection}{
 const parent=draft.layout.modules.find(m=>m.id===parentId);
 if(!parent||parent.type!=='2x2'||parent.frameOnly)throw Error('Альков требует настоящую родительскую раму 2×2.');
 if(!Number.isInteger(outwardEdge)||outwardEdge<0||outwardEdge>3)throw Error('Некорректная сторона алькова.');
 if(draft.layout.preservedPanels||draft.layout.preservedSupports)throw Error('Альков требует нативных стен и стоек.');
 const used=[...draft.layout.connections,...draft.layout.bridges??[]].flatMap(c=>[c.a,c.b]).concat(draft.layout.openings);
 if(used.some(a=>a.room===parentId&&a.edge===outwardEdge))throw Error('Сторона родительской рамы уже занята проёмом.');
 const moduleId=prefix+'-alcove',connectionId=prefix+'-link',ids=new Set([...draft.layout.modules,...draft.layout.spaces,...draft.layout.connections,...draft.layout.openings,...draft.layout.bridges??[],...draft.layout.moduleConstruction?.spans??[]].map(v=>v.id));
 if(ids.has(moduleId)||ids.has(connectionId))throw Error('Идентификаторы алькова уже заняты.');
 const layout=structuredClone(draft.layout),a={room:parentId,edge:outwardEdge,offset:0},gate=anchorGeometry(layout,a,2);
 const module:FreeModule={id:moduleId,type:'2x2',x:parent.x+gate.normal.x*5,z:parent.z+gate.normal.z*5,angle:parent.angle,...(parent.zone!==undefined?{zone:parent.zone}:{})};
 const connection:FreeConnection={id:connectionId,a,b:{room:moduleId,edge:(outwardEdge+2)%4,offset:0},width:2,spanAudit:{desired:3,actual:3}};
 layout.modules.push(module);layout.connections.push(connection);if(layout.moduleConstruction)layout.moduleConstruction.spans.push(structuredClone(connection));
 draft.layout=layout;return {module,connection};
}
