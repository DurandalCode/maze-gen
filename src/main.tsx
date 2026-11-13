import {multiBandVortexParameters,deepHybridVortexParameters,hybridVortexParameters,leaveContinuousVortex,continuousVortexParameters,districtVortexParameters,chaoticVortexParameters,knottedVortexParameters,centralVortexParameters,vortexParameters} from './free/vortex-parameters';
import {maximumSpacingParameters} from './free/maximum-settings';
import {CavityReportPanel} from './free/cavity-report';
import {freeZoneSummary} from './free/zones';
import {freeIslands} from './free/layout';
import {FreeEditor} from './free/editor';
import type {FreeDraft} from './free/model';
import {mazeDraft} from './free/json';
import {convertToFree} from './free/convert';
import {minimumFloorChanges,validFloorChanges} from './core/two-storey';
import {corridorSpaceSummary} from './core/corridor-summary';
import {corridorSupports} from './core/corridor-supports';
import {corridorParameters} from './core/generation-parameters';
import {isOfflineLibrary} from './persistence/platform';
import { LibraryPanel } from './ui/library-panel';
import { captureWalk,flushPendingWalks,saveLibraryMaze,prepareLibraryWalk,getLibraryMaze } from './persistence/library';
import { assessWalk } from './analysis/walk-assessment';
import { ColdspotControls, type HeatDisplay } from './ui/coldspot-controls';
import type { OptimizationResult } from './analysis/optimize';
import { ShapeControls, ShapeEditor, shapeStatus, type ShapeTool } from './ui/shape-editor';
import { domainOf } from './core/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Algorithm, Parameters, Maze, Portal } from './core/maze';
import { mazePortals, samePortal, withPortals } from './core/portals';
import { metrics } from './core/metrics';
import { generate } from './generators/generate';
import { loadMaze, saveMaze } from './persistence/files';
import { MapCanvas, WalkCanvas, formatTime, type WalkResult } from './ui/views';
import { ConstructionControls } from './ui/construction-controls';
import { PortalControls, type PortalEdit } from './ui/portal-controls';
import { EnvironmentControls } from './ui/environment-controls';
import type { Environment } from './core/environment';
import './style.css';
import {contourQuality} from './generators/contours';
import {generationName,type GenerationType} from './core/maze';
import {DesignControls} from './ui/design-controls';

const initial: Parameters = { columns: 5, rows: 5, corridorWidth: 2, moduleSize: 2, extraConnections: 0, seed: 'FIELD-024', algorithm: 'backtracker' };
const number = (value: number, digits = 0) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });

function Logo() {
  return <svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M6 30V6h24v24H18V18h12M6 18h12M18 6v6" stroke="currentColor" strokeWidth="2.5" /></svg>;
}

