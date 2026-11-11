import { EnvironmentControls } from '../ui/environment-controls';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type PointerEvent } from 'react';
import type { Maze, Parameters, Point } from '../core/maze';
import { DEFAULT_CONSTRUCTION } from '../core/maze';
import { emptyLayout, type Anchor, type FreeDraft, type FreeModule } from './model';
import { anchorGeometry, connectionGeometry, freeMaze, modulePolygon, physical, rooms, size, validateFree } from './layout';
import { centroid, distance, ends, pointIn, quantize } from './geometry';
import { decodeDraft, encodeDraft, mazeDraft } from './json';
import { editorReducer, history } from './editor-state';
import { saveMaze } from '../persistence/files';
import { downloadJson } from '../persistence/platform';
import { saveLibraryMaze, prepareLibraryWalk, captureWalk } from '../persistence/library';
import { LibraryPanel } from '../ui/library-panel';
import { ShapeControls, ShapeEditor, type ShapeTool } from '../ui/shape-editor';
import { ConstructionControls } from '../ui/construction-controls';
import { DesignControls } from '../ui/design-controls';
import { WalkCanvas, type WalkResult } from '../ui/views';
import { metrics } from '../core/metrics';
import { routePoints } from '../core/pathfinding';
import { materialEstimate } from '../core/materials';
import type { analyzeFree } from './quality';
import { convertToFree } from './convert';
import './editor.css';
export const FREE_DRAFT_KEY = 'maze-lab:free-draft:v1';
export function newFreeDraft(p?: Parameters): FreeDraft {
  return { kind: 'maze-lab-free-draft', version: 1, parameters: { columns: 24, rows: 16, corridorWidth: 2, moduleSize: 2, extraConnections: 0, seed: 'FREE-001', algorithm: 'backtracker', ...p, placementMode: 'free' }, construction: { ...DEFAULT_CONSTRUCTION }, layout: emptyLayout() };
}
const points = (poly: Point[]) => poly.map(p => `${p.x},${p.z}`).join(' ');
type Tool = 'select' | 'module' | 'connection' | 'wall' | 'opening';
export function FreeEditor({ initial, initialResult=null, onClose }: { initial: FreeDraft; initialResult?:WalkResult|null; onClose: (draft:FreeDraft,maze:Maze|null,result:WalkResult|null) => void }) {
  const [state, dispatch] = useReducer(editorReducer, initial, history), d = state.present, l = d.layout;
  const [tool, setTool] = useState<Tool>('select'), [selected, setSelected] = useState(''), [moduleType, setModuleType] = useState<'2x2' | '2x6'>('2x2'), [snap, setSnap] = useState(false), [width, setWidth] = useState(1.4), [pending, setPending] = useState<Anchor | Point | null>(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [showRoute, setShowRoute] = useState(false), [walk, setWalk] = useState<Maze | null>(null), [result, setResult] = useState<WalkResult | null>(initialResult), [library, setLibrary] = useState(false), [revision, setRevision] = useState(0), [analysis, setAnalysis] = useState<ReturnType<typeof analyzeFree> | null>(null), [profile, setProfile] = useState<'explorer' | 'compass' | 'outline'>('explorer'), [shapeEditing, setShapeEditing] = useState(false), [shapeSelected, setShapeSelected] = useState<number | null>(null), [shapeTool, setShapeTool] = useState<ShapeTool>('select'), [restore, setRestore] = useState<string | null>(null), [storageReady, setStorageReady] = useState(false);
  const worker = useRef<Worker | null>(null), svg = useRef<SVGSVGElement | null>(null), drag = useRef<{ id: string; start: Point; module: FreeModule; draft: FreeDraft } | null>(null), [preview, setPreview] = useState<FreeDraft | null>(null), [connectionPreview, setConnectionPreview] = useState<{ draft: FreeDraft; id: string } | null>(null), [view, setView] = useState({ x: -1, z: -1, width: d.parameters.columns + 2, height: d.parameters.rows + 2 });
  const current = preview ?? connectionPreview?.draft ?? d, phys = useMemo(() => physical(current.layout), [current]), issues = useMemo(() => validateFree(current), [current]), issueIds = new Set(issues.flatMap(i => i.ids)), ready = useMemo(() => issues.length || connectionPreview ? null : freeMaze(d, false), [d, issues.length, connectionPreview]), stats = useMemo(() => ready ? metrics(ready) : null, [ready]), materials = useMemo(() => ready ? materialEstimate(ready) : null, [ready]);
  const [inspection,setInspection]=useState(false);
  const update = (draft: FreeDraft) => {
    if (worker.current) {
      worker.current.terminate();
      worker.current = null;
      setBusy(false);
    }
    setConnectionPreview(null);
    dispatch({ type: 'change', draft });
    setAnalysis(null);
    setResult(null);
  };
  const mutate = (f: (draft: FreeDraft) => void) => {
    const next = structuredClone(d);
    f(next);
    update(next);
  };
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FREE_DRAFT_KEY);
      if (saved && saved !== encodeDraft(initial)) setRestore(saved);
    } catch {
      setNotice('Не удалось прочитать локальный черновик.');
    }
    setStorageReady(true);
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    if (restore || !storageReady) return;
    try {
      localStorage.setItem(FREE_DRAFT_KEY, encodeDraft(d));
    } catch {
      setNotice('Не удалось сохранить черновик на устройстве. Экспортируйте JSON.');
    }
  }, [d, restore, storageReady]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input,select,textarea') || target.isContentEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        setAnalysis(null);
        setConnectionPreview(null);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
        setAnalysis(null);
        setConnectionPreview(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
  const coordinate = (e: PointerEvent<SVGSVGElement>): Point => {
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: snap ? Math.round(point.x * 10) / 10 : quantize(point.x), z: snap ? Math.round(point.y * 10) / 10 : quantize(point.y) };
  };
  const changeTool = (t: Tool) => {
    setConnectionPreview(null);
    setTool(t);
    setPending(null);
  };
  const chooseAnchor = (p: Point): Anchor | null => {
    let best: Anchor | null = null, min = .6;
    for (const r of rooms(l)) for (let edge = 0; edge < r.polygon.length; edge++) {
      const a = r.polygon[edge]!, b = r.polygon[(edge + 1) % r.polygon.length]!, len = distance(a, b), t = Math.max(width / 2 / len, Math.min(1 - width / 2 / len, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (len * len))), mid = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dist = distance(p, mid);
      if (dist < min && len >= width) {
        min = dist;
        best = { room: r.id, edge, offset: quantize((t - .5) * len) };
      }
    }
    return best;
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (connectionPreview) {
      setNotice('Добавьте или отмените предварительное соединение.');
      return;
    }
    const p = coordinate(e);
    if (tool === 'module') {
      const m: FreeModule = { id: id('m'), type: moduleType, x: p.x, z: p.z, angle: 0 };
      mutate(n => {
        n.layout.modules.push(m);
      });
      setSelected(m.id);
      return;
    }
    if (tool === 'connection' || tool === 'opening') {
      const a = chooseAnchor(p);
      if (!a) {
        setNotice('Нажмите на сторону модуля или пространства.');
        return;
      }
      if (tool === 'opening') {
        const oid = id('o');
        mutate(n => {
          n.layout.openings.push({ ...a, id: oid, width });
          if (!n.layout.entrance) n.layout.entrance = oid; else if (!n.layout.exit) n.layout.exit = oid;
        });
        setSelected(oid);
        return;
      }
      if (!pending || !('room' in pending)) {
        setPending(a);
        setNotice('Теперь выберите сторону второго модуля.');
        return;
      }
      const cid = id('c');
      const candidate = structuredClone(d);
      candidate.layout.connections.push({ id: cid, a: pending, b: a, width });
      setConnectionPreview({ draft: candidate, id: cid });
      setSelected('');
      setPending(null);
      return;
    }
    if (tool === 'wall') {
      if (!pending || !('x' in pending)) {
        setPending(p);
        return;
      }
      const a = pending, wid = id('w');
      mutate(n => n.layout.walls.push({ id: wid, x1: a.x, z1: a.z, x2: p.x, z2: p.z }));
      setSelected(wid);
      setPending(null);
      return;
    }
    const m = [...l.modules].reverse().find(m => pointIn(p, modulePolygon(m)));
    if (m) {
      setSelected(m.id);
      drag.current = { id: m.id, start: p, module: { ...m }, draft: structuredClone(d) };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else setSelected('');
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const v = drag.current;
    if (!v) return;
    const p = coordinate(e), next = structuredClone(v.draft), m = next.layout.modules.find(m => m.id === v.id)!;
    m.x = quantize(v.module.x + p.x - v.start.x);
    m.z = quantize(v.module.z + p.z - v.start.z);
    setPreview(next);
  };
  const up = () => {
    if (drag.current && preview) update(preview);
    drag.current = null;
    setPreview(null);
  };
  const remove = () => mutate(n => {
    const x = n.layout;
    x.modules = x.modules.filter(m => m.id !== selected);
    x.spaces = x.spaces.filter(m => m.id !== selected);
    x.connections = x.connections.filter(c => c.id !== selected && c.a.room !== selected && c.b.room !== selected);
    x.openings = x.openings.filter(o => o.id !== selected && o.room !== selected);
    x.walls = x.walls.filter(w => w.id !== selected);
    if (!x.openings.some(o => o.id === x.entrance)) x.entrance = '';
    if (!x.openings.some(o => o.id === x.exit)) x.exit = '';
  });
  const run = (kind: 'generate' | 'analyze' | 'improve') => {
    worker.current?.terminate();
    setBusy(true);
    setNotice(kind === 'generate' ? 'Генерация…' : kind === 'improve' ? 'Подбор размещения…' : 'Анализ…');
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = e => {
      if (worker.current !== w) return;
      if (e.data.progress) {
        setNotice(e.data.progress);
        return;
      }
      w.terminate();
      worker.current = null;
      setBusy(false);
      if (e.data.error) {
        setNotice(e.data.error);
        return;
      }
      if (e.data.analysis) {
        setAnalysis(e.data.analysis);
        setNotice('Анализ завершён: локальная модель поиска, не прогноз поведения человека.');
      } else {
        if(kind==='improve'&&!e.data.improved){setNotice('Улучшения без ухудшения других показателей по трём стратегиям не найдено. Текущая карта сохранена.');return;}
        update(mazeDraft(e.data.maze));
        setNotice(kind === 'improve' && !e.data.improved ? 'Допустимого улучшения не найдено.' : 'Размещение готово.');
      }
    };
    w.onerror = e => {
      w.terminate();
      worker.current = null;
      setBusy(false);
      setNotice(e.message || 'Ошибка worker. Текущая карта сохранена.');
    };
    w.postMessage({ kind, parameters: d.parameters, maze: ready ?? undefined, profile });
  };
  const fileImport = async (file: File) => {
    try {
      const text = await file.text();
      if (file.size > 5_000_000) throw Error('Файл больше 5 МБ.');
      const raw = JSON.parse(text);
      if (raw.kind === 'maze-lab-free-draft') update(decodeDraft(text)); else {
        const { deserialize } = await import('../persistence/maze-json');
        update(convertToFree(deserialize(text)));
      }
      setNotice('Документ открыт.');
    } catch (e) {
      setNotice(String(e));
    }
  };
  const accept = (maze: Maze) => {
    try {
      update(convertToFree(maze));
      setLibrary(false);
    } catch (e) {
      setNotice(String(e));
    }
  };
  const begin = async (m: Maze) => {
    try {
      const prepared = await prepareLibraryWalk(m);
      setInspection(false);setWalk(prepared.maze);
    } catch {
      setInspection(false);setWalk({ ...m, roof: true });
    }
  };
  const saveRun = useCallback((value: WalkResult, status: 'in-progress' | 'stopped' | 'finished') => {
    if (!walk || value.recorder.distance <= .01) return;
    void captureWalk(walk, value.recorder, value.id ?? crypto.randomUUID(), value.finished, status).then(() => setRevision(n => n + 1)).catch(e => setNotice(String(e)));
  },[walk]);
  const onWalkCancel=useCallback(()=>setWalk(null),[]);
  const onWalkError=useCallback((error:string)=>{setNotice(error);setWalk(null);},[]);
  const onWalkCheckpoint=useCallback((value:WalkResult)=>saveRun(value,'in-progress'),[saveRun]);
  const onWalkEnd=useCallback((value:WalkResult)=>{
    if(!inspection){saveRun(value,value.finished?'finished':'stopped');setResult(value);setShowRoute(true);}
    setWalk(null);
  },[inspection,saveRun]);
  const m = current.layout.modules.find(m => m.id === selected), c = current.layout.connections.find(c => c.id === selected), o = current.layout.openings.find(o => o.id === selected);
  const fit = () => setView({ x: -1, z: -1, width: d.parameters.columns + 2, height: d.parameters.rows + 2 });
  const numberField = (label: string, value: number, onChange: (v: number) => void, step = .1, min?: number, max?: number) => <label className="field"><span>{label}</span><input aria-label={label} type="number" step={step} value={Number.isFinite(value) ? value : ''} min={min} max={max} onChange={e => {
    if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
  }} /></label>;
  const anchorOptions = (value: Anchor, onChange: (a: Anchor) => void) => <><label className="field">Пространство<select aria-label="Пространство" value={value.room} onChange={e => onChange({ ...value, room: e.target.value, edge: 0, offset: 0 })}>{rooms(l).map(r => <option key={r.id} value={r.id}>{r.id}</option>)}</select></label>{numberField('Сторона', value.edge, v => onChange({ ...value, edge: v }), 1, 0, (rooms(l).find(r => r.id === value.room)?.polygon.length ?? 4) - 1)}{numberField('Смещение проёма, м', value.offset, v => onChange({ ...value, offset: v }))}</>;
  if (walk) return <main className="walk-main"><WalkCanvas maze={walk} inspection={inspection} onCancel={onWalkCancel} onError={onWalkError} onCheckpoint={onWalkCheckpoint} onEnd={onWalkEnd}/></main>;
  return <div className="free-app"><header className="topbar"><div className="brand"><strong>MAZE <span>LAB</span></strong></div><label className="route-toggle"><input type="checkbox" role="switch" aria-label="Редактор свободного размещения" checked onChange={()=>onClose(d,ready,result)}/> Редактор свободного размещения</label><span>Черновик сохраняется на устройстве</span></header><aside className="free-sidebar"><h2>Свободное размещение</h2><label className="field">Тип лабиринта<select aria-label="Тип лабиринта" value={d.parameters.generationType ?? 'classical'} onChange={e => mutate(n => n.parameters.generationType = e.target.value as Parameters['generationType'])}><option value="classical">Классический</option><option value="living">Живой</option><option value="corridor">Коридорный</option></select></label><label className="field">Алгоритм<select value={d.parameters.algorithm} onChange={e => mutate(n => n.parameters.algorithm = e.target.value as Parameters['algorithm'])}><option value="backtracker">Recursive Backtracker</option><option value="prim">Randomized Prim</option></select></label>
    {numberField('Разброс углов, °', d.parameters.freeAngleSpread ?? 100, v => mutate(n => n.parameters.freeAngleSpread = v), 5, 0, 120)}
    <label className="field">Центральный перекрёсток<select aria-label="Центральный перекрёсток" value={d.parameters.freeJunctionDegree ?? 'auto'} onChange={e => mutate(n => {
      if (e.target.value === 'auto') delete n.parameters.freeJunctionDegree; else n.parameters.freeJunctionDegree = Number(e.target.value) as 3 | 5;
    })}><option value="auto">Авто: тройные и пятилучевые узлы</option><option value="3">Тройной · три прохода</option><option value="5">Пятилучевой · пять проходов</option></select></label>
    {numberField('Ширина площадки, м', d.parameters.columns, v => mutate(n => n.parameters.columns = v), .1, 2, 100)}{numberField('Глубина площадки, м', d.parameters.rows, v => mutate(n => n.parameters.rows = v), .1, 2, 100)}{numberField('Ширина прохода, максимум', d.parameters.corridorWidth, v => mutate(n => n.parameters.corridorWidth = v), .1, 1, 3)}{numberField('Дополнительные соединения', d.parameters.extraConnections, v => mutate(n => n.parameters.extraConnections = v), 1, 0)}{numberField('Ловушки на маршруте, не менее', d.parameters.routeTrapCount ?? 0, v => mutate(n => n.parameters.routeTrapCount = v), 1, 0, 6)}{numberField('Кольцевые ловушки, не менее', d.parameters.loopTrapCount ?? 0, v => mutate(n => n.parameters.loopTrapCount = v), 1, 0, 6)}
    <ShapeControls value={d.parameters} onChange={p => mutate(n => n.parameters = p)} editing={shapeEditing} onEditing={setShapeEditing} selected={shapeSelected} onSelect={setShapeSelected} tool={shapeTool} onTool={setShapeTool} /><DesignControls value={d.parameters.design} living={d.parameters.generationType === 'living'} onChange={v => mutate(n => n.parameters.design = v)} /><label className="field">Seed<input aria-label="Seed" value={d.parameters.seed} onChange={e => mutate(n => n.parameters.seed = e.target.value)} /></label><button disabled={busy} className="primary" onClick={() => run('generate')}>Сгенерировать</button><button disabled={busy || !ready} onClick={() => run('improve')}>Улучшить</button>{busy && <button onClick={() => {
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
      setNotice('Отменено. Текущая карта сохранена.');
    }}>Отменить операцию</button>}
    <h3>Редактор</h3><div className="free-tools">{(['select', 'module', 'connection', 'wall', 'opening'] as Tool[]).map((t, i) => <button key={t} aria-pressed={tool === t} onClick={() => changeTool(t)}>{['Выбрать / двигать', 'Добавить модуль', 'Соединить', 'Стена', 'Проём'][i]}</button>)}</div><p>Модуль: перетаскивание. Связь: две стороны. Стена: две точки. Проём: сторона пространства.</p><label className="field">Новый модуль<select aria-label="Новый модуль" value={moduleType} onChange={e => setModuleType(e.target.value as '2x2' | '2x6')}><option value="2x2">2×2 м</option><option value="2x6">2×6 м</option></select></label>{numberField('Ширина нового проёма, м', width, setWidth, .1, 1, 3)}<label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Привязка 0,1 м / 15°</label><div className="free-tools"><button disabled={!state.past.length} onClick={() => {
      dispatch({ type: 'undo' });
      setAnalysis(null);
    }}>Отменить правку</button><button disabled={!state.future.length} onClick={() => {
      dispatch({ type: 'redo' });
      setAnalysis(null);
    }}>Повторить</button></div>
    {l.preservedPanels && <p>Свободная копия сохраняет исходные стены. Для изменения размещения сначала нажмите «Перестроить стены»: рисунок стен будет построен по проёмам и связям.</p>}{l.preservedPanels && <button onClick={() => mutate(n => {
      delete n.layout.preservedPanels;
      delete n.layout.supports;
    })}>Перестроить стены</button>}
    {m && <fieldset><legend>Выбранный модуль</legend>{numberField('X, м', m.x, v => mutate(n => n.layout.modules.find(x => x.id === m.id)!.x = v), .001)}{numberField('Z, м', m.z, v => mutate(n => n.layout.modules.find(x => x.id === m.id)!.z = v), .001)}{numberField('Угол, °', m.angle, v => mutate(n => n.layout.modules.find(x => x.id === m.id)!.angle = v), .1)}<button onClick={() => mutate(n => {
      n.layout.modules.find(x => x.id === m.id)!.angle = quantize(snap ? Math.round((m.angle + 15) / 15) * 15 : m.angle + 15);
    })}>Повернуть на 15°</button><p>{size(m).join(' × ')} м</p></fieldset>}
    {c && <fieldset><legend>Соединение</legend>{numberField('Ширина связи, м', c.width, v => mutate(n => n.layout.connections.find(x => x.id === c.id)!.width = v), .1, 1, 3)}<p>Первый проём</p>{anchorOptions(c.a, a => mutate(n => n.layout.connections.find(x => x.id === c.id)!.a = a))}<p>Второй проём</p>{anchorOptions(c.b, a => mutate(n => n.layout.connections.find(x => x.id === c.id)!.b = a))}</fieldset>}
    {o && <fieldset><legend>Проём</legend>{anchorOptions(o, a => mutate(n => Object.assign(n.layout.openings.find(x => x.id === o.id)!, a)))}{numberField('Ширина проёма, м', o.width, v => mutate(n => n.layout.openings.find(x => x.id === o.id)!.width = v), .1, 1, 3)}<button onClick={() => mutate(n => n.layout.entrance = o.id)}>Сделать входом</button><button onClick={() => mutate(n => n.layout.exit = o.id)}>Сделать выходом</button></fieldset>}
    <label className="field">Выбрать объект<select aria-label="Выбрать объект" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Нет</option>{[...l.modules, ...l.spaces, ...l.connections, ...l.openings, ...l.walls].map(v => <option key={v.id} value={v.id}>{v.id}</option>)}</select></label><button disabled={!selected} onClick={remove}>Удалить выбранное</button>{ready && <EnvironmentControls maze={ready} onChange={environment => mutate(n => n.environment = environment)} />}<ConstructionControls value={d.construction} onChange={p => mutate(n => Object.assign(n.construction, p))} /></aside>
    <main className="free-workspace">{connectionPreview && <div className="free-notice">Предварительное соединение · проверьте пролёты на карте. <button disabled={issues.some(i => i.ids.includes(connectionPreview.id))} onClick={() => {
      const candidate = connectionPreview;
      update(candidate.draft);
      setSelected(candidate.id);
    }}>Добавить связь</button><button onClick={() => setConnectionPreview(null)}>Отменить связь</button></div>}<div className="free-tools"><button onClick={() => setLibrary(true)}>Библиотека</button><button onClick={() => downloadJson('maze-lab-draft.json', encodeDraft(d))}>Экспорт черновика</button><label className="free-file">Импорт JSON<input aria-label="Импорт JSON" type="file" accept=".json" onChange={e => {
      const f = e.target.files?.[0];
      if (f) void fileImport(f);
      e.currentTarget.value = '';
    }} /></label><button disabled={!ready} onClick={() => ready && void saveMaze(ready).catch(e => setNotice(String(e)))}>Сохранить карту</button><button disabled={!ready || busy} onClick={() => {
      if (ready) void saveLibraryMaze(ready).then(() => {
        setRevision(n => n + 1);
        setNotice('Карта сохранена в библиотеке.');
      }).catch(e => setNotice(String(e)));
    }}>В библиотеку</button><button disabled={!ready || busy} onClick={()=>{if(ready){setInspection(true);setWalk(ready);}}}>Осмотреть снаружи</button><button disabled={!ready || busy} onClick={() => ready && void begin(ready)}>Пройти от первого лица</button></div>
      <LibraryPanel open={library} revision={revision} onClose={() => setLibrary(false)} onMaze={accept} onWalk={(m, v) => {
        accept(m);
        setResult(v);
      }} onPlay={m => {
        accept(m);
        void begin(m);
      }} />
      {restore && <div className="free-notice">Найден сохранённый черновик. <button onClick={() => {
        try {
          update(decodeDraft(restore));
          setRestore(null);
          fit();
        } catch (e) {
          setNotice(String(e));
        }
      }}>Восстановить черновик</button><button onClick={() => setRestore(null)}>Оставить текущий</button></div>}
      <div className="free-tools"><button onClick={() => setView(v => ({ ...v, width: v.width * .8, height: v.height * .8 }))}>+</button><button onClick={() => setView(v => ({ ...v, width: v.width * 1.25, height: v.height * 1.25 }))}>−</button><button onClick={fit}>Вписать</button><label><input type="checkbox" checked={showRoute} onChange={e => setShowRoute(e.target.checked)} /> Маршрут</label><span>{issues.length ? `Черновик · замечаний: ${issues.length}` : 'Проверено · можно проходить'}</span><span>Цифры на узлах — число проходов</span></div>
      {shapeEditing ? <ShapeEditor value={d.parameters} onChange={p => mutate(n => n.parameters = p)} selected={shapeSelected} onSelect={setShapeSelected} tool={shapeTool} /> : <svg ref={svg} className="free-map" aria-label="Свободный план лабиринта" viewBox={`${view.x} ${view.z} ${view.width} ${view.height}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }} onWheel={e => {
        const factor = e.deltaY > 0 ? 1.1 : .9;
        setView(v => ({ ...v, width: v.width * factor, height: v.height * factor }));
      }}>
        <rect width={d.parameters.columns} height={d.parameters.rows} fill="#171e19" stroke="#53634e" strokeWidth=".05" />{d.parameters.shape?.rectangles.map((r, i) => <rect key={i} x={r.x} y={r.z} width={r.width} height={r.height} fill={r.operation === 'subtract' ? '#080e0c' : 'none'} stroke="#56664d" strokeWidth=".03" />)}
        {phys.polygons.map((p, i) => {
          const connection = phys.connections[i - phys.rooms.length], link = connection ? current.layout.connections.find(c => c.id === connection.id) : null, heat = analysis ? (i < phys.rooms.length ? analysis.probability[i] ?? 0 : link ? ((analysis.probability[phys.rooms.findIndex(r => r.id === link.a.room)] ?? 0) + (analysis.probability[phys.rooms.findIndex(r => r.id === link.b.room)] ?? 0)) / 2 : 0) : null;
          return <polygon key={`p-${i}`} points={points(p)} fill={heat === null ? '#263326' : `hsl(${35 + 85 * heat} 55% 30%)`} />;
        })}{phys.holes.map((p, i) => <polygon key={`h-${i}`} points={points(p)} fill="#080e0c" />)}{current.layout.modules.map((m, i) => <polygon key={m.id} points={points(modulePolygon(m))} fill={issueIds.has(m.id) ? '#773d39' : selected === m.id ? '#577b45' : analysis ? `hsl(${35 + 85 * (analysis.probability[i] ?? 0)} 55% 30%)` : '#374b30'} stroke={selected === m.id ? '#b7eb71' : '#697657'} strokeWidth=".06" />)}
        {phys.panels.map((w, i) => <line key={`w-${i}`} x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="#c1c5a4" strokeWidth=".055" />)}{phys.posts.map((p, i) => <rect key={`post-${i}`} x={p.x - .06} y={p.z - .06} width=".12" height=".12" fill="#b2ad87" />)}
        {current.layout.connections.map(c => {
          try {
            const g = connectionGeometry(current.layout, c), length = Math.max(...g.sides.map(w => distance(...ends(w))));
            return <g key={c.id} onClick={e => {
              if (tool === 'select') {
                e.stopPropagation();
                setSelected(c.id);
              }
            }}><polygon points={points(g.polygon)} fill={issueIds.has(c.id) ? '#a84a4877' : 'transparent'} stroke={selected === c.id ? '#d2eb75' : 'none'} strokeWidth=".05" /><text x={(g.a.mid.x + g.b.mid.x) / 2} y={(g.a.mid.z + g.b.mid.z) / 2} fontSize=".25" fill={length > 3 ? '#ff8880' : '#d0d6b5'}>{length.toFixed(2)} м</text></g>;
          } catch {
            return null;
          }
        })}
        {current.layout.openings.map(o => {
          try {
            const g = anchorGeometry(current.layout, o, o.width);
            return <g key={o.id} onClick={e => {
              if (tool === 'select') {
                e.stopPropagation();
                setSelected(o.id);
              }
            }}><line x1={g.from.x} y1={g.from.z} x2={g.to.x} y2={g.to.z} stroke={o.id === l.entrance ? '#81e6a5' : o.id === l.exit ? '#f3bf74' : '#77bed1'} strokeWidth=".18" /><text x={g.mid.x} y={g.mid.z - .2} fontSize=".3" fill="white">{o.id === l.entrance ? 'ВХОД' : o.id === l.exit ? 'ВЫХОД' : 'ПРОЁМ'}</text></g>;
          } catch {
            return null;
          }
        })}
        {pending && 'room' in pending && (() => {
          try {
            const g = anchorGeometry(l, pending, width);
            return <circle cx={g.mid.x} cy={g.mid.z} r=".2" fill="#f3bf74" />;
          } catch {
            return null;
          }
        })()}{pending && 'x' in pending && <circle cx={pending.x} cy={pending.z} r=".15" fill="#f3bf74" />}
        {rooms(current.layout).map(room => {
          const count = current.layout.connections.filter(c => c.a.room === room.id || c.b.room === room.id).length;
          if (count < 3) return null;
          const p = centroid(room.polygon);
          return <g key={`junction-${room.id}`} role="img" aria-label={`Перекрёсток: ${count} проходов`}><circle cx={p.x} cy={p.z} r=".33" fill={count >= 5 ? '#efb66f' : '#b7dc7d'} stroke="#10180d" strokeWidth=".04" /><text x={p.x} y={p.z + .11} fontSize=".32" textAnchor="middle" fill="#10180d" fontWeight="bold">{count}</text></g>;
        })}
        {showRoute && ready && <polyline points={points(routePoints(ready))} fill="none" stroke="#c7f88f" strokeWidth=".08" />}{result && <polyline points={points([...result.recorder.samples])} fill="none" stroke="#8ed5ed" strokeWidth=".07" />}</svg>}
      <section className="free-validation" aria-label="Проверка конструкции"><h3>Проверка конструкции</h3>{issues.length ? <ul>{issues.slice(0, 30).map((i, n) => <li key={n}><button onClick={() => setSelected(i.ids[0] ?? '')}>{i.message}</button></li>)}</ul> : <p>Связность, пролёты, проёмы и физическая проходимость проверены.</p>}</section>
      {stats && <p>Модулей: {l.modules.length} · 2×2: {l.modules.filter(m => m.type === '2x2').length} · 2×6: {l.modules.filter(m => m.type === '2x6').length} · циклов: {stats.cycles} · площадь: {stats.area.toFixed(1)} м² · маршрут: {stats.optimalLength.toFixed(1)} м</p>}{materials && <p>Стоек: {materials.posts} · ткани: {materials.fabricSquareMetres.toFixed(1)} м² · обвязки: {(materials.upperMetres + materials.lowerMetres).toFixed(1)} м. Раскрой и отходы не учитываются.</p>}
      <div className="free-tools"><label>Модель поиска<select value={profile} onChange={e => setProfile(e.target.value as typeof profile)}><option value="explorer">Без направления</option><option value="compass">Знает направление</option><option value="outline">Знает направление и контур</option></select></label><button disabled={!ready || busy} onClick={() => run('analyze')}>Проанализировать</button></div>{analysis && <p>Холодная площадь: {(analysis.coldAreaRatio * 100).toFixed(1)}% · крупнейшая область: {analysis.largestColdArea.toFixed(1)} м² · средний путь поиска: {analysis.expectedLength.toFixed(1)} м · завершено симуляций: {(analysis.finishedRatio * 100).toFixed(1)}% из {analysis.samples}. Тепло показано на пространствах и соединениях.</p>}
      <p role="status" className="free-notice">{notice}</p>
    </main></div>;
}
