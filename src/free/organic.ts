import {seedFreeZones,type ZoneSeed} from './zones';
import {seedFreeBridges} from './bridge-generate';
import type { Maze, Parameters, Point } from '../core/maze';
import { DEFAULT_CONSTRUCTION, validateParameters } from '../core/maze';
import { random, shuffle } from '../core/random';
import { footprintSummary } from '../core/corridor-geometry';
import { anchorGeometry, connectionGeometry, freeMaze, modulePolygon, rooms, siteGeometry, validateFree } from './layout';
import { centroid,distance, edges, ends, overlap, segmentInside } from './geometry';
import { emptyLayout, type Anchor, type FreeDraft, type FreeLayout, type FreeModule } from './model';
import { checkFreeQuality } from './quality';
/** Free growth from physical doorways: there are no row/column neighbour indices. */
export function generateOrganic(parameters: Parameters, previous?: Maze, onProgress?: (s: string) => void): Maze {
  validateParameters(parameters);
  const rng = random(parameters.seed), deadline = performance.now() + 20000, site = siteGeometry(parameters);
  const width = Math.min(parameters.corridorWidth, 1.6), area = footprintSummary(parameters).area;
  const requestedDegree = parameters.freeJunctionDegree ?? (Math.min(parameters.columns, parameters.rows) >= 14 ? 5 : 3);
  const spread = parameters.freeAngleSpread ?? 100,requestedBridges=parameters.freeBridgeCount??0,requestedZones=parameters.freeZoneCount??0,structured=!!(requestedBridges||requestedZones);
  const maxBend = Math.min(spread / 2, Math.max(0, Math.acos(Math.min(1, 1.05 / width)) * 180 / Math.PI));
  let last = 'На площадке не помещается выбранный перекрёсток.';
  for (let attempt = 0; attempt < 96 && performance.now() < deadline; attempt++) {
    onProgress?.(`Свободная сеть: кандидат ${attempt + 1}/96 · узел ${requestedDegree}`);
    const layout = emptyLayout(), rotation = requestedZones?(rng()-.5)*10:20+rng()*50, center = {x:parameters.columns/2,z:parameters.rows*(requestedZones ? .36 : .5)};
    if (attempt > 0 || !site.contains(center)) {
      center.x = parameters.columns * (.2 + rng() * .6);
      center.z = parameters.rows * (.2 + rng() * .6);
    }
    const draft: FreeDraft = { kind: 'maze-lab-free-draft', version: 1, parameters: { ...parameters, placementMode: 'free', moduleSize: 2 }, construction: previous ? { wallHeight: previous.wallHeight, wallColor: previous.wallColor, translucentFabric: previous.translucentFabric, roof: previous.roof } : { ...DEFAULT_CONSTRUCTION }, layout };
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}-${counter++}`;
    let zones:ZoneSeed|undefined;
    if(requestedZones){zones=seedFreeZones(layout,parameters,center,rotation,draft.construction.wallHeight,width);if(requestedBridges)draft.version=2;if(validateFree(draft,false).length){last='На выбранной форме не помещаются зоны с островами и лестницами.';continue;}}
    else if(requestedBridges){seedFreeBridges(layout,requestedBridges,center,rotation,draft.construction.wallHeight,width);draft.version=2;if(validateFree(draft,false).length){last='На выбранной форме не помещаются лестницы и нижние проходы мостов.';continue;}}
    else if (requestedDegree === 5) {
      const radius = width / (2 * Math.sin(Math.PI / 5)) + .12, angle = rotation * Math.PI / 180;
      layout.spaces.push({ id: 'junction-5', kind: 'hall', polygon: Array.from({ length: 5 }, (_, i) => ({ x: center.x + radius * Math.cos(angle + i * 2 * Math.PI / 5), z: center.z + radius * Math.sin(angle + i * 2 * Math.PI / 5) })) });
    } else layout.modules.push({ id: 'junction-3', type: '2x2', ...center, angle: rotation });
    const slots = (): Anchor[] => rooms(layout).flatMap(room => room.polygon.flatMap((p, edge) => {
      const length = distance(p, room.polygon[(edge + 1) % room.polygon.length]!);
      const count = Math.max(1, Math.floor(length / (width + .4)));
      return Array.from({ length: count }, (_, i) => ({ room: room.id, edge, offset: (i - (count - 1) / 2) * length / count }));
    })).filter(anchor => ![...layout.connections,...layout.bridges??[]].some(c => [c.a, c.b].some(a => a.room === anchor.room && a.edge === anchor.edge && Math.abs(a.offset - anchor.offset) < (c.width + width) / 2 + .12)));
    const degree = (id: string) => [...layout.connections,...layout.bridges??[]].filter(c => c.a.room === id || c.b.room === id).length;
    const validAddition = (module: FreeModule, connection: FreeLayout['connections'][number]): boolean => {
      const poly = modulePolygon(module);
      const owner=zones?.owner(connection.a.room);
      if(zones&&(!owner||!zones.fits(owner.id,poly)||zones.reservations.some(h=>overlap(poly,h))))return false;
      if (!poly.every(site.contains) || !edges(poly).every(w => segmentInside(...ends(w), site.contains, site.boundaries))) return false;
      if (rooms(layout).some(r => overlap(poly, r.polygon))) return false;
      if(owner)module.zone=owner.id;
      if(zones){layout.modules.push(module);const polygon=connectionGeometry(layout,connection).polygon;layout.modules.pop();if(zones.reservations.some(h=>overlap(polygon,h)))return false;}
      layout.modules.push(module);
      layout.connections.push(connection);
      const issues = validateFree(draft, false);
      layout.connections.pop();
      layout.modules.pop();
      return !issues.length;
    };
    const failedAttachments=new Set<string>(),attachmentKey=(a:Anchor,type:string)=>`${a.room}:${a.edge}:${a.offset}:${type}`;
    const attach = (anchor: Anchor, type: FreeModule['type'], tries = 20): boolean => {
      const key=attachmentKey(anchor,type);if(structured&&failedAttachments.has(key))return false;
      for (let trial = 0; trial < tries && performance.now() < deadline; trial++) {
        const a = anchorGeometry(layout, anchor, width), incoming = Math.floor(rng() * 4), bend = (rng() * 2 - 1) * (zones?.owner(anchor.room)?.style==='winding'?Math.min(12,maxBend):maxBend);
        const localNormals = [-90, 0, 90, 180];
        const angle = ((Math.atan2(-a.normal.z, -a.normal.x) * 180 / Math.PI + bend - localNormals[incoming]!) % 360 + 360) % 360;
        const module: FreeModule = { id: nextId('m'), type, x: 0, z: 0, angle };
        const temporary: FreeLayout = { ...emptyLayout(), modules: [module] }, b = { room: module.id, edge: incoming, offset: 0 };
        const local = anchorGeometry(temporary, b, width).mid, gap = 1.05 + rng() * 1.25;
        module.x = a.mid.x + a.normal.x * gap - local.x;
        module.z = a.mid.z + a.normal.z * gap - local.z;
        const connection = { id: nextId('c'), a: anchor, b, width };
        if (!validAddition(module, connection)) continue;
        layout.modules.push(module);
        layout.connections.push(connection);
        return true;
      }
      if(structured)failedAttachments.add(key);
      return false;
    };
    const hub = zones?rooms(layout).find(r=>r.id===zones!.hubId)!:requestedBridges?rooms(layout).find(r=>r.id==='bridge-ground-detour')!:rooms(layout)[0]!, hubEdges = requestedDegree === 5 ? [0, 1, 2, 3, 4] : [0, 1, 3];
    let seedFits = true;
    if(structured){
      while(degree(hub.id)<requestedDegree){const anchor=slots().find(a=>a.room===hub.id&&attach(a,'2x2',24));if(!anchor){seedFits=false;break;}}
    }else for (const edge of hubEdges) if (!attach({ room: hub.id, edge, offset: 0 }, '2x2', 36)) {
      seedFits = false;
      break;
    }
    if (!seedFits) continue;
    const target = Math.max(requestedDegree + 3, Math.min(requestedZones?requestedZones*20+requestedZones-1:100, Math.round(area / 23)));
    let misses = 0;
    while (layout.modules.length < target && misses < 80 && performance.now() < deadline) {
      let candidates = shuffle(slots().filter(a => a.room !== hub.id&&(!structured||!failedAttachments.has(attachmentKey(a,'2x2'))||!failedAttachments.has(attachmentKey(a,'2x6')))), rng);
      if(zones)candidates=candidates.filter(a=>!!zones!.owner(a.room));
      // Establish a real three-door module as well as the requested central junction.
      const triple = layout.modules.find(m => degree(m.id) === 2);
      if(zones){
        const counts=new Map(layout.zones!.map(z=>[z.id,layout.modules.filter(m=>m.zone===z.id).length]));
        candidates.sort((a,b)=>{const za=zones!.owner(a.room)!,zb=zones!.owner(b.room)!,balance=counts.get(za.id)!-counts.get(zb.id)!;if(za.id!==zb.id)return balance||za.id.localeCompare(zb.id);if(za.style==='branching')return Number(degree(b.room)===2)-Number(degree(a.room)===2);if(za.style==='winding'){const last=[...layout.modules].reverse().find(m=>m.zone===za.id)?.id;return Number(b.room===last)-Number(a.room===last);}return degree(a.room)-degree(b.room);});
      }else if (!layout.modules.some(m => degree(m.id) >= 3) && triple) candidates.sort((a, b) => Number(b.room === triple.id) - Number(a.room === triple.id));
      else if (parameters.generationType === 'living') candidates.sort((a, b) => {
        const centre = (id: string) => {
          const m = layout.modules.find(m => m.id === id),p=m??centroid(rooms(layout).find(r=>r.id===id)!.polygon);
          return Math.hypot(p.x - center.x, p.z - center.z);
        };
        return centre(a.room) - centre(b.room);
      });
      else if (parameters.algorithm === 'backtracker') {
        const last = layout.modules.at(-1)!.id;
        candidates.sort((a, b) => Number(b.room === last) - Number(a.room === last));
      }
      let added = false;
      const needLong = !layout.modules.some(m => m.type === '2x6');
      for (const a of candidates.slice(0, 16)) {
        if (attach(a, needLong || rng() < .3 ? '2x6' : '2x2', 8)) {
          added = true;
          break;
        }
      }
      if (!added && needLong) for (const a of candidates.slice(0, 8)) if (attach(a, '2x2', 4)) {
        added = true;
        break;
      }
      if (added) misses = 0; else misses++;
    }
    if(structured&&performance.now()>=deadline)throw Error('Поиск свободной планировки с мостами достиг лимита времени. Текущая карта сохранена.');
    if (layout.modules.length < requestedDegree + 2 || !layout.modules.some(m => m.type === '2x6')) {
      last = 'Не помещается смесь модулей вокруг перекрёстка.';
      continue;
    }
    // Join actual nearby free doorways. Physical crossing and span checks decide eligibility.
    const bridges=parameters.freeBridgeCount??0;
    let cycles = bridges+(requestedZones?(parameters.freeIslandCount??requestedZones):0);
    while (cycles < parameters.extraConnections && performance.now() < deadline) {
      const free = slots(), candidates: { a: Anchor; b: Anchor; length: number }[] = [];
      for (let i = 0; i < free.length; i++)for (let j = i + 1; j < free.length; j++) {
        const a = free[i]!, b = free[j]!;
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
    const leaves = rooms(layout).filter(r => degree(r.id) === 1), available = slots().filter(a => leaves.some(r => r.id === a.room));
    if (available.length < 2) {
      last = 'Недостаточно свободных проёмов для входа и выхода.';
      continue;
    }
    const location = (a: Anchor): Point => anchorGeometry(layout, a, width).mid;
    let first = available[0]!, lastAnchor = available[1]!, separation = 0;
    for (const a of available) for (const b of available) {
      if (a.room === b.room || zones&&zones.owner(a.room)?.id===zones.owner(b.room)?.id) continue;
      const length = distance(location(a), location(b));
      if (length > separation) {
        separation = length;
        first = a;
        lastAnchor = b;
      }
    }
    layout.openings = [{ id: 'entrance', ...first, width }, { id: 'exit', ...lastAnchor, width }];
    layout.entrance = 'entrance';
    layout.exit = 'exit';
    const issues = validateFree(draft);
    if (issues.length) {
      last = issues[0]!.message;
      continue;
    }
    const maze = freeMaze(draft, false), quality = checkFreeQuality(maze);
    if (quality.length) {
      last = quality.join(' ');
      continue;
    }
    if (previous?.environment) maze.environment = structuredClone(previous.environment);
    return maze;
  }
  throw Error(`Не удалось построить свободную сеть: ${last}`);
}
