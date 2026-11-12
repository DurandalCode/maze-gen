import type{Point}from'../core/maze';
import type{Anchor,FreeDraft}from'./model';
import{anchorGeometry,connectionGeometry,modulePolygon,physical,validateFree,freeMaze}from'./layout';
import{polygonUnionBoundary}from'./open-pockets';
import{area,distance,edges,ends,pointIn,segmentDistance,segmentInside}from'./geometry';
import{gatesFor,physicallyOpen}from'./cavity-maze';
import{promoteCavityConnectors}from'./void-infill';
import{freeGroundLengths}from'./path-limits';
import{random,shuffle}from'../core/random';
const signed=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length]!;return s+a.x*b.z-b.x*a.z;},0)/2;
/** Close real near-contacts, then use their enclosed irregular floor. Every
 * boundary already belongs to a real frame or an at-most-three-metre span. */
export function openVortexBayCourts(source:FreeDraft,region:Point[],seed:string,excluded:ReadonlySet<string>,limits:{straight:number;run:number},accept:(d:FreeDraft)=>boolean,maxCourts=3,onProgress?:(s:string)=>void){
 let draft=source,serial=0,raw=0,full=0;const rng=random(seed),prefix='hybrid-court-'+seed.replace(/[^a-z0-9]/gi,'').slice(-32)+'-',width=Math.min(2,source.parameters.corridorWidth),opened:{id:string;area:number;spanArea:number;doors:number}[]=[],inside=(p:Point)=>pointIn(p,region),boundary=edges(region),within=(poly:Point[])=>poly.every(inside)&&edges(poly).every(w=>segmentInside(...ends(w),inside,boundary));const failures=new Set<string>();
 for(let pass=0;pass<maxCourts;pass++){
  const l=draft.layout,used=[...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings],slots:Anchor[]=[];
  for(const m of l.modules.filter(m=>!m.frameOnly&&m.type!=='custom'&&!excluded.has(m.id)))for(const [edge,wall]of edges(modulePolygon(m)).entries()){
   const length=distance(...ends(wall));for(const offset of length>3?[0,-2,2]:[0])if(!used.some(a=>a.room===m.id&&a.edge===edge&&Math.abs(a.offset-offset)<(a.width+width)/2+.12))slots.push({room:m.id,edge,offset});
  }
  const geometry=slots.map(a=>({a,g:anchorGeometry(l,a,width)})),pairs:{a:Anchor;b:Anchor;span:number}[]=[];
  for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++){
   raw++;const a=geometry[i]!,b=geometry[j]!;if(a.a.room===b.a.room||l.connections.some(c=>c.a.room===a.a.room&&c.b.room===b.a.room||c.a.room===b.a.room&&c.b.room===a.a.room))continue;
   const d=distance(a.g.mid,b.g.mid);if(d<.15||d>3.5)continue;const dx=b.g.mid.x-a.g.mid.x,dz=b.g.mid.z-a.g.mid.z;if(dx*a.g.normal.x+dz*a.g.normal.z<=0||-dx*b.g.normal.x-dz*b.g.normal.z<=0)continue;
   const g=connectionGeometry(l,{id:'probe',a:a.a,b:b.a,width}),span=Math.max(...g.sides.map(w=>distance(...ends(w))));if(span>3+1e-7||!within(g.polygon)||Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1-1e-7)continue;pairs.push({a:a.a,b:b.a,span});
  }
  shuffle(pairs,rng).sort((a,b)=>b.span-a.span);let found=false;
  for(const pair of pairs){
   const next=structuredClone(draft),id=prefix+serial++,link={id:id+'-span',a:pair.a,b:pair.b,width,spanAudit:{desired:3,actual:pair.span,reason:'Максимальное замыкание между неизменёнными существующими рамами.'}};next.layout.connections.push(link);next.layout.moduleConstruction!.spans.push(structuredClone(link));if(validateFree(next,false).length)continue;
   const g=connectionGeometry(next.layout,link),courts=polygonUnionBoundary(physical(next.layout).polygons).filter(p=>signed(p)<-2.8&&area(p)<=24&&p.every(inside)&&edges(p).some(w=>g.sides.some(side=>ends(w).every(v=>segmentDistance(v,side)<1e-6)))).map(p=>[...p].reverse());
   if(!courts.length||!accept(next))continue;
   for(const polygon of courts){
    // Promote only this new span when its side supplies a courtyard door.
    // Original vortex connectors, fork perception and clean K routes remain exact.
    const choices=[next,(()=>{const trial=structuredClone(next);promoteCavityConnectors(trial,new Set(trial.layout.connections.filter(c=>c.id!==link.id).map(c=>c.id)));return trial;})()];
    for(const prepared of choices){
     const available=gatesFor([{id,polygon,area:area(polygon)}],prepared.layout).filter(g=>!excluded.has(g.parent.room)),doorPairs=[];
     for(let i=0;i<available.length;i++)for(let j=i+1;j<available.length;j++)if(available[i]!.parent.room!==available[j]!.parent.room)doorPairs.push([available[i]!,available[j]!]as const);doorPairs.sort((a,b)=>distance(b[0].from,b[1].from)-distance(a[0].from,a[1].from));
     for(const doors of doorPairs){
      if(full++>=96)return{draft,opened,raw,full,reason:'Исчерпан фиксированный бюджет96 полных физических проверок; это не доказательство непригодности остальных мест.'};
      const trial=structuredClone(prepared);trial.layout.spaces.push({id,kind:'hall',polygon});doors.forEach((gate,i)=>trial.layout.connections.push({id:id+'-door-'+i,a:gate.anchor,b:gate.parent,width:gate.width}));
      const issue=physicallyOpen(trial);if(issue){failures.add(issue);continue;}if(!accept(trial)){failures.add('Защищённый маршрут/Л/К.');continue;}const n=freeGroundLengths(freeMaze(trial,false));if(n.straight>limits.straight+1e-7||n.run>limits.run+1e-7){failures.add('Физические пределы8/60.');continue;}
      draft=trial;opened.push({id,area:area(polygon),spanArea:area(g.polygon),doors:2});found=true;onProgress?.(`Настоящий неправильный двор ${area(polygon).toFixed(1)} м²: две выборочные двери.`);break;
     }
     if(found)break;
    }
    if(found)break;
   }
   if(found)break;
  }
  if(!found){failures.add(`Из ${pairs.length} близких пар рам не принято физическое закрытие компактного двора.`);break;}
 }
 return{draft,opened,raw,full,reason:[...failures].slice(0,4).join(' ')};
}
