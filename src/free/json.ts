import {validCavityReport,validSpanAudit} from './cavity-report-validation';
import { DEFAULT_CONSTRUCTION, validateConstruction, validateParameters, type Maze } from '../core/maze';
import { freeMaze } from './layout';
import { validateEnvironment } from '../core/environment';
import type { FreeDraft } from './model';
export function mazeDraft(maze: Maze): FreeDraft {
  return { kind: 'maze-lab-free-draft', version: maze.free!.bridges?.length?2:1, parameters: structuredClone(maze.parameters), ...(maze.environment ? { environment: structuredClone(maze.environment) } : {}), construction: { wallHeight: maze.wallHeight, wallColor: maze.wallColor, translucentFabric: maze.translucentFabric, ...(maze.fabricTransmissionStrength===undefined?{}:{fabricTransmissionStrength:maze.fabricTransmissionStrength}), roof: maze.roof }, layout: structuredClone(maze.free!) };
}
function inspect(d: FreeDraft,sourceDepth=0): void {
  if (!d || d.kind !== 'maze-lab-free-draft' || ![1,2].includes(d.version) || d.parameters?.placementMode !== 'free') throw Error('Некорректный свободный черновик.');
  validateParameters(d.parameters);
  if (d.environment) validateEnvironment(d.environment);
  validateConstruction(d.construction);
  const l = d.layout;
  if (!l || ![l.modules, l.spaces, l.connections, l.openings, l.walls].every(Array.isArray) || l.modules.length > 2500 || l.spaces.length > 10000 || l.connections.length > 20000 || l.walls.length > 100000 || l.openings.length > 10000 || typeof l.entrance !== 'string' || typeof l.exit !== 'string') throw Error('Некорректная структура размещения.');
  if(l.postRouteSource!==undefined){if(sourceDepth)throw Error('Вложенный источник финального заполнения не поддерживается.');inspect(l.postRouteSource,sourceDepth+1);}
  if(l.zones!==undefined&&(!Array.isArray(l.zones)||l.zones.length>100||l.zones.some(z=>!z||typeof z.id!=='string'||typeof z.title!=='string'||z.title.length>200||!['branching','braided','winding'].includes(z.style))||new Set(l.zones.map(z=>z.id)).size!==l.zones.length))throw Error('Некорректные зоны.');
  if([...l.modules,...l.spaces].some(m=>m.zone!==undefined&&(!l.zones?.some(z=>z.id===m.zone))))throw Error('Неизвестная зона пространства.');
  if(l.bridges!==undefined&&(!Array.isArray(l.bridges)||l.bridges.length>100||l.bridges.length>0&&d.version!==2))throw Error('Некорректный список мостов.');
  for(const supports of [l.supports,l.preservedSupports])if (supports !== undefined && (!Array.isArray(supports) || supports.length > 100000 || supports.some(p => !p || ![p.x, p.z].every(Number.isFinite)))) throw Error('Некорректные опоры.');
  if (l.preservedPanels !== undefined && (!Array.isArray(l.preservedPanels) || l.preservedPanels.length > 100000)) throw Error('Некорректные сохранённые панели.');
  if(l.cavityReport!==undefined&&!validCavityReport(l.cavityReport))throw Error('Некорректный отчёт использования пустот.');
  if(l.moduleConstruction!==undefined&&(!l.moduleConstruction||l.moduleConstruction.version!==1||!Array.isArray(l.moduleConstruction.spans)||l.moduleConstruction.spans.length>20000||l.moduleConstruction.spans.some(c=>!c||typeof c.id!=='string'||!Number.isFinite(c.width)||[c.a,c.b].some(a=>!a||typeof a.room!=='string'||!Number.isInteger(a.edge)||!Number.isFinite(a.offset)))))throw Error('Некорректные модульные источники стен.');
  const all = [...l.modules, ...l.spaces, ...l.connections, ...l.openings, ...l.walls, ...l.bridges??[]];
  if (all.some(v => !v || typeof v.id !== 'string' || v.id.length > 100) || new Set(all.map(v => v.id)).size !== all.length) throw Error('Некорректные идентификаторы.');
  for (const m of l.modules) if (m.frameOnly!==undefined&&typeof m.frameOnly!=='boolean'||!['2x2', '2x6', 'custom'].includes(m.type) || ![m.x, m.z, m.angle].every(Number.isFinite) || m.type === 'custom' && (![m.width, m.depth].every(v => typeof v === 'number' && Number.isFinite(v)))) throw Error('Некорректный модуль.');
  for(const c of [...l.connections,...l.bridges??[],...l.moduleConstruction?.spans??[]])if(c.spanAudit!==undefined&&!validSpanAudit(c.spanAudit))throw Error('Некорректный аудит пролёта.');
  for (const c of [...l.connections,...l.bridges??[]]) for (const a of [c.a, c.b]) if (!a || typeof a.room !== 'string' || !Number.isInteger(a.edge) || !Number.isFinite(a.offset) || !Number.isFinite(c.width)) throw Error('Некорректная связь.');
  for (const o of l.openings) if (typeof o.room !== 'string' || !Number.isInteger(o.edge) || ![o.offset, o.width].every(Number.isFinite)) throw Error('Некорректный проём.');
  for (const s of l.spaces) {
    if (!['hall', 'corridor'].includes(s.kind) || !Array.isArray(s.polygon) || s.polygon.length > 10000 || s.holes !== undefined && !Array.isArray(s.holes)) throw Error('Некорректное пространство.');
    for (const poly of [s.polygon, ...s.holes ?? []]) if (!Array.isArray(poly) || poly.length < 3 || poly.some(p => !p || ![p.x, p.z].every(Number.isFinite))) throw Error('Некорректный полигон.');
  }
  for (const w of [...l.walls, ...l.preservedPanels ?? []]) if (!w || ![w.x1, w.z1, w.x2, w.z2].every(Number.isFinite)) throw Error('Некорректная стена.');
}
export function decodeDraft(text: string): FreeDraft {
  if (text.length > 5_000_000) throw Error('Файл больше 5 МБ.');
  const d = JSON.parse(text) as FreeDraft;
  inspect(d);
  return d;
}
export function encodeDraft(d: FreeDraft): string {
  inspect(d);
  return JSON.stringify(d, null, 2);
}
export function freeWire(maze: Maze): Record<string, unknown> {
  const d = mazeDraft(maze);
  return { version: maze.free!.bridges?.length?7:5, parameters: d.parameters, layout: d.layout, ...d.construction, ...(maze.environment ? { environment: maze.environment } : {}) };
}
export function decodeFree(value: Record<string, unknown>): Maze {
  const d = { kind: 'maze-lab-free-draft', version: value.version===7?2:1, parameters: value.parameters, layout: value.layout ?? value.free, construction: { ...DEFAULT_CONSTRUCTION, wallHeight: value.wallHeight, wallColor: value.wallColor, translucentFabric: value.translucentFabric, ...(value.fabricTransmissionStrength===undefined?{}:{fabricTransmissionStrength:value.fabricTransmissionStrength}), roof: value.roof } } as FreeDraft;
  inspect(d);
  const maze = freeMaze(d);
  if(maze.version!==value.version)throw Error('Версия карты не соответствует мостам.');
  if (value.environment !== undefined) {
    validateEnvironment(value.environment as NonNullable<Maze['environment']>);
    maze.environment = value.environment as Maze['environment'];
  }
  return maze;
}
export function freeIdentity(maze: Maze): unknown {
  const l = structuredClone(maze.free!);
  delete l.postRouteSource;
  delete l.zones;
  delete l.cavityReport;
  delete l.moduleConstruction;
  for(const connection of [...l.connections,...l.bridges??[]])delete connection.spanAudit;
  for(const room of [...l.modules,...l.spaces])delete room.zone;
  l.modules.sort((a, b) => a.id.localeCompare(b.id));
  l.spaces.sort((a, b) => a.id.localeCompare(b.id));
  l.connections.sort((a, b) => a.id.localeCompare(b.id));
  l.openings.sort((a, b) => a.id.localeCompare(b.id));
  l.bridges?.sort((a,b)=>a.id.localeCompare(b.id));
  l.walls.sort((a, b) => a.id.localeCompare(b.id));
  return { version: maze.free!.bridges?.length?7:5, width: maze.width, depth: maze.depth, shape: maze.parameters.shape, layout: l };
}
