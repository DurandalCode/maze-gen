import type {Point} from '../core/maze';
import type {Anchor,FreeDraft} from './model';
import {anchorGeometry,connectionGeometry,freeMaze,modulePolygon,physical,validateFree} from './layout';
import {area,centroid,distance,edges,ends,segmentDistance} from './geometry';
import {polygonUnionBoundary} from './open-pockets';
import {promoteCavityConnectors} from './void-infill';
import {gatesFor,physicallyOpen} from './cavity-maze';
import {freeGroundLengths,freeLengthLimits} from './path-limits';
import {auditModuleWalls} from './module-origin';
import {random,shuffle} from '../core/random';
export interface SelectiveCourt {id:string;polygon:Point[];area:number;doors:number;modules:string[];span:number;spanArea:number}
export interface SelectiveCourtyards {draft:FreeDraft;opened:SelectiveCourt[];rejected:{area:number;reason:string}[]}
const signed=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0)/2;
/** Close only real short gaps between existing frames, then open compact
 * courtyards through two existing boundary walls. No extra frame, partition,
 * unsupported cap, blanket door carving or change to source module positions. */
export function openSelectiveCourtyards(source:FreeDraft,seed:string,maxCourts=6,onProgress?:(s:string)=>void):SelectiveCourtyards{
 if(!source.layout.moduleConstruction)throw Error('Выборочные дворы требуют подтверждённой модульной конструкции.');
 const explicit=freeLengthLimits(source.parameters),straightLimit=Math.min(8,explicit.straight),runLimit=Math.min(16,explicit.run);
 let draft=source;const opened:SelectiveCourt[]=[],rejected:SelectiveCourtyards['rejected']=[],rng=random(seed),width=Math.min(1.2,source.parameters.corridorWidth);
 const originalModules=JSON.stringify(source.layout.modules),occupiedIds=new Set([...source.layout.modules,...source.layout.spaces,...source.layout.connections,...source.layout.openings].map(v=>v.id));let serial=0;
 const nextId=(prefix:string)=>{let id:string;do{id=`${prefix}-${serial++}`;}while(occupiedIds.has(id));occupiedIds.add(id);return id;};
 for(let pass=0;pass<maxCourts;pass++){
  const l=draft.layout,used=[...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings];
  const slots:Anchor[]=[];
  for(const m of l.modules.filter(m=>!m.frameOnly&&m.type!=='custom'))for(const [edge,w]of edges(modulePolygon(m)).entries()){
   const length=distance(...ends(w)),offsets=length>3?[-(length-width)/2+.15,0,(length-width)/2-.15]:[0];
   for(const offset of offsets){const a={room:m.id,edge,offset};if(!used.some(o=>o.room===a.room&&o.edge===edge&&Math.abs(o.offset-offset)<(o.width+width)/2+.12))slots.push(a);}
  }
  const geometries=slots.map(a=>({a,g:anchorGeometry(l,a,width)})),candidates:{a:Anchor;b:Anchor;length:number}[]=[];
  for(let i=0;i<geometries.length;i++)for(let j=i+1;j<geometries.length;j++){
   const a=geometries[i]!,b=geometries[j]!,length=distance(a.g.mid,b.g.mid);if(a.a.room===b.a.room||length<.15||length>3.2)continue;
   if(l.connections.some(c=>c.a.room===a.a.room&&c.b.room===b.a.room||c.a.room===b.a.room&&c.b.room===a.a.room))continue;
   const dx=(b.g.mid.x-a.g.mid.x)/length,dz=(b.g.mid.z-a.g.mid.z)/length;if(a.g.normal.x*dx+a.g.normal.z*dz<=0||-b.g.normal.x*dx-b.g.normal.z*dz<=0)continue;
   const g=connectionGeometry(l,{id:'probe',a:a.a,b:b.a,width});if(g.sides.some(w=>distance(...ends(w))>3+1e-7))continue;
   candidates.push({a:a.a,b:b.a,length});
  }
  shuffle(candidates,rng).sort((a,b)=>a.length-b.length);let accepted=false;
  for(const candidate of candidates.slice(0,24)){
   const next=structuredClone(draft),link={id:nextId('selective-span'),a:candidate.a,b:candidate.b,width};next.layout.connections.push(link);
   next.layout.moduleConstruction!.spans.push(structuredClone(link));
   if(validateFree(next,false).length)continue;
   const g=connectionGeometry(next.layout,link),p=physical(next.layout);
   const courts=polygonUnionBoundary(p.polygons).filter(poly=>signed(poly)<-2.8&&edges(poly).some(w=>g.sides.some(side=>ends(w).every(v=>segmentDistance(v,side)<1e-6)))).map(poly=>[...poly].reverse()).sort((a,b)=>area(a)-area(b));
   if(!courts.length)continue;
   for(const polygon of courts){
    const surface=area(polygon);if(surface>24){rejected.push({area:surface,reason:'Двор больше24м²: выборочный проход не должен превращать полость в большой зал.'});continue;}
    const promoted=structuredClone(next);promoteCavityConnectors(promoted);const id=nextId('selective-court');
    const available=gatesFor([{id,polygon,area:surface}],promoted.layout),pairs:{a:typeof available[number];b:typeof available[number];separation:number}[]=[];
    for(let i=0;i<available.length;i++)for(let j=i+1;j<available.length;j++){const a=available[i]!,b=available[j]!;if(a.parent.room!==b.parent.room)pairs.push({a,b,separation:distance(centroid([a.from,a.to]),centroid([b.from,b.to]))});}
    pairs.sort((a,b)=>b.separation-a.separation);const failures=new Set<string>();
    for(const pair of pairs.slice(0,24)){
     const trial=structuredClone(promoted);trial.layout.spaces.push({id,kind:'hall',polygon});[pair.a,pair.b].forEach((gate,i)=>trial.layout.connections.push({id:id+'-door-'+i,a:gate.anchor,b:gate.parent,width:gate.width}));
     const issue=physicallyOpen(trial);if(issue){failures.add(issue);continue;}
     const lengths=freeGroundLengths(freeMaze(trial,false));if(lengths.straight>straightLimit+1e-7||lengths.run>runLimit+1e-7){failures.add(`Предел${straightLimit}/${runLimit}: ${lengths.straight.toFixed(2)}/${lengths.run.toFixed(2)}м.`);continue;}
     const audit=auditModuleWalls(trial.layout);if(audit.issues.length){failures.add(audit.issues[0]!.message);continue;}
     if(JSON.stringify(trial.layout.modules)!==originalModules)throw Error('Выборочные дворы не должны изменять модульные рамы.');
     draft=trial;opened.push({id,polygon,area:surface,doors:2,modules:[candidate.a.room,candidate.b.room],span:Math.max(...g.sides.map(w=>distance(...ends(w)))),spanArea:area(g.polygon)});accepted=true;onProgress?.(`Компактные дворы: открыто ${opened.length}, добавлено ${opened.reduce((s,c)=>s+c.area+c.spanArea,0).toFixed(1)}м².`);break;
    }
    if(accepted)break;
    rejected.push({area:surface,reason:!pairs.length?'На существующих стенах нет двух непересекающихся дверей шириной≥1м.':`${[...failures].slice(0,3).join(' ')} Проверено пар дверей: ${Math.min(24,pairs.length)}/${pairs.length}.`});
   }
   if(accepted)break;
  }
  if(!accepted)break;
 }
 return {draft,opened,rejected:[...new Map(rejected.map(r=>[r.area.toFixed(5)+'/'+r.reason,r])).values()]};
}
