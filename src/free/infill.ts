import type {Maze,Point} from '../core/maze';
import type {Anchor,FreeDraft,FreeLayout,FreeSpace} from './model';
import {mazeDraft} from './json';
import {anchorGeometry,connectionGeometry,freeMaze,physical,rooms,validateFree} from './layout';
import {area,bounds,centroid,distance,edges,ends,lerp,overlap} from './geometry';
import {freeGroundLengths} from './path-limits';

type Promotion={connection:string;space:FreeSpace;gateA:number;gateB:number;widthA:number;widthB:number};
type Slot={anchor:Anchor;mid:Point;normal:Point;promotion?:Promotion};
export interface InfillResult {maze:Maze;addedPassages:number;addedArea:number;promotedCorridors:number;attempted:number}

/** Cheap lower bound before wall construction: a connector and a straight
 * doorway-to-doorway chord cannot be longer than its collision-safe route. */
function relaxedRun(l:FreeLayout){
 const centers=new Map(rooms(l).map(r=>[r.id,centroid(r.polygon)])),adj=new Map<string,{to:string;from:Point;end:Point}[]>();
 for(const id of centers.keys())adj.set(id,[]);
 for(const c of l.connections){const g=connectionGeometry(l,c);adj.get(c.a.room)!.push({to:c.b.room,from:g.a.mid,end:g.b.mid});adj.get(c.b.room)!.push({to:c.a.room,from:g.b.mid,end:g.a.mid});}
 const endpoint=(id:string)=>{const o=l.openings.find(o=>(o.id===l.entrance||o.id===l.exit)&&o.room===id);return o?anchorGeometry(l,o,o.width).mid:centers.get(id)!;};
 let maximum=0;
 for(const [start,links]of adj)if(links.length!==2)for(const first of links){
  let at=start,point=endpoint(start),link=first,total=0;const seen=new Set<string>();
  while(!seen.has(at)){
   seen.add(at);total+=distance(point,link.from)+distance(link.from,link.end);point=link.end;const previous=at;at=link.to;
   const next=adj.get(at)!;if(next.length!==2){total+=distance(point,endpoint(at));break;}
   link=next.find(n=>n.to!==previous)!;
  }
  maximum=Math.max(maximum,total);
 }
 return maximum;
}

/** Give an existing narrow connector a real side doorway only where it is
 * needed. Its floor is retained as one polygon, not a raster of tiny cells. */
function promotion(l:FreeLayout,id:string):Promotion|null{
 const c=l.connections.find(c=>c.id===id)!;const g=connectionGeometry(l,c),length=distance(g.a.mid,g.b.mid);
 if(length<1.6)return null;
 const t=Math.min(.2,.18/length),a=lerp(g.a.from,g.b.to,t),b=lerp(g.b.to,g.a.from,t),z=lerp(g.b.from,g.a.to,t),w=lerp(g.a.to,g.b.from,t);
 return {connection:id,space:{id:`infill-junction-${id}`,kind:'corridor',polygon:[a,b,z,w]},gateA:3,gateB:1,widthA:Math.min(c.width,distance(w,a))-1e-6,widthB:Math.min(c.width,distance(b,z))-1e-6};
}
function promote(l:FreeLayout,p:Promotion){
 if(l.spaces.some(s=>s.id===p.space.id))return;
 const index=l.connections.findIndex(c=>c.id===p.connection),c=l.connections[index]!;l.connections.splice(index,1);
 l.spaces.push(structuredClone(p.space));
 l.connections.push({id:p.connection+'-infill-a',a:c.a,b:{room:p.space.id,edge:p.gateA,offset:0},width:p.widthA},{id:p.connection+'-infill-b',a:{room:p.space.id,edge:p.gateB,offset:0},b:c.b,width:p.widthB});
}
function inventory(l:FreeLayout,width:number){
 const promotions=l.connections.map(c=>promotion(l,c.id)).filter((p):p is Promotion=>p!==null),temp={...l,spaces:[...l.spaces,...promotions.map(p=>p.space)]},all=rooms(temp),byId=new Map(promotions.map(p=>[p.space.id,p]));
 const used=[...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings];
 const slots:Slot[]=[];
 for(const room of all)for(const [edge,wall]of edges(room.polygon).entries()){
  const length=distance(...ends(wall));if(length<width+.15)continue;
  const offsets=length>3?[-(length-width)/2+.1,0,(length-width)/2-.1]:[0];
  for(const offset of offsets){
   const anchor={room:room.id,edge,offset};
   if(used.some(a=>a.room===room.id&&a.edge===edge&&Math.abs(a.offset-offset)<(a.width+width)/2+.12))continue;
   const p=byId.get(room.id);if(p&&(edge===p.gateA||edge===p.gateB))continue;
   const g=anchorGeometry(temp,anchor,width);slots.push({anchor,mid:g.mid,normal:g.normal,...(p?{promotion:p}:{})});
  }
 }
 return {slots,promotions};
}
function graph(l:FreeLayout,promotions:Promotion[]){
 const adj=new Map<string,string[]>(),add=(a:string,b:string)=>{if(!adj.has(a))adj.set(a,[]);if(!adj.has(b))adj.set(b,[]);adj.get(a)!.push(b);adj.get(b)!.push(a);},lookup=new Map(promotions.map(p=>[p.connection,p.space.id]));
 for(const c of l.connections){const middle=lookup.get(c.id);if(middle){add(c.a.room,middle);add(middle,c.b.room);}else add(c.a.room,c.b.room);}
 const start=l.openings.find(o=>o.id===l.entrance)!.room,end=l.openings.find(o=>o.id===l.exit)!.room;
 const search=(from:string,cut?:[string,string])=>{const dist=new Map([[from,0]]),parent=new Map<string,string>(),q=[from];for(const a of q)for(const b of adj.get(a)??[])if(!(cut&&(a===cut[0]&&b===cut[1]||a===cut[1]&&b===cut[0]))&&!dist.has(b)){dist.set(b,dist.get(a)!+1);parent.set(b,a);q.push(b);}return {dist,parent};};
 const original=search(start),path=[end];while(path.at(-1)!==start){const p=original.parent.get(path.at(-1)!);if(!p)break;path.push(p);}
 const cuts:Set<string>[]=[];
 for(let i=1;i<path.length;i++){const seen=search(start,[path[i-1]!,path[i]!]).dist;if(!seen.has(end))cuts.push(new Set(seen.keys()));}
 const distances=new Map<string,Map<string,number>>();
 return {cuts,distance:(a:string,b:string)=>{if(!distances.has(a))distances.set(a,search(a).dist);return distances.get(a)!.get(b)??0;}};
}
function boxOverlaps(a:ReturnType<typeof bounds>,b:ReturnType<typeof bounds>){return a.x1<b.x2-1e-7&&a.x2>b.x1+1e-7&&a.z1<b.z2-1e-7&&a.z2>b.z1+1e-7;}
/** Fill usable interstitial gaps with two-ended corridors. Every insertion is
 * an actual cross-connection, rather than an ornamental terminal pocket. */
