import {bridgeInspectionSolids} from '../free/bridges';
import {floorOf} from '../core/two-storey';
import type { HeatDisplay } from './coldspot-controls';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {trapOverlay} from './trap-overlay';
import {routeTraps} from '../analysis/route-traps';
import {type CriticalWall,detailedCriticalWallsAvailable} from '../analysis/critical-walls';
import { walls, type Maze, type Portal } from '../core/maze';
import { mazePortals, samePortal } from '../core/portals';
import type { Environment } from '../core/environment';
import { supportColliders } from '../core/structure';
import { CollisionWorld } from '../simulation/collisions';
import { Player } from '../simulation/player';
import type { Recorder } from '../simulation/recorder';
import type { WalkScene } from '../renderer/scene';
import { MapView } from './map-view';
import { TouchControls } from './touch-controls';
import { applyTouchLook, applyTouchMovement, neutralStick, touchControlsAvailable, type StickVector } from './touch-input';

export function MapCanvas({ maze,floor=0, heat, showRoute, recorder, onPlacePortal, onEnvironmentChange }: {
  floor?:number;maze: Maze; heat?: HeatDisplay|null; showRoute: boolean; recorder: Recorder | null; onPlacePortal?: (portal: Portal | null) => void;
  onEnvironmentChange?: (environment: Environment) => void;
}) {
  const [hover,setHover]=useState<{x:number;y:number;text:string}|null>(null);
  const [trapState,setTrapState]=useState<{maze:Maze|null;show:boolean;critical:boolean;selected:string}>({maze:null,show:false,critical:false,selected:'all'});
  const showTraps=trapState.maze===maze&&trapState.show,selected=trapState.maze===maze?trapState.selected:'all';
  const showCritical=trapState.maze===maze&&trapState.critical;
  const [criticalProgress,setCriticalProgress]=useState<{done:number;total:number}|null>(null);
  const [criticalState,setCriticalState]=useState<{maze:Maze;walls:CriticalWall[];error?:string}|null>(null);
  const protectedWalls=useMemo(()=>showCritical&&criticalState?.maze===maze?criticalState.walls:[],[maze,showCritical,criticalState]);
  const criticalPending=showCritical&&criticalState?.maze!==maze;
  useEffect(()=>{
    if(!showCritical||criticalState?.maze===maze)return;
    setCriticalProgress(null);
    let worker:Worker|undefined,active=true;
    try{
      worker=new Worker(new URL('../analysis/critical-walls-worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=e=>{if(e.data.progress){if(active)setCriticalProgress(e.data.progress);return;}if(active)setCriticalState({maze,walls:e.data.walls??[],error:e.data.error});worker?.terminate();};
      worker.onerror=e=>{e.preventDefault();if(active)setCriticalState({maze,walls:[],error:e.message||'Ошибка расчёта критических стен.'});worker?.terminate();};
      worker.postMessage(maze);
    }catch(e){setCriticalState({maze,walls:[],error:String(e)});}
    return ()=>{active=false;worker?.terminate();};
  },[maze,showCritical,criticalState]);
  const trapAnalysis=useMemo(()=>showTraps?routeTraps(maze):null,[maze,showTraps]);
  const allTraps=useMemo(()=>trapAnalysis?trapOverlay(maze,trapAnalysis):[],[maze,trapAnalysis]);
  const visibleTraps=useMemo(()=>selected==='all'?allTraps:allTraps.filter(t=>String(t.fork)===selected),[allTraps,selected]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<MapView | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const map = new MapView(canvas.current, maze); view.current = map;
    return () => { map.dispose(); view.current = null; };
  }, [maze]);
  useEffect(()=>{if(view.current){view.current.floor=floor;view.current.draw();}},[maze,floor]);
  useEffect(() => {
    if (view.current) view.current.onPlacePortal = onPlacePortal ?? null;
  }, [maze, onPlacePortal]);
  useEffect(() => {
    if (view.current) view.current.onEnvironmentChange = onEnvironmentChange ?? null;
  }, [maze, onEnvironmentChange]);
  useEffect(() => {
    if (!view.current) return;
    view.current.showRoute = showRoute; view.current.trajectory = recorder?.samples ?? []; view.current.draw();
  }, [maze, showRoute, recorder]);
  useEffect(()=> {
    if(view.current) {view.current.heat=heat??null;view.current.draw();}setHover(null);
  },[maze,heat]);
  useEffect(()=>{
    if(view.current){view.current.traps=visibleTraps.filter(t=>!maze.storeys||floorOf(maze,t.fork)===floor);view.current.draw();}setHover(null);
  },[maze,visibleTraps,floor]);
  useEffect(()=>{if(view.current){view.current.criticalWalls=protectedWalls.filter(w=>!maze.storeys||w.wall.floor===floor);view.current.draw();}setHover(null);},[maze,protectedWalls,floor]);
  return <>
    <canvas ref={canvas} onPointerLeave={()=>setHover(null)} onPointerMove={event=>{
      if(event.buttons || (!heat&&!showTraps&&!showCritical)) {setHover(null);return;}
      const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      const text=view.current?.heatDetailsAt(x,y);
      setHover(text?{x:Math.max(8,Math.min(rect.width-228,x+12)),y:Math.max(8,Math.min(rect.height-120,y+12)),text}:null);
    }} className={`map-canvas ${onPlacePortal ? 'placing-portal' : ''}`} aria-label="План лабиринта. Колесо — масштаб, перетаскивание — перемещение." />
    {heat && <div className="heat-legend" aria-label="Легенда горячести"><span className="heat-scale"/><span>{heat.layer==='probability'?'0–100% · посещение до финиша':'Реже → чаще · средние посещения'}{heat.coldOnly?' · только холодные':''}</span></div>}
    <div className="trap-map-controls">
      <label><input type="checkbox" aria-label="Ловушки на карте" checked={showTraps} onChange={e=>setTrapState({maze,show:e.target.checked,critical:showCritical,selected:'all'})}/> Ловушки на карте</label>
      {showTraps&&<><span role="status">{!trapAnalysis?.supported?'Нужна связная область':allTraps.length?`Ловушек по критериям модели: ${allTraps.length}`:'Подходящих ловушек не найдено'}</span>
      {allTraps.length>1&&<select aria-label="Выбрать ловушку" value={selected} onChange={e=>setTrapState({maze,show:true,critical:showCritical,selected:e.target.value})}><option value="all">Все ловушки</option>{allTraps.map(t=><option key={t.fork} value={t.fork}>{t.label}</option>)}</select>}</>}
      <label><input type="checkbox" aria-label="Критические стены" checked={showCritical} onChange={e=>setTrapState({maze,show:showTraps,critical:e.target.checked,selected})}/> Критические стены</label>
      {showCritical&&<span role="status" aria-label="Расчёт критических стен">{criticalPending?`Вычисляем критические стены…${criticalProgress?' '+criticalProgress.done+'/'+criticalProgress.total:''}`:criticalState?.error?`Не удалось рассчитать: ${criticalState.error}`:`Защищённых стен: ${protectedWalls.length}${maze.free?' · проёмы, тупиковые и кольцевые ловушки':!detailedCriticalWallsAvailable(maze)?' · на большой карте только проёмы':''}`}</span>}
      {showCritical&&criticalState?.error&&<button onClick={()=>setCriticalState(null)}>Повторить расчёт</button>}
    </div>
    {(showTraps&&allTraps.length>0||showCritical)&&<div className={`trap-map-legend ${heat?'with-heat':''}`} aria-label="Легенда ловушек">{showTraps&&allTraps.length>0&&<><span><i className="trap-false"/> Ложный путь · × тупик</span><span><i className="trap-away"/> Путь дальше</span><span>Л1… · тупиковые · К1… · кольцевые</span></>}{showCritical&&<span><i className="trap-protected"/> Критические стены</span>}</div>}
    {hover && <div className="heat-tooltip" role="status" style={{left:hover.x,top:hover.y}}>{hover.text}</div>}
    <div className="map-tools" aria-label="Масштаб карты">
      <button title="Приблизить" aria-label="Приблизить" onClick={() => view.current?.zoomBy(1.25)}>+</button>
      <button title="Отдалить" aria-label="Отдалить" onClick={() => view.current?.zoomBy(0.8)}>−</button>
      <span />
      <button title="Вписать в экран" aria-label="Вписать в экран" onClick={() => view.current?.fit()}>⌖</button>
    </div>
    <div className="map-hint">КОЛЕСО · МАСШТАБ <span /> ТЯНИТЕ КАРТУ ИЛИ ОРИЕНТИР</div>
  </>;
}

export interface WalkResult { recorder: Recorder; finished: boolean; id?:string }

export function WalkCanvas({ maze, onEnd, onCancel, onError, onCheckpoint, inspection=false }: {
  maze: Maze; onCancel: () => void; onEnd: (result: WalkResult) => void; onError: (message: string) => void; onCheckpoint?: (result:WalkResult)=>void; inspection?:boolean;
}) {
  const portals = mazePortals(maze);
  const startNumber = portals.findIndex(p => samePortal(p, maze.entrance))+1;
  const finishNumber = portals.findIndex(p => samePortal(p, maze.exit))+1;
  const canvas = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const runId = useRef(crypto.randomUUID());
  const [locked, setLocked] = useState(false);
  const [touch, setTouch] = useState(touchControlsAvailable);
  const touchRef = useRef(touch);
  touchRef.current = touch;
  const activeRef = useRef(false);
  const endedRef = useRef(false);
  const moveRef = useRef(neutralStick()), lookRef = useRef(neutralStick());
  const setMove = useCallback((v: StickVector) => { moveRef.current = v; }, []);
  const setLook = useCallback((v: StickVector) => { lookRef.current = v; }, []);
  const clearTouch = () => { moveRef.current = neutralStick(); lookRef.current = neutralStick(); };
  const pause = () => {
    activeRef.current = false; clearTouch(); setLocked(false);
    if (document.pointerLockElement === canvas.current) document.exitPointerLock();
  };
  const [stats, setStats] = useState({ distance: 0, elapsed: 0 });
  const [lockError, setLockError] = useState('');
  const lock = async () => {
    if (endedRef.current) return;
    if (touch) { clearTouch(); activeRef.current = true; setLocked(true); return; }
    try { await canvas.current?.requestPointerLock(); setLockError(''); }
    catch { setLockError('Браузер не разрешил захват мыши. Можно повторить попытку или продолжить с джойстиками: они работают мышью и касанием.'); }
  };
  useEffect(() => {
    if (!canvas.current) return;
    const element = canvas.current;
    let cancelled = false;
    let cleanup = () => {};
    void (async () => {
    let scene: WalkScene;
    try {
      const { WalkScene } = await import('../renderer/scene');
      if (cancelled) return;
      scene = new WalkScene(element); scene.setMaze(maze);
    }
    catch (error) { onError(`3D недоступен: ${error instanceof Error ? error.message : String(error)}`); return; }
    const player = new Player(maze, new CollisionWorld([...walls(maze), ...supportColliders(maze),...(inspection&&maze.free?bridgeInspectionSolids(maze.free):[])], maze.parameters.corridorWidth),inspection?'inspection':'walk');
    playerRef.current = player;
    const keys = new Set<string>();
    const keyDown = (event: KeyboardEvent) => {
      if (document.pointerLockElement !== element) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) { event.preventDefault(); keys.add(event.code); }
    };
    const keyUp = (event: KeyboardEvent) => { keys.delete(event.code); };
    const clear = () => { keys.clear(); clearTouch(); };
    const suspend = () => { clear(); activeRef.current = false; setLocked(false); if (document.pointerLockElement === element) document.exitPointerLock(); checkpoint(); };
    const visibility = () => { if (document.hidden) suspend(); };
    const change = () => { const active = document.pointerLockElement === element; activeRef.current = active; setLocked(active); clear(); };
    const mouse = (event: MouseEvent) => {
      if (document.pointerLockElement !== element) return;
      player.yaw -= event.movementX*0.002;
      player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch-event.movementY*0.002));
    };
    document.addEventListener('keydown', keyDown); document.addEventListener('keyup', keyUp);
    document.addEventListener('mousemove', mouse); document.addEventListener('pointerlockchange', change);
    window.addEventListener('blur', suspend);
    window.addEventListener('maze:native-pause', suspend);
    document.addEventListener('visibilitychange', visibility);
    let frame = 0, previous = performance.now(), lastStats = previous, lastCheckpoint=previous, savedDistance=0, stopped = false;
    const loop = (now: number) => {
      if (stopped || endedRef.current) return;
      const dt = (now-previous)/1000; previous = now;
      // Long interruptions are pauses, rather than a burst of movement on refocus.
      if (activeRef.current && !document.hidden && dt < 0.25) {
        if (touchRef.current) {
          applyTouchLook(player, lookRef.current, dt);
          applyTouchMovement(player, moveRef.current, dt);
        } else player.update(dt, keys);
      }
      scene.render(player);
      if (now-lastStats > 100) { setStats({ distance: player.recorder.distance, elapsed: player.recorder.elapsed }); lastStats = now; }
      if(!inspection&&now-lastCheckpoint>10_000 && player.recorder.distance>savedDistance+.01) {
        onCheckpoint?.({id:runId.current,recorder:player.recorder,finished:false});lastCheckpoint=now;savedDistance=player.recorder.distance;
      }
      if (player.finished) { endedRef.current = true; suspend(); onEnd({ id:runId.current,recorder: player.recorder, finished: true }); return; }
      frame = requestAnimationFrame(loop);
    };
    function checkpoint() {
      // Native backgrounding can happen before the periodic save or pagehide.
      // Never create idle runs or emit an in-progress save after a terminal result.
      if (inspection || endedRef.current || player.recorder.distance <= .01 || player.recorder.distance <= savedDistance) return;
      onCheckpoint?.({ id: runId.current, recorder: player.recorder, finished: false });
      savedDistance = player.recorder.distance; lastCheckpoint = performance.now();
    }
    window.addEventListener('pagehide',checkpoint);
    frame = requestAnimationFrame(loop);
    cleanup = () => {
      stopped = true; cancelAnimationFrame(frame);window.removeEventListener('pagehide',checkpoint);
      if (document.pointerLockElement === element) document.exitPointerLock();
      document.removeEventListener('keydown', keyDown); document.removeEventListener('keyup', keyUp);
      document.removeEventListener('mousemove', mouse); document.removeEventListener('pointerlockchange', change);
      window.removeEventListener('blur', suspend); window.removeEventListener('maze:native-pause', suspend); document.removeEventListener('visibilitychange', visibility); clear(); scene.dispose(); playerRef.current = null;
    };
    })();
    return () => { cancelled = true; cleanup(); };
  }, [maze, onEnd, onError, onCheckpoint,inspection]);
  const stop = () => {
    const player = playerRef.current;
    if (endedRef.current) return;
    endedRef.current = true; pause();
    // Previewing the start screen is not a stopped attempt. Cancellation also
    // works while the lazy scene is still loading and preserves earlier results.
    if (!player || inspection || player.recorder.elapsed === 0) { onCancel(); return; }
    if (player.recorder.distance > 0) player.recorder.record(player.position, player.recorder.elapsed, true);
    onEnd({ id:runId.current,recorder: player.recorder, finished: false });
  };
  return <div className={`walk-view ${touch ? 'touch-walk' : ''}`}>
    <canvas ref={canvas} className="walk-canvas" aria-label={inspection?'Осмотр сооружения снаружи':'Лабиринт от первого лица'} onClick={() => { if (!locked && !touch) void lock(); }} />
    <div className="walk-hud">{inspection?<span><i className="live-dot" /> ОСМОТР · БЕЗ ЗАПИСИ ПРОХОЖДЕНИЯ</span>:<><span><i className="live-dot" /> СТАРТ {startNumber} → ФИНИШ {finishNumber}</span><strong>{formatTime(stats.elapsed)}</strong><strong>{stats.distance.toFixed(1)} <small>м</small></strong></>}</div>
    <button className="back-map" onClick={stop}>← Вернуться к карте</button>
    {locked && <div className="crosshair">+</div>}
    {locked && touch && <><button className="walk-pause" onClick={pause}>Ⅱ Пауза</button><TouchControls onMove={setMove} onLook={setLook} onError={onError} /></>}
    {!locked && <div className="walk-overlay"><div className="walk-intro">
      <span className="eyebrow">{inspection?'ОСМОТР СООРУЖЕНИЯ':'ПОЛЕВОЕ ИССЛЕДОВАНИЕ / 01'}</span>
      <h2>{inspection?'Посмотри снаружи.':stats.elapsed > 0 ? 'Продолжим путь?' : 'Найди свой выход.'}</h2>
      {inspection?<p>Обойди сооружение и осмотри каркас. Стены остаются препятствиями.<br />Осмотр не записывается как прохождение.</p>:<p>Вход {startNumber} → выход {finishNumber}. Найди выбранный выход.<br />После прохождения сравним твой путь с кратчайшим.</p>}
      <p>Ориентир выхода — А-образная башня высотой 6 м. Крыша и стены могут закрывать её изнутри.</p>
      {touch ? <div className="key-guide touch-guide"><span>ЛЕВЫЙ · ходьба / бег</span><span>ПРАВЫЙ · обзор</span></div> : <div className="key-guide"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> движение</span><span><kbd>⇧</kbd> быстрее</span><span>МЫШЬ · обзор</span></div>}
      <label className="walk-touch-choice"><input type="checkbox" checked={touch} onChange={event => { clearTouch(); setTouch(event.target.checked); }} /> Управление двумя джойстиками</label>
      <button className="primary" onClick={() => void lock()}>{inspection?'Начать осмотр':stats.elapsed > 0 ? 'Продолжить' : 'Начать прохождение'} <span>↗</span></button>
      <small>{touch ? 'Чем сильнее отклонён левый джойстик, тем быстрее движение: у края — бег. Кнопка «Пауза» останавливает таймер.' : 'Esc — пауза и освобождение курсора. Таймер на паузе не идёт.'}</small>
      {lockError && <><p role="alert">{lockError}</p><button onClick={() => { clearTouch(); setTouch(true); setLockError(''); activeRef.current = true; setLocked(true); }}>Продолжить с джойстиками</button></>}
    </div></div>}
    <div className="walk-footer">ВЫСОТА ГЛАЗ 1,7 м <span /> СТЕНЫ {maze.wallHeight.toLocaleString('ru-RU')} м <span /> {maze.roof ? 'С КРЫШЕЙ' : 'ОТКРЫТОЕ НЕБО'} <span /> СКОРОСТЬ {touch ? 'ДО 2,8' : '1,4'} м/с</div>
  </div>;
}

export function formatTime(seconds: number): string {
  return `${Math.floor(seconds/60).toString().padStart(2, '0')}:${Math.floor(seconds%60).toString().padStart(2, '0')}`;
}
