import { useEffect, useRef, useState } from 'react';
import { walls, type Maze } from '../core/maze';
import { supportColliders } from '../core/structure';
import { CollisionWorld } from '../simulation/collisions';
import { Player } from '../simulation/player';
import type { Recorder } from '../simulation/recorder';
import type { WalkScene } from '../renderer/scene';
import { MapView } from './map-view';

export function MapCanvas({ maze, showRoute, recorder }: { maze: Maze; showRoute: boolean; recorder: Recorder | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<MapView | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const map = new MapView(canvas.current, maze); view.current = map;
    return () => { map.dispose(); view.current = null; };
  }, [maze]);
  useEffect(() => {
    if (!view.current) return;
    view.current.showRoute = showRoute; view.current.trajectory = recorder?.samples ?? []; view.current.draw();
  }, [maze, showRoute, recorder]);
  return <>
    <canvas ref={canvas} className="map-canvas" aria-label="План лабиринта. Колесо — масштаб, перетаскивание — перемещение." />
    <div className="map-tools" aria-label="Масштаб карты">
      <button title="Приблизить" aria-label="Приблизить" onClick={() => view.current?.zoomBy(1.25)}>+</button>
      <button title="Отдалить" aria-label="Отдалить" onClick={() => view.current?.zoomBy(0.8)}>−</button>
      <span />
      <button title="Вписать в экран" aria-label="Вписать в экран" onClick={() => view.current?.fit()}>⌖</button>
    </div>
    <div className="map-hint">КОЛЕСО · МАСШТАБ <span /> ПЕРЕТАСКИВАНИЕ · ПЕРЕМЕЩЕНИЕ</div>
  </>;
}

export interface WalkResult { recorder: Recorder; finished: boolean }

export function WalkCanvas({ maze, onEnd, onError }: {
  maze: Maze; onEnd: (result: WalkResult) => void; onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [locked, setLocked] = useState(false);
  const [stats, setStats] = useState({ distance: 0, elapsed: 0 });
  const [lockError, setLockError] = useState('');
  const lock = async () => {
    try { await canvas.current?.requestPointerLock(); setLockError(''); }
    catch { setLockError('Не удалось захватить мышь. Нажмите ещё раз или проверьте разрешения окна.'); }
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
    const player = new Player(maze, new CollisionWorld([...walls(maze), ...supportColliders(maze)], maze.parameters.corridorWidth));
    playerRef.current = player;
    const keys = new Set<string>();
    const keyDown = (event: KeyboardEvent) => {
      if (document.pointerLockElement !== element) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) { event.preventDefault(); keys.add(event.code); }
    };
    const keyUp = (event: KeyboardEvent) => { keys.delete(event.code); };
    const clear = () => keys.clear();
    const change = () => { setLocked(document.pointerLockElement === element); clear(); };
    const mouse = (event: MouseEvent) => {
      if (document.pointerLockElement !== element) return;
      player.yaw -= event.movementX*0.002;
      player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch-event.movementY*0.002));
    };
    document.addEventListener('keydown', keyDown); document.addEventListener('keyup', keyUp);
    document.addEventListener('mousemove', mouse); document.addEventListener('pointerlockchange', change);
    window.addEventListener('blur', clear);
    let frame = 0, previous = performance.now(), lastStats = previous, stopped = false;
    const loop = (now: number) => {
      if (stopped) return;
      const dt = (now-previous)/1000; previous = now;
      // Long interruptions are pauses, rather than a burst of movement on refocus.
      if (document.pointerLockElement === element && !document.hidden && dt < 0.25) player.update(dt, keys);
      scene.render(player);
      if (now-lastStats > 100) { setStats({ distance: player.recorder.distance, elapsed: player.recorder.elapsed }); lastStats = now; }
      if (player.finished) { document.exitPointerLock(); onEnd({ recorder: player.recorder, finished: true }); return; }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    cleanup = () => {
      stopped = true; cancelAnimationFrame(frame);
      if (document.pointerLockElement === element) document.exitPointerLock();
      document.removeEventListener('keydown', keyDown); document.removeEventListener('keyup', keyUp);
      document.removeEventListener('mousemove', mouse); document.removeEventListener('pointerlockchange', change);
      window.removeEventListener('blur', clear); scene.dispose(); playerRef.current = null;
    };
    })();
    return () => { cancelled = true; cleanup(); };
  }, [maze, onEnd, onError]);
  const stop = () => {
    const player = playerRef.current;
    if (!player) return;
    player.recorder.record(player.position, player.recorder.elapsed, true);
    onEnd({ recorder: player.recorder, finished: false });
  };
  return <div className="walk-view">
    <canvas ref={canvas} className="walk-canvas" aria-label="Лабиринт от первого лица" onClick={() => { if (!locked) void lock(); }} />
    <div className="walk-hud"><span><i className="live-dot" /> ПРОХОЖДЕНИЕ ВСЛЕПУЮ</span><strong>{formatTime(stats.elapsed)}</strong><strong>{stats.distance.toFixed(1)} <small>м</small></strong></div>
    <button className="back-map" onClick={stop}>← Вернуться к карте</button>
    {locked && <div className="crosshair">+</div>}
    {!locked && <div className="walk-overlay"><div className="walk-intro">
      <span className="eyebrow">ПОЛЕВОЕ ИССЛЕДОВАНИЕ / 01</span>
      <h2>{stats.elapsed > 0 ? 'Продолжим путь?' : 'Найди свой выход.'}</h2>
      <p>Карта скрыта. Выбирай направление, исследуй развилки.<br />После прохождения сравним твой путь с кратчайшим.</p>
      <div className="key-guide"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> движение</span><span><kbd>⇧</kbd> быстрее</span><span>МЫШЬ · обзор</span></div>
      <button className="primary" onClick={() => void lock()}>{stats.elapsed > 0 ? 'Продолжить' : 'Начать прохождение'} <span>↗</span></button>
      <small>Esc — пауза и освобождение курсора. Таймер на паузе не идёт.</small>
      {lockError && <p role="alert">{lockError}</p>}
    </div></div>}
    <div className="walk-footer">ВЫСОТА ГЛАЗ 1,7 м <span /> СТЕНЫ {maze.wallHeight.toLocaleString('ru-RU')} м <span /> {maze.roof ? 'С КРЫШЕЙ' : 'ОТКРЫТОЕ НЕБО'} <span /> СКОРОСТЬ 1,4 м/с</div>
  </div>;
}

export function formatTime(seconds: number): string {
  return `${Math.floor(seconds/60).toString().padStart(2, '0')}:${Math.floor(seconds%60).toString().padStart(2, '0')}`;
}