export function infillFree(base:Maze,maxPassages=12,width=1.4,onProgress?:(text:string)=>void,options?:{maxStraight:number;maxRun:number;allowEmpty?:boolean;maxCandidates?:number}):InfillResult{
 if(!base.free||base.free.bridges?.length||base.free.preservedPanels)throw Error('Заполнение доступно для одноэтажной свободной геометрии с обычными стенами.');
 let draft=mazeDraft(base),addedPassages=0,addedArea=0,promotedCorridors=0,attempted=0;
 for(let pass=0;pass<maxPassages;pass++){
  if(attempted>=(options?.maxCandidates??Infinity))break;
  const {slots,promotions}=inventory(draft.layout,width),network=graph(draft.layout,promotions),occupied=physical(draft.layout).polygons.map(poly=>({poly,box:bounds(poly)}));
  const pairs:{a:Slot;b:Slot;length:number;score:number;polygon:Point[]}[]=[];
  for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){
   const a=slots[i]!,b=slots[j]!;if(a.anchor.room===b.anchor.room)continue;
   const length=distance(a.mid,b.mid);if(length<3.6||length>9)continue;
   const ux=(b.mid.x-a.mid.x)/length,uz=(b.mid.z-a.mid.z)/length;
   if(a.normal.x*ux+a.normal.z*uz<.92||-b.normal.x*ux-b.normal.z*uz<.92)continue;
   const apart=network.distance(a.anchor.room,b.anchor.room);if(apart<7)continue;
   const gap=.8,start={x:a.mid.x+ux*gap,z:a.mid.z+uz*gap},end={x:b.mid.x-ux*gap,z:b.mid.z-uz*gap},tx=-uz*width/2,tz=ux*width/2,polygon=[{x:start.x-tx,z:start.z-tz},{x:end.x-tx,z:end.z-tz},{x:end.x+tx,z:end.z+tz},{x:start.x+tx,z:start.z+tz}],box=bounds(polygon);
   if(occupied.some(r=>boxOverlaps(box,r.box)&&overlap(polygon,r.poly)))continue;
   const crossed=network.cuts.filter(c=>c.has(a.anchor.room)!==c.has(b.anchor.room)).length;
   pairs.push({a,b,length,polygon,score:crossed*10+Math.min(apart,30)-length*.25});
  }
  pairs.sort((a,b)=>b.score-a.score);
  let accepted=false;
  for(const candidate of pairs.slice(0,120)){
   if(attempted>=(options?.maxCandidates??Infinity))break;
   attempted++;const next:FreeDraft=structuredClone(draft),l=next.layout;
   for(const p of [candidate.a.promotion,candidate.b.promotion])if(p)promote(l,p);
   const id=`infill-${pass}`,poly=candidate.polygon;l.spaces.push({id,kind:'corridor',polygon:poly});
   l.connections.push({id:id+'-a',a:candidate.a.anchor,b:{room:id,edge:3,offset:0},width},{id:id+'-b',a:{room:id,edge:1,offset:0},b:candidate.b.anchor,width});
   l.supports??=[];for(const wall of edges(poly)){const [a,b]=ends(wall),n=Math.ceil(distance(a,b)/2.5);for(let k=0;k<=n;k++)l.supports.push(lerp(a,b,k/n));}
   if(options&&relaxedRun(l)>options.maxRun+1e-7)continue;
   if(validateFree(next,false).length)continue;
   if(validateFree(next).length)continue;
   if(options){const lengths=freeGroundLengths(freeMaze(next,false));if(lengths.straight>options.maxStraight+1e-7||lengths.run>options.maxRun+1e-7)continue;}
   draft=next;addedPassages++;addedArea+=area(poly);promotedCorridors+=Number(!!candidate.a.promotion)+Number(!!candidate.b.promotion);accepted=true;
   onProgress?.(`Добавлено поперечных проходов: ${addedPassages}`);break;
  }
  if(!accepted)break;
 }
 if(!addedPassages&&!options?.allowEmpty)throw Error('Не найдены пригодные промежутки между существующими коридорами.');
 draft.parameters={...draft.parameters,seed:base.parameters.seed+'-hybrid',extraConnections:base.parameters.extraConnections+addedPassages};
 const maze=freeMaze(draft);return {maze,addedPassages,addedArea,promotedCorridors,attempted};
}
