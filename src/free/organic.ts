import {maximumSpanPlacement} from './span-placement';
import {freeGroundLengths,freeGrowthLengths,freeLengthLimits} from './path-limits';
import {seedFreeZones,type ZoneSeed} from './zones';
import {seedFreeBridges} from './bridge-generate';
import {seedBridgeRoute} from './bridge-route-seed';
import {bridgeRouteErrors} from './bridge-route';
import {portalPrivacy} from '../analysis/portal-privacy';
import {loopTraps} from '../analysis/loop-traps';
import {addPortalPocket} from './portal-pocket';
import {maximumConnectionGap} from './connection-span';
import {seedSwitchbacks} from './switchback-seed';
import {selectOppositePortals} from './opposite-portals';
import type { Maze, Parameters, Point } from '../core/maze';
import { DEFAULT_CONSTRUCTION, validateParameters } from '../core/maze';
import { random, shuffle } from '../core/random';
import { footprintSummary } from '../core/corridor-geometry';
import { anchorGeometry, connectionGeometry, freeMaze, modulePolygon, rooms, siteGeometry, validateFree,buildNavigation } from './layout';
import { centroid,distance, edges, ends, overlap, segmentInside } from './geometry';
import { emptyLayout, type Anchor, type FreeDraft, type FreeLayout, type FreeModule } from './model';
import { checkFreeQuality } from './quality';
/** Free growth from physical doorways: there are no row/column neighbour indices. */
export function generateOrganic(parameters: Parameters, previous?: Maze, onProgress?: (s: string) => void): Maze {
  validateParameters(parameters);
  if(parameters.freeRequiredBridgeCount&&parameters.freeZoneCount)throw Error('Автоматический подбор обязательных мостов пока доступен без зон.');
  const rng = random(parameters.seed), deadline = performance.now() + (parameters.freeRequiredBridgeCount?60000:20000), site = siteGeometry(parameters);
  const width = Math.min(parameters.corridorWidth, 1.6), area = footprintSummary(parameters).area;
  const requestedDegree = parameters.freeJunctionDegree ?? (parameters.freeRoutePattern==='switchbacks'?3:Math.min(parameters.columns, parameters.rows) >= 14 ? 5 : 3);
  const spread = parameters.freeAngleSpread ?? 100,requestedBridges=parameters.freeBridgeCount??0,requestedZones=parameters.freeZoneCount??0,structured=!!(requestedBridges||requestedZones||parameters.freeRoutePattern==='switchbacks');
  const maxBend = Math.min(spread / 2, Math.max(0, Math.acos(Math.min(1, 1.05 / width)) * 180 / Math.PI));
  const lengthLimits=freeLengthLimits(parameters),guardGrowth=!structured&&parameters.generationType!=='living';
  const maximumSpans=guardGrowth&&parameters.freeSpanPolicy==='maximum';
  const shortDecisions=!maximumSpans&&guardGrowth&&lengthLimits.straight<=4&&lengthLimits.run<=8;
  // Keep explicit orthogonal cards reproducible. Rotated cavity bases retain
  // the same substantial branching without inheriting the compact 4/8 gaps.
  const variedCavity=guardGrowth&&!!parameters.freeCavityMaze&&(parameters.freeAngleSpread??100)>0;
  const branchedGrowth=shortDecisions||variedCavity||maximumSpans;
  let last = 'На площадке не помещается выбранный перекрёсток.';
  for (let attempt = 0; attempt < 96 && performance.now() < deadline; attempt++) {
    onProgress?.(`Свободная сеть: кандидат ${attempt + 1}/96 · узел ${requestedDegree}`);
    const layout = emptyLayout(), rotation = requestedZones?(rng()-.5)*10:20+rng()*50, center = {x:parameters.columns/2,z:parameters.rows*(requestedZones ? .36 : .5)};
    if (attempt > 0&&!parameters.freeRequiredBridgeCount || !site.contains(center)) {
      center.x = parameters.columns * (.2 + rng() * .6);
      center.z = parameters.rows * (.2 + rng() * .6);
    }
    const draft: FreeDraft = { kind: 'maze-lab-free-draft', version: 1, parameters: { ...parameters, placementMode: 'free', moduleSize: 2 }, construction: previous ? { wallHeight: previous.wallHeight, wallColor: previous.wallColor, translucentFabric: previous.translucentFabric, roof: previous.roof } : { ...DEFAULT_CONSTRUCTION,...(parameters.freeRequiredBridgeCount||parameters.freeRoutePattern==='switchbacks'?{roof:true}:{}) }, layout };
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}-${counter++}`;
    let zones:ZoneSeed|undefined;
    let routeSeed:ReturnType<typeof seedBridgeRoute>|undefined;
    let switchbacks:ReturnType<typeof seedSwitchbacks>|undefined;
    if(parameters.freeRoutePattern==='switchbacks'){switchbacks=seedSwitchbacks(layout,center,rotation,width,parameters.freeConnectionSpan??3);if(validateFree(draft,false).length){last='На выбранной площадке не помещается переплетённый маршрут.';continue;}}
    else if(requestedZones){zones=seedFreeZones(layout,parameters,center,rotation,draft.construction.wallHeight,width);if(requestedBridges)draft.version=2;if(validateFree(draft,false).length){last='На выбранной форме не помещаются зоны с островами и лестницами.';continue;}}
    else if(requestedBridges){if(parameters.freeRequiredBridgeCount)routeSeed=seedBridgeRoute(layout,parameters,center,rotation,draft.construction.wallHeight,width);else seedFreeBridges(layout,requestedBridges,center,rotation,draft.construction.wallHeight,width);draft.version=2;const issues=validateFree(draft,false);if(issues.length){last=issues[0]!.message;continue;}}
    else if (requestedDegree === 5) {
      const radius = width / (2 * Math.sin(Math.PI / 5)) + .12, angle = rotation * Math.PI / 180;
      layout.spaces.push({ id: 'junction-5', kind: 'hall', polygon: Array.from({ length: 5 }, (_, i) => ({ x: center.x + radius * Math.cos(angle + i * 2 * Math.PI / 5), z: center.z + radius * Math.sin(angle + i * 2 * Math.PI / 5) })) });
    } else layout.modules.push({ id: 'junction-3', type: '2x2', ...center, angle: rotation });
    const slots = (): Anchor[] => rooms(layout).flatMap(room => room.polygon.flatMap((p, edge) => {
      const length = distance(p, room.polygon[(edge + 1) % room.polygon.length]!);
      const count = Math.max(1, Math.floor(length / (width + .4)));
      return Array.from({ length: count }, (_, i) => ({ room: room.id, edge, offset: (i - (count - 1) / 2) * length / count }));
    })).filter(anchor => !switchbacks?.protected.has(anchor.room)&&![...layout.connections,...layout.bridges??[]].some(c => [c.a, c.b].some(a => a.room === anchor.room && a.edge === anchor.edge && Math.abs(a.offset - anchor.offset) < (c.width + width) / 2 + .12)));
    const degree = (id: string) => [...layout.connections,...layout.bridges??[]].filter(c => c.a.room === id || c.b.room === id).length;
    let lastAdditionWasLength=false,lastAdditionGeometry:string|undefined;
    const validAddition = (module: FreeModule, connection: FreeLayout['connections'][number]): boolean => {
      lastAdditionWasLength=false;lastAdditionGeometry=undefined;
      const rejectGeometry=(reason:string)=>{lastAdditionGeometry=reason;return false;};
      const poly = modulePolygon(module);
      if(switchbacks&&!switchbacks.fits(poly))return rejectGeometry('Модуль выходит из области переплетённого маршрута.');
      if(routeSeed&&!parameters.shape&&poly.some(p=>p.x<8||p.z<8||p.x>parameters.columns-8||p.z>parameters.rows-8))return rejectGeometry('Модуль пересекает зарезервированную область.');
      if(routeSeed&&!routeSeed.fits(routeSeed.groups.get(connection.a.room)??'network',poly))return rejectGeometry('Модуль пересекает зарезервированную область.');
      const reservations=zones?.reservations??routeSeed?.reservations??switchbacks?.reservations??[];
      if(reservations.some(h=>overlap(poly,h)))return rejectGeometry('Модуль пересекает зарезервированную область.');
      const owner=zones?.owner(connection.a.room);
      if(zones&&(!owner||!zones.fits(owner.id,poly)||zones.reservations.some(h=>overlap(poly,h))))return rejectGeometry('Модуль пересекает зарезервированную область.');
      if (!poly.every(site.contains) || !edges(poly).every(w => segmentInside(...ends(w), site.contains, site.boundaries))) return rejectGeometry('Модуль выходит за границу площадки.');
      const collision=rooms(layout).find(r=>overlap(poly,r.polygon));
      if(collision)return rejectGeometry(`Модуль пересекает пространство ${collision.id}.`);
      if(owner)module.zone=owner.id;
      if(reservations.length){layout.modules.push(module);const polygon=connectionGeometry(layout,connection).polygon;layout.modules.pop();if(reservations.some(h=>overlap(polygon,h)))return rejectGeometry('Модуль пересекает зарезервированную область.');}
      layout.modules.push(module);
      layout.connections.push(connection);
      const issues = validateFree(draft, false);
      const blocked=routeSeed&&!issues.length&&buildNavigation(layout).paths.some(p=>p===null);
      let tooLong=false;
      if(guardGrowth&&!issues.length){try{const n=freeGrowthLengths(layout,module.id);// Reserve a metre for the future exterior opening. During a strict
      // fork transaction the first arm may temporarily span both future arms;
      // the completed map must still pass the explicit physical bounds.
      tooLong=n.straight>Math.max(0,lengthLimits.straight-1)+1e-7||n.run>Math.max(0,(branchedGrowth?Math.max(16,lengthLimits.run*2):lengthLimits.run-2))+1e-7;}catch{tooLong=true;}}
      layout.connections.pop();
      layout.modules.pop();
      lastAdditionWasLength=tooLong;
      if(issues.length)lastAdditionGeometry=issues[0]!.message+(issues[0]!.ids.length?' ('+issues[0]!.ids.join(', ')+')':'');
      if(blocked)lastAdditionGeometry='Нет физического прохода между модулями.';
      return !issues.length&&!blocked&&!tooLong;
    };
    const failedAttachments=new Set<string>(),attachmentKey=(a:Anchor,type:string)=>`${a.room}:${a.edge}:${a.offset}:${type}`;
    const attach = (anchor: Anchor, type: FreeModule['type'], tries = 20): boolean => {
      const key=attachmentKey(anchor,type);if((structured||branchedGrowth)&&failedAttachments.has(key))return false;
      let mayFitAfterBranching=false;
      if(maximumSpans){
        const a=anchorGeometry(layout,anchor,width),desired=parameters.freeConnectionSpan??3;
        const candidates:{module:FreeModule;connection:FreeLayout['connections'][number];gate:ReturnType<typeof anchorGeometry>}[]=[];
        for(let trial=0;trial<tries&&performance.now()<deadline;trial++){
          const incoming=Math.floor(rng()*4),bend=(rng()*2-1)*maxBend,localNormals=[-90,0,90,180];
          const angle=((Math.atan2(-a.normal.z,-a.normal.x)*180/Math.PI+bend-localNormals[incoming]!)%360+360)%360;
          const module:FreeModule={id:nextId('m'),type,x:0,z:0,angle},b={room:module.id,edge:incoming,offset:0};
          const gate=anchorGeometry({...emptyLayout(),modules:[module]},b,width);
          candidates.push({module,gate,connection:{id:nextId('c'),a:anchor,b,width}});
        }
        const selected=maximumSpanPlacement(candidates,desired,(candidate,span)=>{
          const gap=maximumConnectionGap(a,candidate.gate,span);
          if(gap<.1)return {ok:false,kind:'geometry',reason:'При этом повороте не помещается соединение.'};
          candidate.module.x=a.mid.x+a.normal.x*gap-candidate.gate.mid.x;
          candidate.module.z=a.mid.z+a.normal.z*gap-candidate.gate.mid.z;
          if(validAddition(candidate.module,candidate.connection))return {ok:true};
          mayFitAfterBranching ||= lastAdditionWasLength;
          return {ok:false,kind:lastAdditionWasLength?'length':'geometry',reason:lastAdditionGeometry??'Не выполнено ограничение длины прохода.'};
        },()=>performance.now()>=deadline);
        if(selected){
          const {module,connection}=selected.candidate;
          layout.modules.push(module);layout.connections.push(connection);
          const actual=Math.max(...connectionGeometry(layout,connection).sides.map(w=>distance(...ends(w))));
          connection.spanAudit={desired,actual,...(selected.reason?{reason:selected.reason}:{})};
          return true;
        }
        if(!mayFitAfterBranching)failedAttachments.add(key);
        return false;
      }
      for (let trial = 0; trial < tries && performance.now() < deadline; trial++) {
        const a = anchorGeometry(layout, anchor, width), incoming = shortDecisions&&type==='2x6'?2*Math.floor(rng()*2):Math.floor(rng() * 4), bend = (rng() * 2 - 1) * (zones?.owner(anchor.room)?.style==='winding'?Math.min(12,maxBend):maxBend);
        const localNormals = [-90, 0, 90, 180];
        const angle = ((Math.atan2(-a.normal.z, -a.normal.x) * 180 / Math.PI + bend - localNormals[incoming]!) % 360 + 360) % 360;
        const module: FreeModule = { id: nextId('m'), type, x: 0, z: 0, angle };
        const temporary: FreeLayout = { ...emptyLayout(), modules: [module] }, b = { room: module.id, edge: incoming, offset: 0 };
        const localGate=anchorGeometry(temporary,b,width),local=localGate.mid,sampledGap=variedCavity?1.4+rng()*1.4:shortDecisions?.65+rng()*.35:1.05+rng()*1.25,gap=parameters.freeConnectionSpan===undefined?(variedCavity?Math.min(sampledGap,maximumConnectionGap(a,localGate,3)):sampledGap):maximumConnectionGap(a,localGate,parameters.freeConnectionSpan);
        if(gap<.1)continue;
        module.x = a.mid.x + a.normal.x * gap - local.x;
        module.z = a.mid.z + a.normal.z * gap - local.z;
        const connection = { id: nextId('c'), a: anchor, b, width };
        if (!validAddition(module, connection)){mayFitAfterBranching ||= lastAdditionWasLength;continue;}
        layout.modules.push(module);
        layout.connections.push(connection);
        routeSeed?.inherit(module.id,anchor.room);
        return true;
      }
      if(structured||branchedGrowth&&!mayFitAfterBranching)failedAttachments.add(key);
      return false;
    };
    const hub = switchbacks?rooms(layout).find(r=>r.id===switchbacks!.hubId)!:zones?rooms(layout).find(r=>r.id===zones!.hubId)!:requestedBridges?rooms(layout).find(r=>r.id==='bridge-ground-detour')!:rooms(layout)[0]!, hubEdges = requestedDegree === 5 ? [0, 1, 2, 3, 4] : [0, 1, 3];
    let seedFits = true;
    if(structured){
      while(degree(hub.id)<requestedDegree){const anchor=slots().find(a=>a.room===hub.id&&attach(a,'2x2',24));if(!anchor){seedFits=false;break;}}
    }else for (const edge of hubEdges) if (!attach({ room: hub.id, edge, offset: 0 }, '2x2', 36)) {
      seedFits = false;
      break;
    }
    if (!seedFits) continue;
    if(routeSeed){
      if(!attach({room:'bridge-left-0',edge:3,offset:0},'2x6',48)){last='Не помещается начальная ветвь мостов.';onProgress?.(last);continue;}
      const rootGroup=routeSeed.groups.get(routeSeed.exitAnchor.room)!;routeSeed.groups.set(routeSeed.exitAnchor.room,'exit');
      const exitFits=attach(routeSeed.exitAnchor,'2x6',48);routeSeed.groups.set(routeSeed.exitAnchor.room,rootGroup);
      if(!exitFits){last='Не помещается конечная ветвь мостов.';onProgress?.(last);continue;}
      routeSeed.groups.set(layout.modules.at(-1)!.id,'exit');
      if(requestedBridges>1&&!attach({room:'bridge-underpass',edge:1,offset:routeSeed.underSideOffset},'2x2',80)){last='Не помещается развилка нижнего прохода.';onProgress?.(last);continue;}
      for(const ring of routeSeed.ringSides)if(!slots().filter(a=>a.room===ring.id).some(a=>attach(a,'2x2',24))){seedFits=false;break;}
      if(!seedFits){last='Не помещаются ветви возвратного кольца.';onProgress?.(last);continue;}
    }
    const target = Math.max(requestedDegree + 3,parameters.freeModuleTarget??Math.min(requestedZones?requestedZones*20+requestedZones-1:100, Math.round(area / 23)));
    if(switchbacks&&layout.modules.length>target)throw Error(`Для переплетённого маршрута нужно хотя бы ${layout.modules.length} модулей.`);
    let misses = 0;
    while (layout.modules.length < target && misses < 80 && performance.now() < deadline) {
      let candidates = shuffle(slots().filter(a => a.room !== hub.id&&(!shortDecisions||!layout.modules.some(m=>m.id===a.room&&m.type==='2x6'&&a.edge%2===1))&&(!branchedGrowth||degree(a.room)===1||target-layout.modules.length<4)&&(!branchedGrowth||!failedAttachments.has(attachmentKey(a,'fork')))&&(!(structured||branchedGrowth)||!failedAttachments.has(attachmentKey(a,'2x2'))||!failedAttachments.has(attachmentKey(a,'2x6')))), rng);
      if(zones)candidates=candidates.filter(a=>!!zones!.owner(a.room));
      if(routeSeed){const counts=new Map<string,number>();for(const m of layout.modules){const group=routeSeed.groups.get(m.id)!;counts.set(group,(counts.get(group)??0)+1);}const score=(a:Anchor)=>{const target=routeSeed!.target(routeSeed!.groups.get(a.room)!);if(!target)return 0;const g=anchorGeometry(layout,a,width);return distance({x:g.mid.x+g.normal.x*5,z:g.mid.z+g.normal.z*5},target);};candidates.sort((a,b)=>{const ga=routeSeed!.groups.get(a.room)!,gb=routeSeed!.groups.get(b.room)!;return ga===gb?score(a)-score(b):(counts.get(ga)??0)-(counts.get(gb)??0);});}
      // Establish a real three-door module as well as the requested central junction.
      const triple = layout.modules.find(m => degree(m.id) === 2);
      if(zones){
        const counts=new Map(layout.zones!.map(z=>[z.id,layout.modules.filter(m=>m.zone===z.id).length]));
        candidates.sort((a,b)=>{const za=zones!.owner(a.room)!,zb=zones!.owner(b.room)!,balance=counts.get(za.id)!-counts.get(zb.id)!;if(za.id!==zb.id)return balance||za.id.localeCompare(zb.id);if(za.style==='branching')return Number(degree(b.room)===2)-Number(degree(a.room)===2);if(za.style==='winding'){const last=[...layout.modules].reverse().find(m=>m.zone===za.id)?.id;return Number(b.room===last)-Number(a.room===last);}return degree(a.room)-degree(b.room);});
      }else if(routeSeed){/* Balanced physical growth around the required route. */}
      else if (!layout.modules.some(m => degree(m.id) >= 3) && triple) candidates.sort((a, b) => Number(b.room === triple.id) - Number(a.room === triple.id));
      else if (parameters.generationType === 'living') candidates.sort((a, b) => {
        const centre = (id: string) => {
          const m = layout.modules.find(m => m.id === id),p=m??centroid(rooms(layout).find(r=>r.id===id)!.polygon);
          return Math.hypot(p.x - center.x, p.z - center.z);
        };
        return centre(a.room) - centre(b.room);
      });
      else if(branchedGrowth){
        // Complete shallow side branches before making another branch. A small
        // one-room bud is deliberately not a decision in the physical guard.
        const shallow=new Set(layout.modules.filter(m=>m.type==='2x2'&&degree(m.id)===1).map(m=>m.id));
        const parent=(id:string)=>{const c=layout.connections.find(c=>c.a.room===id||c.b.room===id);return c?.a.room===id?c.b.room:c?.a.room;};
        const score=(id:string)=>shallow.has(id)&&degree(parent(id)??'')>=3?0:degree(id)===2?1:degree(id)===1?2:3;
        const newest=new Map(layout.modules.map((m,i)=>[m.id,i]));
        candidates.sort((a,b)=>score(a.room)-score(b.room)||(maximumSpans&&parameters.algorithm==='backtracker'?(newest.get(b.room)??-1)-(newest.get(a.room)??-1):0));
      }
      else if (parameters.algorithm === 'backtracker') {
        const last = layout.modules.at(-1)!.id;
        candidates.sort((a, b) => Number(b.room === last) - Number(a.room === last));
      }
      let added = false;
      const needLong = !layout.modules.some(m => m.type === '2x6');
      for (const a of candidates.slice(0, 16)) {
        if(branchedGrowth&&degree(a.room)===1&&target-layout.modules.length>=4){
          // Complete both multi-room arms atomically. Each elbow separates
          // a substantial branch from its sibling; tails keep the module mix.
          const modulesBefore=layout.modules.length,connectionsBefore=layout.connections.length,failedBefore=new Set(failedAttachments);
          const arm=(anchor:Anchor)=>{
            const nm=layout.modules.length,nc=layout.connections.length,oldFailures=new Set(failedAttachments);
            if(!attach(anchor,'2x2',8))return false;
            const elbow=layout.modules.at(-1)!.id;
            const tailType:FreeModule['type']=layout.modules.some(m=>m.type==='2x6')&&rng()>.25?'2x2':'2x6';
            if(shuffle(slots().filter(b=>b.room===elbow),rng).some(b=>attach(b,tailType,8)))return true;
            layout.modules.length=nm;layout.connections.length=nc;
            for(const key of failedAttachments)if(!oldFailures.has(key))failedAttachments.delete(key);
            return false;
          };
          if(!arm(a)){failedAttachments.add(attachmentKey(a,'fork'));continue;}
          const second=shuffle(slots().filter(b=>b.room===a.room),rng).some(arm);
          if(second){added=true;break;}
          layout.modules.length=modulesBefore;layout.connections.length=connectionsBefore;
          for(const key of failedAttachments)if(!failedBefore.has(key))failedAttachments.delete(key);
          failedAttachments.add(attachmentKey(a,'fork'));
          continue;
        }
        if (attach(a, needLong || (branchedGrowth?degree(a.room)<=2:rng()<.3) ? '2x6' : '2x2', 8)) {
          added = true;
          break;
        }
      }
      if (!added && needLong) for (const a of candidates.slice(0, 8)) if (attach(a, '2x2', 4)) {
        added = true;
        break;
      }
      if (added) misses = 0; else misses++;
      if(added&&layout.modules.length%8===0)onProgress?.(`Свободная планировка: ${layout.modules.length}/${target} модулей.`);
    }
    if(structured&&performance.now()>=deadline)throw Error(switchbacks?'Подбор переплетённой свободной планировки достиг лимита времени. Текущая карта сохранена.':'Поиск свободной планировки с мостами достиг лимита времени. Текущая карта сохранена.');
    if((switchbacks||parameters.freeModuleTarget!==undefined)&&layout.modules.length!==target){last='Не удалось разместить целевое число модулей.';continue;}
    if (layout.modules.length < requestedDegree + 2 || !layout.modules.some(m => m.type === '2x6')) {
      last = 'Не помещается смесь модулей вокруг перекрёстка.';
      continue;
    }
    // Join actual nearby free doorways. Physical crossing and span checks decide eligibility.
    const bridges=parameters.freeBridgeCount??0;
    let cycles = switchbacks?.cycles??routeSeed?.cycles??(bridges+(requestedZones?(parameters.freeIslandCount??requestedZones):0));
    while (cycles < parameters.extraConnections && performance.now() < deadline) {
      const free = slots(), candidates: { a: Anchor; b: Anchor; length: number }[] = [];
      for (let i = 0; i < free.length; i++)for (let j = i + 1; j < free.length; j++) {
        const a = free[i]!, b = free[j]!;
        if(routeSeed&&routeSeed.groups.get(a.room)!==routeSeed.groups.get(b.room))continue;
        if(zones&&(!zones.owner(a.room)||zones.owner(a.room)?.id!==zones.owner(b.room)?.id))continue;
        if (a.room === b.room || layout.connections.some(c => c.a.room === a.room && c.b.room === b.room || c.a.room === b.room && c.b.room === a.room)) continue;
        const g = connectionGeometry(layout, { id: 'probe', a, b, width }), length = Math.max(...g.sides.map(w => distance(...ends(w))));
        if (length <= 3 + 1e-7 && distance(g.a.mid, g.b.mid) > .1&&(!zones||!zones.reservations.some(h=>overlap(g.polygon,h)))) candidates.push({ a, b, length });
      }
      candidates.sort((a, b) => a.length - b.length);
      let joined = false;
      for (const candidate of candidates) {
        const c = { id: nextId('c'), a: candidate.a, b: candidate.b, width };
        layout.connections.push(c);
        if (!validateFree(draft, false).length) {
          joined = true;
          cycles++;
          break;
        }
        layout.connections.pop();
      }
      if (!joined) break;
    }
    if (cycles !== parameters.extraConnections) {
      last = 'Не удалось замкнуть заданное число циклов при пролётах до 3 м.';
      continue;
    }
    // An exterior room need not be a graph leaf. Restricting portals to leaves
    // can hide the actual opposite hull sides in zoned/looped constructions.
    const available = slots().filter(a => !routeSeed||['entrance','exit'].includes(routeSeed.groups.get(a.room)??'')).filter(a=>!shortDecisions||layout.connections.flatMap(c=>[c.a,c.b]).filter(b=>b.room===a.room).every(b=>distance(anchorGeometry(layout,a,width).mid,anchorGeometry(layout,b,width).mid)<=lengthLimits.straight+1e-7));
    if (available.length < 2) {
      last = 'Недостаточно свободных проёмов для входа и выхода.';
      continue;
    }
    const location = (a: Anchor): Point => anchorGeometry(layout, a, width).mid;
    let separation = 0;
    const pairs:{a:Anchor;b:Anchor;length:number;penalty:number}[]=[];
    for (const a of available) for (const b of available) {
      if (a.room === b.room || zones&&zones.owner(a.room)?.id===zones.owner(b.room)?.id) continue;
      if(routeSeed&&(routeSeed.groups.get(a.room)!=='entrance'||routeSeed.groups.get(b.room)!=='exit'))continue;
      const length = distance(location(a), location(b));
      if(routeSeed){const excess=(v:Anchor)=>{const g=anchorGeometry(layout,v,width);return Math.max(...rooms(layout).flatMap(r=>r.polygon.map(p=>(p.x-g.mid.x)*g.normal.x+(p.z-g.mid.z)*g.normal.z)));},x=excess(a),y=excess(b);if(x<=4&&y<=4)pairs.push({a,b,length,penalty:x+y});}
      if (length > separation) {
        separation = length;
      }
    }
    const choices=switchbacks?[{a:switchbacks.entrance,b:switchbacks.exit,length:separation,sideA:1,sideB:1}]:routeSeed?pairs.sort((a,b)=>a.penalty-b.penalty||b.length-a.length).slice(0,16).flatMap(p=>[[1,1],[1,-1],[-1,1],[-1,-1]].map(([sideA,sideB])=>({...p,sideA:sideA!,sideB:sideB!}))):selectOppositePortals(layout,available,width).filter(p=>!zones||zones.owner(p.a.room)?.id!==zones.owner(p.b.room)?.id).map(p=>({...p,sideA:1,sideB:1}));
    if(!choices.length){last='Нет наружных входа и выхода на противоположных сторонах конструкции.';if(shortDecisions)onProgress?.(last);continue;}
    if(routeSeed){last=choices.length?'Проверяем геометрию маршрута, кольцо и скрытность проёмов.':'Нет наружных проёмов в начальной и конечной ветвях.';onProgress?.(last);}
    for(const pair of choices){
    const spaceCount=layout.spaces.length,connectionCount=layout.connections.length,supportCount=layout.supports?.length;
    try{
    layout.openings = [{ id: 'entrance', ...pair.a, width }, { id: 'exit', ...pair.b, width }];
    layout.entrance = 'entrance';
    layout.exit = 'exit';
    if(routeSeed){layout.openings=[addPortalPocket(layout,pair.a,'entrance-pocket',width,pair.sideA),addPortalPocket(layout,pair.b,'exit-pocket',width,pair.sideB)];layout.entrance=layout.openings[0]!.id;layout.exit=layout.openings[1]!.id;}
    const issues = validateFree(draft);
    if (issues.length) {
      last = issues[0]!.message;
      if(shortDecisions&&pair===choices[0])onProgress?.(last);
      continue;
    }
    const maze = freeMaze(draft, false);
    if(routeSeed){const errors=bridgeRouteErrors(maze);if(errors.length){last=errors.join(' ');continue;}if(parameters.loopTrapCount&&loopTraps(maze).qualifiedCount<parameters.loopTrapCount){last='Кольцо пока не квалифицируется как возвратная ловушка.';continue;}if(![maze.entrance,maze.exit].every(p=>portalPrivacy(maze,p,3,false).certified)){last='Не удалось доказать скрытность обоих проёмов.';continue;}}
    if(guardGrowth){const n=freeGroundLengths(maze);if(n.straight>lengthLimits.straight+1e-7||n.run>lengthLimits.run+1e-7){last=`Не выполнен физический предел длины прохода: ${n.straight.toFixed(1)}/${n.run.toFixed(1)} м.`;if(shortDecisions&&pair===choices[0])onProgress?.(last);continue;}}
    const quality = checkFreeQuality(maze,{quick:true});
    if (quality.length) {
      last = quality.join(' ');
      continue;
    }
    if (previous?.environment) maze.environment = structuredClone(previous.environment);
    return maze;
    }finally{layout.spaces.length=spaceCount;layout.connections.length=connectionCount;if(supportCount===undefined)delete layout.supports;else layout.supports!.length=supportCount;}
    }
    if(routeSeed)onProgress?.(last);
  }
  throw Error(`Не удалось построить свободную сеть: ${last}`);
}