function App() {
  const [freeDocument,setFreeDocument]=useState<FreeDraft|null>(null);
  const generationDrafts=useRef<Partial<Record<GenerationType,Parameters>>>({classical:initial});
  const generationCancel=useRef<(()=>void)|null>(null);
  const [libraryOpen,setLibraryOpen]=useState(isOfflineLibrary);
  const [libraryRevision,setLibraryRevision]=useState(0);
  const [section,setSection]=useState<'maze'|'settings'>('maze');
  const [analysisRequest,setAnalysisRequest]=useState(0);
  const analysisPanel=useRef<HTMLDivElement>(null);
  const sidebarRef=useRef<HTMLElement>(null);
  const switchSection=(next:'maze'|'settings')=>{setSection(next);setShapeEditing(false);setPortalEdit(null);requestAnimationFrame(()=>{window.scrollTo({top:0});sidebarRef.current?.scrollTo({top:0});});};
  const requestAnalysis=()=>{switchSection('maze');setAnalysisRequest(n=>n+1);requestAnimationFrame(()=>analysisPanel.current?.scrollIntoView({block:'start',behavior:'smooth'}));};
  const [shapeEditing, setShapeEditing] = useState(false);
  const [shapeSelected, setShapeSelected] = useState<number|null>(null);
  const [selectedFloor,setSelectedFloor]=useState(0);
  const selectFloor=(floor:number)=>{setSelectedFloor(floor);setShapeSelected(null);setPortalEdit(null);};
  const [shapeTool, setShapeTool] = useState<ShapeTool>('select');
  const [maze, setMaze] = useState(() => generate(initial));
  const [draft, setDraft] = useState<Parameters>(initial);
  const gridPlacementDraft=useRef<Parameters>(initial);
  const metricSite=draft.placementMode==='free'||draft.generationType==='corridor';
  const changePlacement=(placement:'grid'|'free')=>{
    if(placement==='free'){
      try{gridPlacementDraft.current=draft;const meters=corridorParameters(draft);setDraft(maximumSpacingParameters({...meters,generationType:draft.generationType,placementMode:'free',moduleSize:2}));}
      catch(e){setError(e instanceof Error?e.message:String(e));}
    }else setDraft({...gridPlacementDraft.current,placementMode:'grid',freeCavityMaze:false,freeCourtyardPolicy:undefined,seed:draft.seed,algorithm:draft.algorithm});
    setShapeEditing(false);setShapeSelected(null);
  };
  const [mode, setMode] = useState<'map' | 'walk' | 'inspect'>('map');
  const modeRef=useRef(mode);modeRef.current=mode;
  const [heatDisplay,setHeatDisplay] = useState<HeatDisplay|null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const [result, setResult] = useState<WalkResult | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [blindPreparing,setBlindPreparing]=useState(()=>{const q=new URLSearchParams(location.search);return q.has('maze')&&q.get('blind')==='1';});
  const [busy, setBusy] = useState(false);
  const [generationMs, setGenerationMs] = useState<number | null>(null);
  const [portalEdit, setPortalEdit] = useState<PortalEdit>(null);
  const spaceSummary=useMemo(()=>maze.version===4?corridorSpaceSummary(maze):null,[maze]);
  const analysis = useMemo(() => metrics(maze), [maze]);
  const livingInfo=useMemo(()=>maze.parameters.generationType==='living'?contourQuality(maze):null,[maze]);
  const supportCount=useMemo(()=>maze.version===4?corridorSupports(maze).length:0,[maze]);
  const moduleCount=useMemo(()=>maze.free?.modules.length??domainOf(maze).modules.reduce((sum,active)=>sum+active,0),[maze]);
  const walkAssessment=useMemo(()=>result?assessWalk(maze,result.recorder.samples,result.recorder.distance,result.finished):null,[maze,result]);
  useEffect(()=> {
    const retry=()=>void flushPendingWalks(()=>modeRef.current==='map'&&!document.querySelector('.walk-view'));retry();
    window.addEventListener('online',retry);const timer=window.setInterval(retry,30_000);
    return ()=>{window.removeEventListener('online',retry);window.clearInterval(timer);};
  },[]);
  const draftStatus = useMemo(() => shapeStatus(draft), [draft]);
  const shapeDraft:Parameters=draft.generationType==='two-storey'&&selectedFloor===1?{...draft,generationType:'classical',design:undefined,shape:draft.upperShape??draft.shape}:draft;
  const updateShape=(next:Parameters)=>{if(draft.generationType==='two-storey'&&selectedFloor===1)setDraft({...draft,upperShape:next.shape??{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:draft.columns,height:draft.rows,operation:'add'}]}});else setDraft(next);};
  const dirty = JSON.stringify(draft) !== JSON.stringify(maze.parameters);
  const patch = <K extends keyof Parameters>(key: K, value: Parameters[K]) => {
    if ((key==='columns' || key==='rows') && draft.shape && draft.shape.rectangles.some(r=>key==='columns'?(draft.generationType==='corridor'?Math.round((r.x+r.width)*1000)>Math.round((value as number)*1000):r.x+r.width>(value as number)):(draft.generationType==='corridor'?Math.round((r.z+r.height)*1000)>Math.round((value as number)*1000):r.z+r.height>(value as number)))) {
      setError('Нельзя уменьшить сетку: прямоугольники выходят за новую границу. Сначала измените форму.');return;
    }
    setDraft(p => ({ ...p, [key]: value }));
  };
  const resetNotice = () => { setError(''); setMessage(''); };
  const changePortals = (next: Maze) => { if(!validFloorChanges(next)){setError('Перенос проёма создаёт путь с меньшим числом смен этажей.');return;}setMaze(next); setResult(null); resetNotice(); };
  const changeEnvironment = (environment: Environment) => { setMaze(current => ({ ...current, environment })); resetNotice(); };
  const placePortal = (portal: Portal | null) => {
    if (!portal) { setError('Выберите место на границе области, включая внутренние отверстия.'); return; }
    const portals = [...mazePortals(maze)];
    if (portals.some((p, i) => i !== portalEdit && samePortal(p, portal))) {
      setError('Здесь уже есть вход-выход. Выберите другой участок.'); return;
    }
    if (portalEdit === 'add') portals.push(portal);
    else if (typeof portalEdit === 'number') portals[portalEdit] = portal;
    else return;
    // Moving a selected endpoint keeps it selected in its new location.
    const previous = typeof portalEdit === 'number' ? mazePortals(maze)[portalEdit] : null;
    const next = { ...maze,
      entrance: previous && samePortal(previous, maze.entrance) ? portal : maze.entrance,
      exit: previous && samePortal(previous, maze.exit) ? portal : maze.exit };
    try{changePortals(withPortals(next, portals));setPortalEdit(null);}catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  const regenerate = async (blind = false, parameters:Parameters=draft) => {
    resetNotice();
    setBusy(true);setBlindPreparing(blind);
    try {
      const start = performance.now();
      const generated=(parameters.placementMode==='free'||parameters.generationType==='two-storey'||parameters.generationType==='corridor'||parameters.generationType==='living'||(parameters.routeTrapCount??0)>0 || (parameters.loopTrapCount??0)>0 || parameters.design) ? await new Promise<Maze>((resolve,reject)=>{
        const worker=new Worker(new URL('./generators/worker.ts',import.meta.url),{type:'module'});
        generationCancel.current=()=>{worker.terminate();generationCancel.current=null;reject(new Error('Генерация отменена. Текущий лабиринт сохранён.'));};
        worker.onmessage=e=>{if(e.data.progress){setMessage(e.data.progress);return;}worker.terminate();generationCancel.current=null;e.data.error?reject(new Error(e.data.error)):resolve(e.data.maze);};
        worker.onerror=e=>{worker.terminate();generationCancel.current=null;reject(new Error(e.message||'Не удалось сгенерировать лабиринт.'));};
        worker.postMessage({parameters:parameters,previous:maze});
      }):generate(parameters,maze);
      const next = { ...generated, wallHeight: maze.wallHeight, wallColor: maze.wallColor, translucentFabric: maze.translucentFabric, roof: maze.roof,
        ...(maze.environment ? { environment: maze.environment } : {}) }; setGenerationMs(performance.now()-start);
      const oldPortals=mazePortals(maze),newPortals=mazePortals(next);
      const moved=oldPortals.some((p,i)=>!newPortals[i] || !samePortal(p,newPortals[i]!));
      const reshaped=parameters.columns!==next.parameters.columns||parameters.rows!==next.parameters.rows||JSON.stringify(parameters.shape)!==JSON.stringify(next.parameters.shape);
      setMaze(next); setDraft(current=>JSON.stringify(current)===JSON.stringify(parameters)?structuredClone(next.parameters):current); setResult(null); setShowRoute(false); setPortalEdit(null);setShapeEditing(false);
      if (blind) await beginWalk(next);
      else setMessage(reshaped?`Подобрана другая форма: ${next.parameters.columns}×${next.parameters.rows}, ${domainOf(next).modules.reduce((a,b)=>a+b,0)} модулей.`:moved?'Лабиринт сгенерирован. Проёмы перенесены на ближайшие свободные участки границы.':'Лабиринт сгенерирован. Seed сохранён.');
    } catch (e) { setMessage('');setError(e instanceof Error ? e.message : String(e)); }
    finally {generationCancel.current=null;setBusy(false);setBlindPreparing(false);}
  };
  useEffect(()=>{
    const query=new URLSearchParams(window.location.search),preset=query.get('preset');
    const id=query.get('maze');
    if(id){let active=true;setBusy(true);setBlindPreparing(query.get('blind')==='1');void getLibraryMaze(id).then(async row=>{if(!active)return;setMaze(row.maze);setDraft(structuredClone(row.maze.parameters));if(query.get('blind')==='1')await beginWalk(row.maze);else setSection('maze');}).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(active){setBusy(false);setBlindPreparing(false);}});return ()=>{active=false;};}
    if(preset!=='free-bridges'&&preset!=='free-zones')return;
    const parameters:Parameters=preset==='free-zones'?{placementMode:'free',columns:60,rows:50,moduleSize:2,corridorWidth:2,extraConnections:5,freeZoneCount:3,freeIslandCount:3,freeBridgeCount:2,seed:'zones-1',algorithm:'prim'}:{placementMode:'free',columns:30,rows:30,moduleSize:2,corridorWidth:2,extraConnections:2,freeBridgeCount:2,seed:'bridges-5',algorithm:'prim'};
    setDraft(parameters);void regenerate(query.get('blind')==='1',parameters);
    return ()=>generationCancel.current?.();
  },[]);
  const persistRun=useCallback((value:WalkResult,status:'in-progress'|'stopped'|'finished')=>{
    if(value.recorder.distance<=.01&&!value.recorder.markers.length)return;
    void captureWalk(maze,value.recorder,value.id??crypto.randomUUID(),value.finished,status).then(saved=>{
      if(saved.saved){setLibraryRevision(n=>n+1);if(status!=='in-progress')setMessage(isOfflineLibrary()?'Маршрут сохранён на устройстве. Его можно экспортировать из библиотеки.':'Маршрут сохранён в общей библиотеке.');}
      else setMessage(saved.queued?'Сервер недоступен. Запись сохранена в браузере и будет отправлена повторно.':'Не удалось сохранить запись. Текущий маршрут остаётся на карте.');
    });
  },[maze]);
  const onCheckpoint=useCallback((value:WalkResult)=>persistRun(value,'in-progress'),[persistRun]);
  const onEnd = useCallback((value: WalkResult) => {
    setResult(value); setMode('map'); setSection('maze'); setShowRoute(true);persistRun(value,value.finished?'finished':'stopped');
    setMessage(value.finished ? 'Выход найден! Твой маршрут записан.' : 'Прохождение остановлено. Записанная часть пути показана на карте.');
  }, [persistRun]);
  const endInspection=useCallback(()=>setMode('map'),[]);
  const onWalkError = useCallback((value: string) => { setError(value); setMode('map'); setSection('maze'); }, []);
  const save = async () => {
    resetNotice(); setBusy(true);
    try { if (await saveMaze(maze)) setMessage('Лабиринт сохранён в JSON.'); }
    catch (e) { setError(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const load = async () => {
    resetNotice(); setBusy(true);
    try {
      const next = await loadMaze();
      if (next) {
                setShapeEditing(false);setShapeSelected(null);setMaze(next); setDraft(structuredClone(next.parameters)); setResult(null); setShowRoute(false); setGenerationMs(null); setPortalEdit(null);
        setMessage('Лабиринт загружен. Топология восстановлена из файла.');
      }
    } catch (e) { setError(`Не удалось загрузить: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const acceptOptimized = (result: OptimizationResult) => {
    setMaze(result.maze);setDraft(structuredClone(result.maze.parameters));setResult(null);setShowRoute(false);setPortalEdit(null);
    setMessage('Лабиринт улучшен. Форма и проёмы сохранены. Сохраните результат в JSON.');
  };
  const openLibraryMaze=(next:Maze)=>{
        setFreeDocument(null);setMaze(next);setDraft(structuredClone(next.parameters));setResult(null);setMode('map');setSection('maze');setShowRoute(false);setShapeEditing(false);setPortalEdit(null);resetNotice();
  };
  const openLibraryWalk=(next:Maze,value:WalkResult)=>{
    openLibraryMaze(next);setResult(value);setShowRoute(true);setMessage('Прохождение открыто из общей библиотеки.');
  };
  const saveShared=async()=>{
    setBusy(true);resetNotice();
    try{await saveLibraryMaze(maze);setLibraryRevision(n=>n+1);setMessage('Лабиринт сохранён в общей библиотеке.');}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  async function beginWalk(next:Maze) {
    setBusy(true);
    try {
      const prepared=await prepareLibraryWalk(next);setMaze(prepared.maze);setMode('walk');
      if(prepared.roofEnforced)setMessage('Первое записанное прохождение: крыша включена.');
    }catch {
      setMaze({...next,roof:true});setMode('walk');setMessage('Сервер недоступен. Начинаем с крышей; запись будет отправлена после восстановления связи.');
    }finally{setBusy(false);}
  }
  const changeGenerationType=(type:GenerationType)=>{
    try{const current=draft;generationDrafts.current[current.generationType??'classical']=current;
      if(current.placementMode==='free'&&type!=='two-storey'){setDraft({...current,generationType:type});return;}
      const saved=generationDrafts.current[type];
      const geometry=(saved?.placementMode!=='free'?saved:undefined)??(current.placementMode==='free'?initial:type==='corridor'?corridorParameters(current):current.generationType==='corridor'?initial:current);
      setDraft({...geometry,generationType:type,seed:current.seed,algorithm:current.algorithm,extraConnections:current.extraConnections,routeTrapCount:current.routeTrapCount,loopTrapCount:current.loopTrapCount,design:current.design,...(type==='two-storey'?{moduleSize:geometry.moduleSize??2,placementMode:'grid',freeCavityMaze:false,freeCourtyardPolicy:undefined,minFloorChanges:geometry.minFloorChanges??4,upperShape:geometry.upperShape??geometry.shape??{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:geometry.columns,height:geometry.rows,operation:'add'}]},design:current.design?{...current.design,allowReshape:false}:undefined}:{})});setSelectedFloor(0);setShapeEditing(false);setShapeSelected(null);
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}
  };
  const parameterNumber = (label: string, key: 'columns' | 'rows' | 'corridorWidth' | 'moduleSize' | 'extraConnections' | 'routeTrapCount' | 'loopTrapCount', min: number, max: number, step = 1, unit?: string) =>
    <label className="field"><span>{label}</span><div className="input-unit"><input aria-label={label} type="number" min={min} max={max} step={step} required value={Number.isNaN(draft[key]) ? '' : draft[key] ?? ((key === 'routeTrapCount' || key === 'loopTrapCount') ? 0 : '')} onChange={e => patch(key, e.target.valueAsNumber)} />{unit && <em>{unit}</em>}</div></label>;

  if(freeDocument)return <FreeEditor initial={freeDocument} initialResult={result} onClose={(_document,next,nextResult)=>{if(next){setMaze(next);setDraft(structuredClone(next.parameters));setResult(nextResult);setShowRoute(!!nextResult);}else setMessage('Черновик сохранён на устройстве. На карте показан последний готовый лабиринт.');setFreeDocument(null);}}/>;
  return <div className={`app-shell ${mode !== 'map' ? 'is-walking' : ''} ${section==='settings'?'settings-open':''}`}>
    {blindPreparing&&<div className="blind-preparing" role="status"><p>Готовим слепое прохождение…</p><p>{message}</p><button onClick={()=>generationCancel.current?.()}>Отменить генерацию</button></div>}
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Logo /></div><strong>MAZE <span>LAB</span></strong><span className="version">0.1</span></div>
      <div className="topbar-description">Лаборатория физических лабиринтов</div>
      <div className="local-badge"><i /> Локальный проект</div>
    </header>
    {mode === 'map' ? <>
      <aside ref={sidebarRef} className="sidebar">
        <div className="sidebar-title"><span className="eyebrow">{section==='settings'?'НАСТРОЙКИ ЛАБИРИНТА':'АНАЛИЗ ЛАБИРИНТА'}</span></div>
        <div id="maze-settings-panel" hidden={section!=='settings'}>
        <form onSubmit={e => { e.preventDefault(); regenerate(); }}>
          <div className="section-label"><span>ПАРАМЕТРЫ ГЕНЕРАЦИИ</span><span>↘</span></div>
          <label className="field"><span>Размещение</span><select aria-label="Размещение" disabled={draft.generationType==='two-storey'} value={draft.placementMode??'grid'} onChange={e=>changePlacement(e.target.value as 'grid'|'free')}><option value="grid">По сетке</option><option value="free">Свободное размещение</option></select></label>
          <label className="field"><span>Тип лабиринта</span><select aria-label="Тип лабиринта" value={draft.generationType??'classical'} onChange={e=>changeGenerationType(e.target.value as GenerationType)}><option value="classical">Классический</option><option value="living">Живой</option><option value="corridor">Коридорный</option><option value="two-storey">Двухэтажный</option></select></label>
          {draft.generationType==='living'&&<p className="field-note">Вложенные контуры повторяют форму площадки. Переходы, перегородки и дополнительные соединения образуют развилки и кольца.</p>}
          {draft.generationType==='corridor'&&<p className="field-note">Модули 2×2 и 2×6 м размещаются автоматически. Внутри длинного модуля нет перегородок. Проходы — от 1 м до заданного максимума по осям каркаса; фактический просвет учитывает толщину стоек. По краям каждого проёма стоят стойки.</p>}
          {draft.placementMode!=='free'&&draft.generationType!=='corridor'&&draft.generationType!=='two-storey'&&<label className="field"><span>Конструкция</span><select aria-label="Конструкция" value={draft.moduleSize === undefined ? 'grid' : 'modules'} onChange={event => setDraft(p => {
            const { moduleSize, ...rest } = p;
            return event.target.value === 'modules' ? { ...rest, moduleSize: moduleSize ?? 2 } : rest;
          })}><option value="modules">Отдельные квадратные модули</option><option value="grid">Классическая сетка</option></select></label>}
          {draft.generationType==='two-storey'&&<label className="field floor-editor-control"><span>Редактируемый этаж</span><select aria-label="Редактируемый этаж" value={selectedFloor} onChange={e=>selectFloor(Number(e.target.value))}><option value={0}>Этаж 1</option><option value={1}>Этаж 2</option></select></label>}
          <ShapeControls value={shapeDraft} onChange={updateShape} allowDisconnected={draft.generationType==='two-storey'&&selectedFloor===1} editing={shapeEditing} onEditing={value=>{setShapeEditing(value);setPortalEdit(null);}} selected={shapeSelected} onSelect={setShapeSelected} tool={shapeTool} onTool={setShapeTool}/>
          {((draft.generationType??'classical')==='classical'||draft.generationType==='two-storey')&&<><label className="field"><span>Алгоритм</span><select aria-label="Алгоритм" disabled={draft.freeRoutePattern==='vortex'} value={draft.algorithm} onChange={e => patch('algorithm', e.target.value as Algorithm)}><option value="backtracker">Recursive Backtracker</option><option value="prim">Randomized Prim</option></select></label>
          <p className="field-note algorithm-note">{draft.freeRoutePattern==='vortex'?'Вортекс использует собственный seeded алгоритм спиралей и выборочных перекрёстков.':draft.algorithm === 'backtracker' ? 'Длинные извилистые пути и глубокие тупики.' : 'Много коротких ответвлений и частых развилок.'}</p></>}
          <div className="field-pair">{parameterNumber(metricSite?'Ширина площадки, м':'Столбцы', 'columns',metricSite?2:1,100,metricSite?0.1:1)}{parameterNumber(metricSite?'Глубина площадки, м':'Строки', 'rows',metricSite?2:1,100,metricSite?0.1:1)}</div>
          {draft.placementMode!=='free' && draft.moduleSize !== undefined && draft.generationType!=='corridor' && parameterNumber('Размер модуля', 'moduleSize', 0.8, 10, 0.1, 'м')}
          {parameterNumber(metricSite?'Ширина прохода, максимум':draft.moduleSize === undefined ? 'Ширина коридора' : 'Проход между модулями', 'corridorWidth', metricSite?1:.8, metricSite?3:10, .1, 'м')}
          {draft.placementMode==='free'&&<><label className="route-toggle"><input type="checkbox" checked={draft.freeCavityMaze??false} onChange={e=>setDraft(p=>e.target.checked?maximumSpacingParameters({...leaveContinuousVortex(p),freeCavityMaze:true,freeCourtyardPolicy:'dense-v3',freePassagePattern:'organic-sectors-v2',freeRoutePattern:'organic',freeBridgeCount:0,freeVortexCenter:false,freeVortexKnots:false,freeVortexChaotic:false,freeVortexDeepRegions:false,freeVortexContinuous:false,freeVortexMultiBand:false,freeVortexHybrid:false,freeVortexHybridDeep:false}):{...p,freeCavityMaze:false,freeCourtyardPolicy:undefined,freePassagePattern:undefined})}/><span className="switch"/>Лабиринт внутри пустот</label><p className="field-note">В промежутках добавляются настоящие модули и связи между рамами. Замкнутые дворы открываются через существующие стены. Число модулей может вырасти.</p>{draft.freeCavityMaze&&<label className="route-toggle"><input type="checkbox" checked={draft.freeCourtyardPolicy!==undefined} onChange={e=>setDraft(p=>({...p,freeCourtyardPolicy:e.target.checked?'dense-v3':undefined,freePassagePattern:e.target.checked?p.freePassagePattern:undefined}))}/><span className="switch"/>Проходы в компактных дворах</label>}{draft.freeCavityMaze&&draft.freeCourtyardPolicy&&<label className="route-toggle"><input type="checkbox" checked={draft.freeCourtyardPolicy==='dense-v3'} onChange={e=>setDraft(p=>({...p,freeCourtyardPolicy:e.target.checked?'dense-v3':'selective-v2',freePassagePattern:e.target.checked?p.freePassagePattern:undefined}))}/><span className="switch"/>Повторное заполнение крупных полостей</label>}{draft.freeCavityMaze&&draft.freeCourtyardPolicy==='dense-v3'&&<label className="field"><span>Связующие участки</span><select aria-label="Связующие участки" value={draft.freePassagePattern??''} onChange={e=>setDraft(p=>({...p,freePassagePattern:(e.target.value||undefined) as Parameters['freePassagePattern']}))}><option value="">Прежние проходы</option><option value="two-row-v1">Двухрядные сборки</option><option value="organic-sectors-v1">Органические межсекторные связи</option><option value="organic-sectors-v2">Сохранить композицию и заполнить пустоты</option></select></label>}<label className="field"><span>Рисунок свободной планировки</span><select aria-label="Рисунок свободной планировки" value={draft.freeRoutePattern??'organic'} onChange={e=>{const pattern=e.target.value as 'organic'|'switchbacks'|'vortex';setDraft(p=>pattern==='vortex'?vortexParameters(p):({...leaveContinuousVortex(p),freeRoutePattern:pattern,freeVortexCenter:false,freeVortexKnots:false,freeVortexChaotic:false,freeVortexDeepRegions:false,freeVortexContinuous:false,freeVortexMultiBand:false,freeVortexHybrid:false,freeVortexHybridDeep:false,...(pattern==='switchbacks'?{freeCavityMaze:false,freeCourtyardPolicy:undefined,freePassagePattern:undefined,extraConnections:Math.max(p.extraConnections,2),freeJunctionDegree:3 as const}:{})}));}}><option value="organic">Органический рост</option><option value="switchbacks">Переплетённый маршрут</option><option value="vortex">Вортексный · пробный</option></select><small>Вортексный: четыре переплетённые спирали с выборочными переходами, 96 базовых модулей и 40 циклов. Для одного комплекта Л1 + К1: задайте по 1 в полях ловушек и площадку 70×70 м; добавляется настоящая рама 2×6. Другие размеры — 80, 84 и далее с шагом 4. Площадка от 60×60 м, пролёт 3 м; без мостов. Для непрерывного пресета доступно отдельное заполнение межспиральных дворов; оно добавляет настоящие рамы, сохраняя исходные зазоры. Переплетённый маршрут: каркас из 89 модулей с кольцами и длинными боковыми ветвями; рост до заданной цели. Начните с 90 модулей, площадки 100×100 м и пролёта 3 м. Не менее двух дополнительных соединений, без зон и мостов.</small></label>{draft.freeRoutePattern==='vortex'&&<label className="route-toggle"><input type="checkbox" checked={!!draft.freeVortexCenter&&!draft.freeVortexKnots&&!draft.freeVortexChaotic} onChange={e=>setDraft(p=>e.target.checked?centralVortexParameters(p):vortexParameters(p))}/><span className="switch"/>Центральный перекрёсток · 2Л + 2К</label>}{draft.freeRoutePattern==='vortex'&&<label className="route-toggle"><input type="checkbox" checked={draft.freeVortexKnots??false} onChange={e=>setDraft(p=>e.target.checked?knottedVortexParameters(p):centralVortexParameters(p))}/><span className="switch"/>Косые узлы вне центра · без наружных хвостов</label>}{draft.freeRoutePattern==='vortex'&&<label className="route-toggle"><input type="checkbox" checked={draft.freeVortexChaotic??false} onChange={e=>setDraft(p=>e.target.checked?chaoticVortexParameters(p):centralVortexParameters(p))}/><span className="switch"/>Хаотичные спирали · 2Л + 2К</label>}{draft.freeRoutePattern==='vortex'&&draft.freeVortexChaotic&&<label className="route-toggle"><input type="checkbox" checked={draft.freeVortexDeepRegions??false} onChange={e=>setDraft(p=>e.target.checked?districtVortexParameters(p):chaoticVortexParameters(p))}/><span className="switch"/>Возвратные районы · вложенные развилки</label>}{draft.freeRoutePattern==='vortex'&&draft.freeVortexChaotic&&<label className="route-toggle"><input type="checkbox" checked={draft.freeVortexContinuous??false} onChange={e=>setDraft(p=>e.target.checked?continuousVortexParameters(p):chaoticVortexParameters(p))}/><span className="switch"/>Непрерывные петли · 2Л + 2К</label>}{draft.freeRoutePattern==='vortex'&&draft.freeVortexContinuous&&<label className="route-toggle"><input type="checkbox" checked={draft.freeVortexHybrid??false} onChange={e=>setDraft(p=>e.target.checked?hybridVortexParameters(p):continuousVortexParameters(p))}/><span className="switch"/>Межспиральные дворы · гибрид</label>}{draft.freeRoutePattern==='vortex'&&draft.freeVortexHybrid&&<label className="route-toggle"><input type="checkbox" checked={draft.freeVortexHybridDeep??false} onChange={e=>setDraft(p=>e.target.checked?deepHybridVortexParameters(p):hybridVortexParameters(p))}/><span className="switch"/>Глубокий возврат · 3 витка · 8/64 м</label>}{draft.freeRoutePattern==='vortex'&&draft.freeVortexContinuous&&<label className="route-toggle"><input type="checkbox" checked={draft.freeVortexMultiBand??false} onChange={e=>setDraft(p=>e.target.checked?multiBandVortexParameters(p):continuousVortexParameters(p))}/><span className="switch"/>Вглубь четырёх полос · 2Л + 2К</label>}{draft.freeVortexHybrid&&<label className="field"><span>Seed спиральной основы</span><input aria-label="Seed спиральной основы" value={draft.freeVortexBaseSeed??''} placeholder="Общий seed" maxLength={128} onChange={e=>setDraft(p=>({...p,freeVortexBaseSeed:e.target.value||undefined}))}/><small>Сохраняет рисунок спиралей; общий seed меняет межспиральные рамы, дворы и переходы.</small></label>}<label className="field"><span>Разброс индивидуальных углов, °</span><input aria-label="Разброс индивидуальных углов, °" type="number" min={0} max={120} step={5} value={draft.freeAngleSpread??100} onChange={e=>patch('freeAngleSpread',e.target.valueAsNumber)}/><small>0 — общие ортогональные оси. Ненулевое значение поворачивает каждый новый модуль относительно соседнего.</small></label><label className="route-toggle"><input type="checkbox" checked={draft.freeSpanPolicy==='maximum'} onChange={e=>setDraft(p=>maximumSpacingParameters(p,e.target.checked))}/><span className="switch"/>Стремиться к максимальному разнесению</label><p className="field-note">Сначала проверяются все положения с целевым пролётом. Уменьшение разрешено только при пересечениях или границе площадки. Включение задаёт пределы 8/16 м; затем их можно изменить.</p><label className="field"><span>Пролёт соединения, м</span><input aria-label="Пролёт соединения, м" type="number" min={1} max={3} step={0.1} value={draft.freeConnectionSpan??''} placeholder="Автоматически" onChange={e=>patch('freeConnectionSpan',e.target.value===''?undefined:e.target.valueAsNumber)}/><small>Максимальная боковая сторона соединения. Пустое поле — разные пролёты; в органическом гибриде они не превышают 3 м.</small></label><label className="field"><span>До связей в промежутках</span><input aria-label="До связей в промежутках" type="number" min={0} max={12} step={1} value={draft.freeInfillPassages??0} onChange={e=>patch('freeInfillPassages',e.target.valueAsNumber)}/><small>Добавляются к базовым циклам, только где помещаются. 0 — выключено. Для свободной одноэтажной планировки без мостов.</small></label></>}
          {draft.placementMode==='free'&&<><label className="field"><span>Зоны</span><select aria-label="Зоны" value={draft.freeZoneCount??0} onChange={e=>{const count=Number(e.target.value);setDraft(p=>({...p,freeZoneCount:count,freeIslandCount:count,extraConnections:Math.max(p.extraConnections,count+(p.freeBridgeCount??0))}));}}>{[0,2,3,4,5].map(n=><option key={n} value={n}>{n||'Без зон'}</option>)}</select><small>Связанные области с разным ростом ветвей. Для трёх зон и двух мостов начните с площадки 60×50 м.</small></label>{!!draft.freeZoneCount&&<label className="field"><span>Островов, не менее</span><input aria-label="Островов, не менее" type="number" min={0} max={draft.freeZoneCount} step={1} value={Number.isNaN(draft.freeIslandCount)?'':draft.freeIslandCount??draft.freeZoneCount} onChange={e=>{const count=e.target.valueAsNumber;setDraft(p=>({...p,freeIslandCount:count,extraConnections:Number.isFinite(count)?Math.max(p.extraConnections,count+(p.freeBridgeCount??0)):p.extraConnections}));}}/><small>Замкнутые недоступные участки, окружённые настоящими проходами.</small></label>}</>}
          {draft.placementMode==='free'&&<label className="field"><span>Крытые мосты</span><input aria-label="Крытые мосты" type="number" min={0} max={4} step={1} value={Number.isNaN(draft.freeBridgeCount)?'':draft.freeBridgeCount??0} onChange={e=>{const count=e.target.valueAsNumber;setDraft(p=>({...p,freeBridgeCount:count,extraConnections:Number.isFinite(count)?Math.max(Number.isFinite(p.extraConnections)?p.extraConnections:0,count+(p.freeIslandCount??p.freeZoneCount??0)):p.extraConnections}));}}/><small>Переходы над проходами с двумя лестницами. Необязательные мосты входят в дополнительные соединения.</small></label>}
          {draft.placementMode==='free'&&<><label className="field"><span>Обязательных мостов на пути</span><input aria-label="Обязательных мостов на пути" type="number" min={0} max={draft.freeBridgeCount??0} step={1} value={draft.freeRequiredBridgeCount??0} onChange={e=>patch('freeRequiredBridgeCount',e.target.valueAsNumber)}/><small>Их нельзя обойти наземным путём. Ноль сохраняет обычные мосты с обходами.</small></label><label className="coldspot-check"><input aria-label="Обязательный проход под мостом" type="checkbox" checked={!!draft.freeRequireUnderpass} onChange={e=>patch('freeRequireUnderpass',e.target.checked)}/> Обязательный проход под мостом до выхода</label><label className="field"><span>Модулей при генерации, цель</span><input aria-label="Модулей при генерации, цель" type="number" min={8} max={250} step={1} value={draft.freeModuleTarget??''} placeholder="Автоматически" onChange={e=>patch('freeModuleTarget',e.target.value===''?undefined:e.target.valueAsNumber)}/></label></>}

          {parameterNumber('Дополнительные соединения', 'extraConnections', 0, 20000)}
          {parameterNumber('Ловушки на маршруте, не менее', 'routeTrapCount', 0, 6)}
          {parameterNumber('Кольцевые ловушки, не менее', 'loopTrapCount', 0, 6)}
          <p className="hint">Кольцевая ловушка: два выхода с одной развилки соединены обходом и возвращают на неё. Требует дополнительных соединений.</p>
          <p className="field-note">{draft.moduleSize === undefined ? 'Добавляют циклы между существующими путями.' : 'Стены на модулях и между ними образуют единый лабиринт. Дополнительные связи добавляют циклы.'}</p>
          <p className="field-note">Разные развилки с ложным приближением к выходу. 0 — без требования к количеству. Если места недостаточно, генерация сообщит об этом.</p>
          {draft.generationType==='two-storey'&&<><label className="field"><span>Минимум смен этажей</span><input aria-label="Минимум смен этажей" type="number" min={2} max={200} step={2} value={draft.minFloorChanges??4} onChange={e=>patch('minFloorChanges',e.target.valueAsNumber)}/></label><p className="field-note">Квадратные модули. Вход и выход на первом этаже. Форму верхних площадок задайте отдельно; лестницы размещаются автоматически.</p></>}
          <DesignControls bridges={draft.placementMode==='free'&&!!draft.freeBridgeCount} fixedShape={draft.generationType==='two-storey'} living={draft.generationType==='living'} value={draft.design} onChange={value=>patch('design',value)}/>
          <label className="field seed-field"><span>Seed <small>ВОСПРОИЗВОДИМОСТЬ</small></span><div className="seed-input"><input value={draft.seed} maxLength={256} onChange={e => patch('seed', e.target.value)} spellCheck={false} /><button type="button" title="Новый seed" aria-label="Новый seed" onClick={() => patch('seed', `FIELD-${Date.now().toString(36).toUpperCase()}`)}>⟳</button></div></label>
          <button className="primary generate" disabled={busy||!!draftStatus.error} type="submit" aria-label="Сгенерировать">Сгенерировать <span aria-hidden="true">↗</span></button>
          {busy&&generationCancel.current&&<button className="blind-button" type="button" onClick={()=>generationCancel.current?.()}>Отменить генерацию</button>}
          <button className="blind-button" disabled={busy||!!draftStatus.error} type="button" onClick={() => regenerate(true)}>Сгенерировать и пройти вслепую <span>→</span></button>
          {dirty && <p className="draft-notice">Есть изменения. Применятся при генерации.</p>}
        </form>
        <ConstructionControls fixedHeight={!!maze.storeys||!!maze.free?.bridges?.length} value={maze} onChange={patch => setMaze(current => ({ ...current, ...patch }))} />
        {!shapeEditing && <PortalControls maze={maze} edit={portalEdit} onEdit={setPortalEdit} onChange={changePortals} />}
        {!shapeEditing && <EnvironmentControls maze={maze} onChange={changeEnvironment} />}
        </div>
        <div ref={analysisPanel} className="analysis-panel-anchor" hidden={section!=='maze'||shapeEditing}><ColdspotControls maze={maze} request={analysisRequest} onDisplay={setHeatDisplay} onOptimized={acceptOptimized} /></div>
        <div className="sidebar-bottom"><span className="mini-mark">ML /</span><span>Каждая развилка — эксперимент.</span></div>
      </aside>
      <main className="workspace">
        <nav className="workspace-tabs" aria-label="Разделы приложения">
          <button type="button" aria-pressed={section==='maze'} onClick={()=>switchSection('maze')}>Лабиринт</button>
          <button type="button" aria-pressed={section==='settings'} onClick={()=>switchSection('settings')}>Настройки</button>
        </nav>
        {maze.storeys&&<div className="floor-tabs" aria-label="Выбор этажа">{[0,1].map(f=><button type="button" key={f} aria-pressed={selectedFloor===f} onClick={()=>selectFloor(f)}>Этаж {f+1}</button>)}</div>}
        {maze.storeys&&<p className="living-summary">Модули: этаж 1 — {domainOf(maze.storeys.floors[0]).modules.reduce((a,b)=>a+b,0)} · этаж 2 — {domainOf(maze.storeys.floors[1]).modules.reduce((a,b)=>a+b,0)} · всего {moduleCount} · лестниц: {maze.storeys.stairs.length} · минимум переходов: {minimumFloorChanges(maze)} · площадь полов: {number(analysis.area,1)} м² · участок: {number(domainOf(maze.storeys.floors[0]).area,1)} м²</p>}
        <div className="workspace-header"><div><div className="eyebrow">РАБОЧАЯ ОБЛАСТЬ</div><h2>{maze.parameters.freeRoutePattern==='vortex'?'Вортексный':(maze.version===5||maze.version===7)?'Свободный':generationName(maze.parameters)} лабиринт <span>{maze.parameters.columns} × {maze.parameters.rows}</span></h2><div className="workspace-module-count" aria-label={maze.parameters.moduleSize===undefined?"Количество клеток":"Количество модулей"}>{maze.parameters.moduleSize===undefined?"Клетки":"Модули"}: <strong>{number(maze.parameters.moduleSize===undefined?analysis.cells:moduleCount)}</strong></div>{maze.version===4&&<p className="living-summary">2×2: {maze.layout!.modules.filter(m=>m.type==='2x2').length} · 2×6: {maze.layout!.modules.filter(m=>m.type==='2x6').length} · {number(analysis.area,1)} м² · {number(maze.width,1)} × {number(maze.depth,1)} м · стоек: {supportCount}{maze.layout?.spaces&&<> · площадка: {number(spaceSummary!.siteArea,1)} м² · недоступно: {number(spaceSummary!.inaccessibleArea,1)} м² · залов: {spaceSummary!.halls} · островов: {spaceSummary!.islands}</>}</p>}{livingInfo&&<p className="living-summary">{livingInfo.supported===false?livingInfo.reason:<>{livingInfo.layers} слоёв · {livingInfo.ratio===null?'нет контурных связей':number(livingInfo.ratio*100)+'% контурных связей'}{livingInfo.layers<2?' · Недостаточно места для нескольких вложенных контуров.':''}</>}</p>}</div><div className="file-actions">{(maze.version===5||maze.version===7)&&<label className="route-toggle"><input type="checkbox" role="switch" aria-label="Редактор свободного размещения" checked={false} onChange={()=>setFreeDocument(mazeDraft(maze))}/>Редактор свободного размещения</label>}{maze.parameters.moduleSize!==undefined&&maze.version!==6&&(maze.version!==5&&maze.version!==7)&&<button onClick={()=>{try{setFreeDocument(convertToFree(maze));}catch(e){setError(String(e));}}}>Создать свободную копию</button>}<button onClick={()=>setLibraryOpen(true)}>Библиотека</button><button disabled={busy} onClick={()=>void saveShared()}>В библиотеку</button><button disabled={busy} onClick={() => void load()}><span aria-hidden="true">↥</span> Открыть</button><button disabled={busy} onClick={() => void save()}><span aria-hidden="true">↧</span> Сохранить</button></div></div>
        {!!maze.free?.zones?.length&&<p className="living-summary">Зон: {freeZoneSummary(maze.free).length} · замкнутых островов: {freeIslands(maze.free).length}. Состав и зоны сохраняются в JSON.</p>}
        {!!maze.free?.bridges?.length&&<p className="living-summary">Крытых мостов: {maze.free.bridges.length} · лестниц: {maze.free.bridges.length*2}. Пунктир М на плане — верхний проход; пересечение с нижним не создаёт развилку. Высоту стен меняйте в редакторе вместе с геометрией мостов.</p>}
        <LibraryPanel open={libraryOpen} revision={libraryRevision} onClose={()=>setLibraryOpen(false)} onMaze={openLibraryMaze} onWalk={openLibraryWalk} onPlay={next=>{openLibraryMaze(next);void beginWalk(next);}}/>
        <div className="view-toolbar"><div className="view-tabs"><span className="active"><span>▦</span> Карта</span><button disabled={!analysis.reachable||busy} onClick={() => { resetNotice(); void beginWalk(maze); }}><span>◉</span> Пройти от первого лица <span>↗</span></button></div><button type="button" className="analyze-shortcut" disabled={busy} onClick={()=>setMode('inspect')}>Осмотреть снаружи</button><button type="button" className="analyze-shortcut" onClick={requestAnalysis}>Проанализировать</button><label className="route-toggle"><input type="checkbox" checked={!!maze.roof} onChange={e=>setMaze(current=>({...current,roof:e.target.checked}))}/><span className="switch"/>Крыша</label><label className="route-toggle"><input type="checkbox" checked={showRoute} onChange={e => setShowRoute(e.target.checked)} /><span className="switch" />Кратчайший путь</label></div>
        <div className={`map-panel ${shapeEditing ? 'editing-shape' : ''} ${portalEdit!==null?'editing-portals':''}`}>
          {!shapeEditing && <div className="map-topline"><span><i className="live-dot" /> {analysis.reachable ? 'ВЫХОД ДОСТИЖИМ' : 'ВЫХОД НЕДОСТИЖИМ'}</span><span>ВИД СВЕРХУ / МЕТРЫ</span></div>}
          {shapeEditing && shapeDraft.shape ? <ShapeEditor value={shapeDraft} onChange={updateShape} underlay={draft.generationType==='two-storey'&&selectedFloor===1?draft:undefined} selected={shapeSelected} onSelect={setShapeSelected} tool={shapeTool}/> : <MapCanvas floor={selectedFloor} maze={maze} heat={heatDisplay} showRoute={showRoute} recorder={result?.recorder ?? null} onPlacePortal={portalEdit === null || maze.storeys&&selectedFloor===1 ? undefined : placePortal} onEnvironmentChange={changeEnvironment} />}
          {!shapeEditing && <div className="map-legend"><span><i className="legend-wall" /> Стены</span><span><i className="legend-route" /> Кратчайший путь</span>{result && <span><i className="legend-actual" /> Твой путь</span>}</div>}
        </div>
        {maze.free?.cavityReport&&<CavityReportPanel report={maze.free.cavityReport}/>}
        <section className="metrics-section" aria-label="Метрики лабиринта"><div className="metrics-title"><span className="eyebrow">АНАЛИЗ ТОПОЛОГИИ</span><span>{number(analysis.area, 1)} м² · габариты сетки {number(maze.width, 1)} × {number(maze.depth, 1)} м</span></div><div className="metric-grid">
          <Metric label={maze.parameters.moduleSize === undefined ? 'КЛЕТКИ' : 'УЗЛЫ ГРАФА'} value={number(analysis.cells)} detail={`${maze.parameters.moduleSize === undefined ? '' : `${domainOf(maze).modules.reduce((a,b)=>a+b,0)} модулей · `}${number(analysis.corridors)} коридоров`} />
          <Metric label="ТУПИКИ" value={number(analysis.deadEnds)} detail="точки возврата" />
          <Metric label="РАЗВИЛКИ" value={number(analysis.junctions)} detail="3 и более направлений" />
          <Metric label="ЦИКЛЫ" value={number(analysis.cycles)} detail={`${analysis.components} комп. · E − V + C`} />
          <Metric label="КРАТЧАЙШИЙ ПУТЬ" value={number(analysis.optimalLength, 1)} unit="м" detail={`${number(analysis.routeAreaRatio, 3)} м/м² · ${maze.version===4||maze.free?'через проёмы, с учётом высоты':'по центрам клеток'}`} accent />
        </div></section>
        {result && <section className="results" aria-label="Результаты прохождения"><div className="result-heading"><span className="eyebrow">{result.finished ? 'ВЫХОД НАЙДЕН' : 'ПРОХОЖДЕНИЕ ОСТАНОВЛЕНО'}</span><button aria-label="Закрыть результаты" onClick={() => setResult(null)}>×</button></div><div className="result-values"><div><strong>{formatTime(result.recorder.elapsed)}</strong><span>время в движении и исследовании</span></div><div><strong>{number(result.recorder.distance, 1)} <small>м</small></strong><span>твой путь</span></div><div><strong>{number(analysis.optimalLength, 1)} <small>м</small></strong><span>{maze.version===4||maze.free?'маршрут-эталон через проёмы':'кратчайший путь по центрам клеток'}</span></div><div><strong>{result.finished ? `${number(result.recorder.distance/analysis.optimalLength, 2)}×` : '—'}</strong><span>отношение к кратчайшему</span></div></div>{walkAssessment?.exploration&&<><div className="result-values exploration-values" aria-label="Разведка боковых веток"><div><strong>{number(walkAssessment.exploration.exploredOptionalRatio*100)}%</strong><span>боковой площади разведано</span></div><div><strong>{walkAssessment.exploration.firstDetourChoices}/{walkAssessment.exploration.assessedFirstChoices}</strong><span>первый выбор боковой ветки</span></div><div><strong>{walkAssessment.exploration.deepBranches}</strong><span>веток глубиной ≥6 м</span></div><div><strong>{number(walkAssessment.exploration.uniqueExplorationRatio*100)}%</strong><span>разведка сверх кратчайшего пути</span></div></div><p className="walk-observations">Повторы: {number(walkAssessment.exploration.repeatedLength)} м по центрам. Обязательный маршрут занимает {number(walkAssessment.exploration.mandatoryAreaRatio*100)}% площади. Эти метрики отделяют разведку от обязательного пути и повторов.</p></>}<p>{walkAssessment && <span className="walk-observations">По записи: посещено {number(walkAssessment.coveredAreaRatio*100)}% площади; на {walkAssessment.decisionCount} развилках продолжил прямо {walkAssessment.continuedStraight} раз; из {walkAssessment.comparableCorridorChoices} выборов с разной видимой длиной выбрал длиннейший {walkAssessment.longestCorridorChoices} раз. Оценка по движению; отдельно сохранены только направления, отмеченные клавишей F.</span>}{maze.version===4||maze.free?'Маршрут-эталон проходит через реальные проёмы с учётом радиуса игрока и высоты переходов.':'Маршрут-эталон идёт по центрам клеток; свободное движение со срезанием углов может дать отношение меньше 1.'}</p></section>}
        <footer className="workspace-footer"><span>{maze.parameters.generationType==='corridor'?'Коридорный · смешанные модули':maze.parameters.generationType==='living'?'Живой · вложенные контуры':maze.parameters.algorithm === 'backtracker' ? 'Классический · Recursive Backtracker' : 'Классический · Randomized Prim'} <b>·</b> Seed: {maze.parameters.seed || '(пустой)'}</span><span>{generationMs === null ? 'ЛОКАЛЬНО · БЕЗ ТЕЛЕМЕТРИИ' : `ГЕНЕРАЦИЯ ${number(generationMs, 1)} мс`}</span></footer>
      </main>
    </> : <main className="walk-main"><WalkCanvas maze={maze} inspection={mode==='inspect'} onCancel={endInspection} onEnd={mode==='inspect'?endInspection:onEnd} onError={onWalkError} onCheckpoint={mode==='inspect'?undefined:onCheckpoint} /></main>}
    {(message || error) && <div className={`notification ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button onClick={resetNotice} aria-label="Закрыть уведомление">×</button></div>}
  </div>;
}

function Metric({ label, value, detail, unit, accent }: { label: string; value: string; detail: string; unit?: string; accent?: boolean }) {
  return <div className={`metric ${accent ? 'accent' : ''}`}><span>{label}</span><strong>{value}{unit && <small> {unit}</small>}</strong><p>{detail}</p></div>;
}

const root = document.getElementById('app');
if (!root) throw new Error('Не найден контейнер приложения.');
createRoot(root).render(<App />);
