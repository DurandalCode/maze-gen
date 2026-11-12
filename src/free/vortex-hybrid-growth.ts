import type{Point}from'../core/maze';
import type{Anchor,FreeDraft,FreeModule}from'./model';
import{emptyLayout}from'./model';
import{anchorGeometry,connectionGeometry,modulePolygon,physical,validateFree,freeMaze}from'./layout';
import{distance,edges,ends,pointIn,segmentInside,overlap,segmentDistance}from'./geometry';
import{maximumConnectionGap}from'./connection-span';
import{random,shuffle}from'../core/random';
import{physicallyOpen}from'./cavity-maze';
import{freeGroundLengths}from'./path-limits';
/** Explore a negative-space region with actual independently rotated frames.
 * A one-edge extension cannot create a bypass or a hidden topological junction. */
export function growVortexBay(source:FreeDraft,polygon:Point[],seed:string,count:number,excluded:ReadonlySet<string>,limits:{straight:number;run:number},accept:(d:FreeDraft)=>boolean,onProgress?:(s:string)=>void){
 let draft=source,serial=0,added=0,reason='Исчерпан заданный бюджет новых рам.',raw=0,full=0;const rng=random(seed),width=Math.min(2,source.parameters.corridorWidth),prefix='hybrid-'+seed.replace(/[^a-z0-9]/gi,'').slice(-40)+'-',inside=(p:Point)=>pointIn(p,polygon),boundary=edges(polygon),within=(poly:Point[])=>poly.every(inside)&&edges(poly).every(e=>segmentInside(...ends(e),inside,boundary));
 const originalIds=new Set(source.layout.modules.map(m=>m.id));
 for(let step=0;step<count;step++){
  const l=draft.layout,floor=physical(l).polygons,used=[...l.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...l.openings],newFrames=l.modules.filter(m=>!originalIds.has(m.id)),slots:Anchor[]=[];
  for(const parent of l.modules.filter(m=>!excluded.has(m.id)&&!m.frameOnly&&m.type!=='custom'))for(const [edge,wall]of edges(modulePolygon(parent)).entries()){
   const len=distance(...ends(wall));for(const offset of len>3?[0,-(len-width)/2+.15,(len-width)/2-.15]:[0])if(!used.some(a=>a.room===parent.id&&a.edge===edge&&Math.abs(a.offset-offset)<(a.width+width)/2+.12))slots.push({room:parent.id,edge,offset});
  }
  const candidates:{module:FreeModule;link:{id:string;a:Anchor;b:Anchor;width:number;spanAudit:{desired:number;actual:number}};score:number}[]=[];
  for(const from of shuffle(slots,rng)){
   const a=anchorGeometry(l,from,width);if(!inside({x:a.mid.x+a.normal.x*.15,z:a.mid.z+a.normal.z*.15}))continue;
   for(const type of ['2x2','2x6']as const)for(const bend of shuffle([0,-15,15,-30,30,-45,45],rng)){
    raw++;const incoming=type==='2x6'?3:0,angle=((Math.atan2(-a.normal.z,-a.normal.x)*180/Math.PI+bend-[-90,0,90,180][incoming]!)%360+360)%360,module:FreeModule={id:prefix+serial++,type,x:0,z:0,angle},target={room:module.id,edge:incoming,offset:0},b=anchorGeometry({...emptyLayout(),modules:[module]},target,width),gap=maximumConnectionGap(a,b,3);if(gap<.15)continue;
    module.x=a.mid.x+a.normal.x*gap-b.mid.x;module.z=a.mid.z+a.normal.z*gap-b.mid.z;const poly=modulePolygon(module);if(!within(poly)||floor.some(p=>overlap(poly,p)))continue;
    const link={id:module.id+'-span',a:from,b:target,width,spanAudit:{desired:3,actual:3}},g=connectionGeometry({...l,modules:[...l.modules,module]},link);if(!within(g.polygon)||floor.some(p=>overlap(g.polygon,p))||Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1-1e-7)continue;
    const separation=newFrames.length?Math.min(...newFrames.map(m=>distance(m,module))):0,preferred=step%3===1?'2x6':'2x2';candidates.push({module,link,score:Math.min(15,separation)+(type===preferred?4:0)+rng()*.05});
   }
  }
  candidates.sort((a,b)=>b.score-a.score);let accepted=false;const failures=new Set<string>();
  for(const candidate of candidates.slice(0,16)){
   full++;const next=structuredClone(draft);next.layout.modules.push(candidate.module);next.layout.connections.push(candidate.link);next.layout.moduleConstruction?.spans.push(structuredClone(candidate.link));
   const errors=validateFree(next);if(errors.length){failures.add(errors[0]!.code);continue;}const lengths=freeGroundLengths(freeMaze(next,false));if(lengths.straight>limits.straight+1e-7||lengths.run>limits.run+1e-7){failures.add('Предел физического пути8/60.');continue;}
   const issue=physicallyOpen(next);if(issue||!accept(next)){failures.add(issue||'Защищённая структура маршрута.');continue;}draft=next;added++;accepted=true;onProgress?.(`Бухта: размещено настоящих рам ${added}/${count}.`);break;
  }
  if(!accepted){reason=`Ограниченный поиск: ${candidates.length} геометрических вариантов, проверено ${Math.min(16,candidates.length)}. ${[...failures].slice(0,3).join(' ')}`;break;}
 }
 return{draft,added,reason,raw,full};
}
