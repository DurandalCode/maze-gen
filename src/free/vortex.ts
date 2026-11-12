import{generateVortexHybrid}from'./vortex-hybrid';
import {carveContinuousVortex} from './vortex-continuous';
import {continuousVortexStructure} from './vortex-continuous-structure';
import {vortexDistrictStructure} from './vortex-district-structure';
import {deepenVortexRegions} from './vortex-regions';
import {carveChaoticVortex} from './vortex-chaos';
import {carveVortexKnots} from './vortex-knots';
import {carveCentralVortex} from './vortex-center';
import {stabilizeVortexConnections} from './vortex-clearance';
import {carveVortexTraps} from './vortex-traps';
import {routeTraps} from '../analysis/route-traps';
import {loopTraps} from '../analysis/loop-traps';
import {DEFAULT_CONSTRUCTION,type Maze,type Parameters} from '../core/maze';
import {random,shuffle} from '../core/random';
import {area,distance,ends,overlap,segmentDistance} from './geometry';
import {buildNavigation,connectionGeometry,freeMaze,modulePolygon,validateFree} from './layout';
import {emptyLayout,type FreeConnection,type FreeDraft,type FreeLayout} from './model';
import {selectOppositePortals} from './opposite-portals';
import {freeGroundLengths,freeLayoutLengths,freeLengthLimits} from './path-limits';

/** Four interlaced Archimedean arms. Each step changes radius and heading;
 * crossroads connect real module faces across adjacent turns. */
