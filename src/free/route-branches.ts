import type {Maze,Point} from '../core/maze';
import type {Anchor,FreeDraft,FreeModule} from './model';
import {emptyLayout} from './model';
import {mazeDraft} from './json';
import {anchorGeometry,connectionGeometry,freeMaze,modulePolygon,physical,validateFree} from './layout';
import {maximumConnectionGap} from './connection-span';
import {distance,edges,ends,overlap,segmentDistance} from './geometry';
import {freeGroundRunWitness,freeGroundStraightWitness} from './path-limits';
import {physicallyOpen} from './cavity-maze';
import {selectOppositePortals} from './opposite-portals';
import {random,shuffle} from '../core/random';
import {crosslinkLongRoute,type ReturnCircuitGuard} from './route-crosslinks';
/** Two-room, bent, full-size blind arms. Used only as constructive repair of
 * an actual long corridor witness, never as a fake navigation junction. */
export function branchLongRoute(source:Maze,seed:string,onProgress?:(s:string)=>void,pendingReturnLoop=false,maximumBranches=4,protectedRouteRooms:readonly string[]=[],returnGuards:readonly ReturnCircuitGuard[]=[]):Maze{
 if(!Number.isInteger(maximumBranches)||maximumBranches<1||maximumBranches>6)throw Error('Допустимо от одной до шести конструктивных ветвей за проход.');
 let draft=mazeDraft(source),serial=0;let hash=2166136261;for(const c of seed)hash=Math.imul(hash^c.charCodeAt(0),16777619);const prefix=source.free!.modules.some(m=>m.id.startsWith('route-arm-'))?'route-arm-'+(hash>>>0).toString(16)+'-':'route-arm-';const rng=random(seed),width=Math.min(1.4,source.parameters.corridorWidth);
 const slots=(d:FreeDraft,room:string)=>{const m=d.layout.modules.find(m=>m.id===room);if(!m)return [];const used=[...d.layout.connections.flatMap(c=>[{...c.a,width:c.width},{...c.b,width:c.width}]),...d.layout.openings],out:Anchor[]=[];for(const [edge,w]of edges(modulePolygon(m)).entries()){const length=distance(...ends(w));for(const offset of length>3?[-(length-width)/2+.15,0,(length-width)/2-.15]:[0])if(!used.some(o=>o.room===room&&o.edge===edge&&Math.abs(o.offset-offset)<(o.width+width)/2+.12))out.push({room,edge,offset});}return shuffle(out,rng);};
 const floorCache=new WeakMap<FreeDraft,Point[][]>();
 const extensions=function*(d:FreeDraft,from:Anchor,type:'2x2'|'2x6'){
  const a=anchorGeometry(d.layout,from,width);let floor=floorCache.get(d);if(!floor){floor=physical(d.layout).polygons;floorCache.set(d,floor);}
  for(const incoming of shuffle(type==='2x6'?[1,3]:[0,1,2,3],rng))for(const bend of shuffle([0,-15,15],rng)){
   const angle=((Math.atan2(-a.normal.z,-a.normal.x)*180/Math.PI+bend-[-90,0,90,180][incoming]!)%360+360)%360;
   const module:FreeModule={id:prefix+serial++,type,x:0,z:0,angle},anchor={room:module.id,edge:incoming,offset:0},gate=anchorGeometry({...emptyLayout(),modules:[module]},anchor,width);
   for(const span of [3,2.5,2])for(const lateral of (returnGuards.length?[0,-.8,.8,-1.6,1.6]:[0])){
    const tangent={x:-a.normal.z*lateral,z:a.normal.x*lateral},shifted={...gate,from:{x:gate.from.x+tangent.x,z:gate.from.z+tangent.z},to:{x:gate.to.x+tangent.x,z:gate.to.z+tangent.z}},gap=maximumConnectionGap(a,shifted,span);if(gap<.1)continue;module.x=a.mid.x+a.normal.x*gap+tangent.x-gate.mid.x;module.z=a.mid.z+a.normal.z*gap+tangent.z-gate.mid.z;
    const polygon=modulePolygon(module);if(polygon.some(p=>p.x<0||p.z<0||p.x>d.parameters.columns||p.z>d.parameters.rows)||floor.some(p=>overlap(polygon,p)))continue;
    const temporary={...d.layout,modules:[...d.layout.modules,module]},link={id:prefix+'span-'+serial++,a:from,b:anchor,width,spanAudit:{desired:3,actual:span,...(span<3?{reason:'Геометрия существующих рам ограничивает новую ложную ветвь.'}:{})}},g=connectionGeometry(temporary,link);
    if(floor.some(p=>overlap(g.polygon,p))||Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1-1e-7)continue;
    const next=structuredClone(d);next.layout.modules.push(structuredClone(module));next.layout.connections.push(link);next.layout.moduleConstruction!.spans.push(structuredClone(link));yield {draft:next,module,incoming};
   }
  }
 };
 for(let pass=0;pass<maximumBranches;pass++){
  const maze=freeMaze(draft,false),runWitness=freeGroundRunWitness(maze),straightRepair=runWitness.length<=16+1e-7,witness=straightRepair?freeGroundStraightWitness(maze):runWitness;if(witness.length<=(straightRepair?8:16)+1e-7)return maze;
  const ids=[...new Set(witness.rooms)],moduleIds=ids.filter(id=>draft.layout.modules.some(m=>m.id===id));moduleIds.sort((a,b)=>Math.abs(ids.indexOf(a)-ids.length/2)-Math.abs(ids.indexOf(b)-ids.length/2));let accepted:FreeDraft|undefined,checks=0,raw=0;
  roots:for(const root of moduleIds.slice(0,maximumBranches>4?12:6))for(const from of slots(draft,root))for(const first of extensions(draft,from,'2x2')){
   for(const turn of slots(first.draft,first.module.id).filter(a=>a.edge%2!==first.incoming%2))for(const type of (returnGuards.length?['2x6','2x2']as const:['2x6']as const))for(const second of extensions(first.draft,turn,type)){
    if(raw++>=256||checks>=12)break roots;
    const gates=second.draft.layout.openings.filter(o=>o.id===second.draft.layout.entrance||o.id===second.draft.layout.exit);if(!selectOppositePortals(second.draft.layout,gates,Math.min(...gates.map(g=>g.width))).length)continue;
    checks++;if(validateFree(second.draft).length||physicallyOpen(second.draft))continue;
    const candidate=freeMaze(second.draft,false),newWitness=(straightRepair?freeGroundStraightWitness:freeGroundRunWitness)(candidate);if(newWitness.length>=witness.length-1e-5)continue;accepted=second.draft;break roots;
   }
  }
  let crosslinked=false;if(!accepted&&maximumBranches>4){accepted=crosslinkLongRoute(draft,moduleIds,straightRepair,prefix+pass,protectedRouteRooms,returnGuards);crosslinked=!!accepted;}
  if(!accepted)throw Object.assign(Error(`Нет безопасной двухкомнатной развилки для реального прохода${witness.length.toFixed(2)}м; проверено${checks} полных вариантов.`),{diagnosticDraft:structuredClone(draft)});
  draft=accepted;onProgress?.((crosslinked?'Поперечная связь с соседним сектором':'Настоящая ложная ветвь')+' разрывает длинный проход; модулей '+draft.layout.modules.length+'.');
 }
 const maze=freeMaze(draft,false),left=freeGroundRunWitness(maze),straight=freeGroundStraightWitness(maze);if(!pendingReturnLoop&&(left.length>16+1e-7||straight.length>8+1e-7))throw Error('После '+maximumBranches+' полноценных ветвей остались длины '+straight.length.toFixed(2)+'/'+left.length.toFixed(2)+'м.');return maze;
}