export function generateVortex(parameters:Parameters,previous?:Maze,progress?:(message:string)=>void):Maze {
 const target=parameters.freeModuleTarget??96,count=target/4;
 const onKnotProgress=(m:string)=>progress?.(m.replace('vortex-knot-entry','Входной перекрёсток').replace('vortex-knot-winding','Поворотный перекрёсток').replace('vortex-knot-braid','Боковой перекрёсток').replace('vortex-knot-return','Дальний перекрёсток').replace('vortex-knot-offset','Смещённый перекрёсток'));
 if(!Number.isInteger(count)||count<20)throw Error('Вортекс: число модулей — 80, 84, 88 и далее с шагом 4.');
 const chaotic=!!parameters.freeVortexChaotic,knotted=!!parameters.freeVortexKnots&&!chaotic,central=!!parameters.freeVortexCenter||knotted||chaotic,traps=!!(parameters.routeTrapCount||parameters.loopTrapCount||central);
 if((parameters.routeTrapCount??0)>(central?2:1)||(parameters.loopTrapCount??0)>(central?2:1))throw Error('Вортекс: первая версия поддерживает один комплект из тупиковой и возвратной кольцевой ловушки.');
 if(parameters.freeCavityMaze||(parameters.freeBridgeCount??0)||(parameters.freeZoneCount??0)||(parameters.freeInfillPassages??0))throw Error('Вортекс строит собственную сеть спиралей; отключите заполнение пустот, мосты, зоны и дополнительные полосы.');
 if(parameters.freeConnectionSpan!==undefined&&Math.abs(parameters.freeConnectionSpan-3)>1e-8)throw Error('Вортекс: текущая конструкция рассчитана на целевой пролёт 3 м.');
 const rng=random(parameters.seed+'|vortex-v2'),width=Math.min(parameters.corridorWidth,1.6),layout=emptyLayout(),pitch=16/(2*Math.PI),cx=traps?30:parameters.columns/2,cz=traps?30:parameters.rows/2;
 const module=(arm:number,j:number,t:number)=>{const r=5+pitch*t,a=arm*Math.PI/2+t;return{id:`spiral${arm}-${j}`,type:'2x2' as const,x:cx+r*Math.cos(a),z:cz+r*Math.sin(a),angle:(a+Math.atan2(r,pitch))*180/Math.PI};};
 progress?.('Вортекс: четыре спирали из настоящих повёрнутых рам.');
 for(let arm=0;arm<4;arm++){
  let t=0;for(let j=0;j<count;j++){
   const m=module(arm,j,t);layout.modules.push(m);if(j===count-1)break;
   let lo=.001,hi=2;for(let k=0;k<45;k++){const next=module(arm,j+1,t+(lo+hi)/2),g=connectionGeometry({...emptyLayout(),modules:[m,next]},{id:'probe',a:{room:m.id,edge:1,offset:0},b:{room:next.id,edge:3,offset:0},width});if(Math.max(...g.sides.map(w=>distance(...ends(w))))>3)hi=(lo+hi)/2;else lo=(lo+hi)/2;}
   t+=(lo+hi)/2;layout.connections.push({id:`arm-${arm}-${j}`,a:{room:m.id,edge:1,offset:0},b:{room:`spiral${arm}-${j+1}`,edge:3,offset:0},width});
  }
 }
 const candidates:{c:FreeConnection;span:number}[]=[];
 for(const a of layout.modules)for(const b of layout.modules){
  if(a.id>=b.id||a.id.split('-')[0]===b.id.split('-')[0]||Math.hypot(a.x-b.x,a.z-b.z)>7)continue;
  for(const ea of [0,2])for(const eb of [0,2])for(const oa of [0,-.18,.18])for(const ob of [0,-.18,.18]){
   const c:FreeConnection={id:`cross-${a.id}-${b.id}-${ea}-${eb}-${oa}-${ob}`,a:{room:a.id,edge:ea,offset:oa},b:{room:b.id,edge:eb,offset:ob},width},g=connectionGeometry(layout,c),span=Math.max(...g.sides.map(w=>distance(...ends(w))));
   if(span>3+1e-7||area(g.polygon)<.01)continue;
   if(Math.min(segmentDistance(g.a.from,g.sides[0]!),segmentDistance(g.a.to,g.sides[1]!),segmentDistance(g.b.from,g.sides[1]!),segmentDistance(g.b.to,g.sides[0]!))<1)continue;
   const v={x:g.b.mid.x-g.a.mid.x,z:g.b.mid.z-g.a.mid.z};if(v.x*g.a.normal.x+v.z*g.a.normal.z<=0||-v.x*g.b.normal.x-v.z*g.b.normal.z<=0)continue;
   if(layout.modules.some(m=>overlap(g.polygon,modulePolygon(m))))continue;candidates.push({c,span});
  }
 }
 candidates.sort((a,b)=>central?Math.round(b.span*1e9)-Math.round(a.span*1e9):b.span-a.span);
 const used=(room:string,edge:number)=>layout.connections.some(q=>q.a.room===room&&q.a.edge===edge||q.b.room===room&&q.b.edge===edge);
 for(const {c,span}of candidates){
  if(used(c.a.room,c.a.edge)||used(c.b.room,c.b.edge))continue;const p=connectionGeometry(layout,c).polygon;if(layout.connections.some(q=>overlap(p,connectionGeometry(layout,q).polygon)))continue;
  c.spanAudit={desired:3,actual:span,...(span<3-1e-6?{reason:'Замыкание спиралей между существующими рамами; длину ограничивают реальные точки крепления.'}:{})};layout.connections.push(c);
 }
 const anchors=layout.modules.flatMap(m=>[0,1,2,3].filter(edge=>!used(m.id,edge)).map(edge=>({room:m.id,edge,offset:0}))),portals=selectOppositePortals(layout,anchors,width)[0];if(!portals)throw Error('Вортекс: не найдены противоположные наружные порталы.');
 layout.openings=[{id:'entrance',...portals.a,width},{id:'exit',...portals.b,width}];layout.entrance='entrance';layout.exit='exit';layout.moduleConstruction={version:1,spans:[]};
 const original=knotted||chaotic?structuredClone(layout):undefined;
 let mutable=central?carveCentralVortex(layout,width,parameters.corridorWidth):traps?carveVortexTraps(layout,width):undefined;
 if(chaotic){carveChaoticVortex(layout,original!,parameters.corridorWidth,random(parameters.seed+'|chaos-v1'),progress);mutable=new Set();}
 if(parameters.freeVortexContinuous)carveContinuousVortex(layout,parameters);
 if(parameters.freeVortexDeepRegions)deepenVortexRegions(layout,parameters.corridorWidth,progress);
 if(knotted)mutable=carveVortexKnots(layout,original!,parameters.corridorWidth,onKnotProgress,random(parameters.seed+'|knots-v1'));
 progress?.(knotted?'Вортекс: внутренние возвраты и распределённые косые узлы.':traps?'Вортекс: возвратное кольцо и длинная ложная ветвь.':'Вортекс: выборочные перекрёстки между спиралями.');
 const limits=freeLengthLimits(parameters),cycles=()=>layout.connections.length-layout.modules.length+1;
 // Preserve the winding arms, carve only crossovers. Every accepted closure
 // keeps connected physical alternatives and passes actual doorway lengths.
 for(const c of shuffle(layout.connections.filter(c=>c.id.startsWith('cross-')&&(!mutable||mutable.has(c.id))),rng)){
  if(cycles()<=parameters.extraConnections)break;const index=layout.connections.indexOf(c);layout.connections.splice(index,1);
  if(!connected(layout)){layout.connections.splice(index,0,c);continue;}
  const n=freeLayoutLengths(layout);if(n.straight>limits.straight+1e-7||n.run>limits.run+1e-7)layout.connections.splice(index,0,c);
 }
 if(traps)stabilizeVortexConnections(layout,parameters.corridorWidth,central);
 if(cycles()!==parameters.extraConnections)throw Error(`Вортекс: осталось ${cycles()} циклов при данных пределах. Измените число дополнительных соединений; спирали не уплотнялись.`);
 // Rotate the completed native structure, keeping seeded carving independent
 // of floating-point sorting ties introduced by a global orientation change.
 const rotation=rng()*Math.PI*2;for(const m of layout.modules){const x=m.x-cx,z=m.z-cz;m.x=parameters.columns/2+x*Math.cos(rotation)-z*Math.sin(rotation);m.z=parameters.rows/2+x*Math.sin(rotation)+z*Math.cos(rotation);m.angle+=rotation*180/Math.PI;}
 if(layout.modules.some(m=>modulePolygon(m).some(p=>p.x<0||p.z<0||p.x>parameters.columns||p.z>parameters.rows)))throw Error('Вортекс не помещается на площадке. Для 96 модулей нужна площадка около 60×60 м.');
 if(central&&!selectOppositePortals(layout,layout.openings,width).length)throw Error('Ветви вышли за наружные опорные плоскости входа/выхода.');
 const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{...parameters},construction:{...(previous?{wallHeight:previous.wallHeight,wallColor:previous.wallColor,translucentFabric:previous.translucentFabric}:DEFAULT_CONSTRUCTION),roof:true},layout};
 const issues=validateFree(draft);if(issues.length){const ids=issues[0]!.code==='clearance'?buildNavigation(layout).paths.flatMap((path,i)=>path?[]:[layout.connections[i]?.id??'portal']):issues[0]!.ids;throw Error('Вортекс: '+issues[0]!.message+' '+ids.join(', '));}
 let maze=freeMaze(draft,false);const lengths=freeGroundLengths(maze);if(lengths.straight>limits.straight+1e-7||lengths.run>limits.run+1e-7)throw Error(`Вортекс: физические длины ${lengths.straight.toFixed(2)}/${lengths.run.toFixed(2)} м превышают пределы; добавьте настоящие поперечные связи.`);
 if(traps&&(!knotted||(parameters.routeTrapCount??0)>0||(parameters.loopTrapCount??0)>0)){progress?.('Вортекс: проверяем квалифицированные Л/К, без рейтинга сложности.');const dead=routeTraps(maze),loops=loopTraps(maze);if(dead.qualifiedCount<(parameters.routeTrapCount??0)||loops.qualifiedCount<(parameters.loopTrapCount??0))throw Error(`Вортекс не подтвердил требуемые ловушки: Л${dead.qualifiedCount}, К${loops.qualifiedCount}.`);progress?.(knotted?`Вортекс: по критериям модели Л${dead.qualifiedCount} и К${loops.qualifiedCount}; ориентационные узлы построены.`:`Вортекс: подтверждены Л${dead.qualifiedCount} и К${loops.qualifiedCount}.`);}
 if(knotted)progress?.('Вортекс: разнесённые перекрёстки готовы.');
 if(parameters.freeVortexDeepRegions&&vortexDistrictStructure(maze).some(d=>d.doorsAtFork!==2||d.containsEntrance||d.containsExit||d.independentInnerCycles<3||d.internalJunctions<6||d.deepestJunction<15))throw Error('Не подтверждена внутренняя глубина возвратных районов.');
 if(parameters.freeVortexContinuous){const report=continuousVortexStructure(maze);if(report.loops.some(l=>!l.allInteriorDegreesTwo||l.doorsAtFork!==2||l.deadEnds.length||l.internalJunctions||l.forkVisibleAfterTwoRoomsFromEitherDoor.some(Boolean))||report.realRouteFragments.filter(f=>f.length>=28&&f.turnsOver20>=10).length<3)throw Error('Не подтверждены чистые петли и сходный непрерывный правильный путь.');}
 if(parameters.freeVortexHybrid)maze=generateVortexHybrid(maze,progress);
 if(previous?.environment)maze.environment=structuredClone(previous.environment);return maze;
}
function connected(l:FreeLayout){const seen=new Set([l.modules[0]!.id]),queue=[l.modules[0]!.id];for(const at of queue)for(const c of l.connections){const to=c.a.room===at?c.b.room:c.b.room===at?c.a.room:undefined;if(to&&!seen.has(to)){seen.add(to);queue.push(to);}}return seen.size===l.modules.length;}
