import { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Algorithm, Parameters, Maze, Portal } from './core/maze';
import { mazePortals, samePortal, transferPortals, withPortals } from './core/portals';
import { metrics } from './core/metrics';
import { generate } from './generators/generate';
import { loadMaze, saveMaze } from './persistence/files';
import { MapCanvas, WalkCanvas, formatTime, type WalkResult } from './ui/views';
import { ConstructionControls } from './ui/construction-controls';
import { PortalControls, type PortalEdit } from './ui/portal-controls';
import { EnvironmentControls } from './ui/environment-controls';
import type { Environment } from './core/environment';
import './style.css';

const initial: Parameters = { columns: 5, rows: 5, corridorWidth: 2, moduleSize: 2, extraConnections: 0, seed: 'FIELD-024', algorithm: 'backtracker' };
const number = (value: number, digits = 0) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });

function Logo() {
  return <svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M6 30V6h24v24H18V18h12M6 18h12M18 6v6" stroke="currentColor" strokeWidth="2.5" /></svg>;
}

function App() {
  const [maze, setMaze] = useState(() => generate(initial));
  const [draft, setDraft] = useState<Parameters>(initial);
  const [mode, setMode] = useState<'map' | 'walk'>('map');
  const [showRoute, setShowRoute] = useState(false);
  const [result, setResult] = useState<WalkResult | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generationMs, setGenerationMs] = useState<number | null>(null);
  const [portalEdit, setPortalEdit] = useState<PortalEdit>(null);
  const analysis = useMemo(() => metrics(maze), [maze]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(maze.parameters);
  const patch = <K extends keyof Parameters>(key: K, value: Parameters[K]) => setDraft(p => ({ ...p, [key]: value }));
  const resetNotice = () => { setError(''); setMessage(''); };
  const changePortals = (next: Maze) => { setMaze(next); setResult(null); resetNotice(); };
  const changeEnvironment = (environment: Environment) => { setMaze(current => ({ ...current, environment })); resetNotice(); };
  const placePortal = (portal: Portal | null) => {
    if (!portal) { setError('Выберите место на внешнем периметре карты.'); return; }
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
    changePortals(withPortals(next, portals)); setPortalEdit(null);
  };
  const regenerate = (blind = false) => {
    resetNotice();
    try {
      const start = performance.now();
      const next = { ...transferPortals(maze, generate(draft)), wallHeight: maze.wallHeight, wallColor: maze.wallColor, translucentFabric: maze.translucentFabric, roof: maze.roof,
        ...(maze.environment ? { environment: maze.environment } : {}) }; setGenerationMs(performance.now()-start);
      setMaze(next); setResult(null); setShowRoute(false); setPortalEdit(null);
      if (blind) setMode('walk');
      else setMessage('Лабиринт сгенерирован. Seed сохранён.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const onEnd = useCallback((value: WalkResult) => {
    setResult(value); setMode('map'); setShowRoute(true);
    setMessage(value.finished ? 'Выход найден! Твой маршрут записан.' : 'Прохождение остановлено. Записанная часть пути показана на карте.');
  }, []);
  const onWalkError = useCallback((value: string) => { setError(value); setMode('map'); }, []);
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
        setMaze(next); setDraft({ ...next.parameters }); setResult(null); setShowRoute(false); setGenerationMs(null); setPortalEdit(null);
        setMessage('Лабиринт загружен. Топология восстановлена из файла.');
      }
    } catch (e) { setError(`Не удалось загрузить: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const parameterNumber = (label: string, key: 'columns' | 'rows' | 'corridorWidth' | 'moduleSize' | 'extraConnections', min: number, max: number, step = 1, unit?: string) =>
    <label className="field"><span>{label}</span><div className="input-unit"><input aria-label={label} type="number" min={min} max={max} step={step} required value={Number.isNaN(draft[key]) ? '' : draft[key] ?? ''} onChange={e => patch(key, e.target.valueAsNumber)} />{unit && <em>{unit}</em>}</div></label>;

  return <div className={`app-shell ${mode === 'walk' ? 'is-walking' : ''}`}>
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Logo /></div><strong>MAZE <span>LAB</span></strong><span className="version">0.1</span></div>
      <div className="topbar-description">Лаборатория физических лабиринтов</div>
      <div className="local-badge"><i /> Локальный проект</div>
    </header>
    {mode === 'map' ? <>
      <aside className="sidebar">
        <div className="sidebar-title"><span className="eyebrow">КОНСТРУКТОР</span><span>01 / 02</span></div>
        <h1>Начинается<br />с одного пути<span>.</span></h1>
        <p className="sidebar-description">Создавай, исследуй и проверяй<br />лабиринты в реальном масштабе.</p>
        <form onSubmit={e => { e.preventDefault(); regenerate(); }}>
          <div className="section-label"><span>ПАРАМЕТРЫ ГЕНЕРАЦИИ</span><span>↘</span></div>
          <label className="field"><span>Конструкция</span><select aria-label="Конструкция" value={draft.moduleSize === undefined ? 'grid' : 'modules'} onChange={event => setDraft(p => {
            const { moduleSize, ...rest } = p;
            return event.target.value === 'modules' ? { ...rest, moduleSize: moduleSize ?? 2 } : rest;
          })}><option value="modules">Отдельные квадратные модули</option><option value="grid">Классическая сетка</option></select></label>
          <label className="field"><span>Алгоритм</span><select aria-label="Алгоритм" value={draft.algorithm} onChange={e => patch('algorithm', e.target.value as Algorithm)}><option value="backtracker">Recursive Backtracker</option><option value="prim">Randomized Prim</option></select></label>
          <p className="field-note algorithm-note">{draft.algorithm === 'backtracker' ? 'Длинные извилистые пути и глубокие тупики.' : 'Много коротких ответвлений и частых развилок.'}</p>
          <div className="field-pair">{parameterNumber('Столбцы', 'columns', 1, 100)}{parameterNumber('Строки', 'rows', 1, 100)}</div>
          {draft.moduleSize !== undefined && parameterNumber('Размер модуля', 'moduleSize', 0.8, 10, 0.1, 'м')}
          {parameterNumber(draft.moduleSize === undefined ? 'Ширина коридора' : 'Проход между модулями', 'corridorWidth', 0.8, 10, 0.1, 'м')}
          {parameterNumber('Дополнительные соединения', 'extraConnections', 0, 20000)}
          <p className="field-note">{draft.moduleSize === undefined ? 'Добавляют циклы между существующими путями.' : 'Стены на модулях и между ними образуют единый лабиринт. Дополнительные связи добавляют циклы.'}</p>
          <label className="field seed-field"><span>Seed <small>ВОСПРОИЗВОДИМОСТЬ</small></span><div className="seed-input"><input value={draft.seed} maxLength={256} onChange={e => patch('seed', e.target.value)} spellCheck={false} /><button type="button" title="Новый seed" aria-label="Новый seed" onClick={() => patch('seed', `FIELD-${Date.now().toString(36).toUpperCase()}`)}>⟳</button></div></label>
          <button className="primary generate" type="submit" aria-label="Сгенерировать">Сгенерировать <span aria-hidden="true">↗</span></button>
          <button className="blind-button" type="button" onClick={() => regenerate(true)}>Сгенерировать и пройти вслепую <span>→</span></button>
          {dirty && <p className="draft-notice">Есть изменения. Применятся при генерации.</p>}
        </form>
        <ConstructionControls value={maze} onChange={patch => setMaze(current => ({ ...current, ...patch }))} />
        <PortalControls maze={maze} edit={portalEdit} onEdit={setPortalEdit} onChange={changePortals} />
        <EnvironmentControls maze={maze} onChange={changeEnvironment} />
        <div className="sidebar-bottom"><span className="mini-mark">ML /</span><span>Каждая развилка — эксперимент.</span></div>
      </aside>
      <main className="workspace">
        <div className="workspace-header"><div><div className="eyebrow">РАБОЧАЯ ОБЛАСТЬ</div><h2>План лабиринта <span>{maze.parameters.columns} × {maze.parameters.rows}</span></h2></div><div className="file-actions"><button disabled={busy} onClick={() => void load()}><span aria-hidden="true">↥</span> Открыть</button><button disabled={busy} onClick={() => void save()}><span aria-hidden="true">↧</span> Сохранить</button></div></div>
        <div className="view-toolbar"><div className="view-tabs"><span className="active"><span>▦</span> Карта</span><button disabled={!analysis.reachable} onClick={() => { resetNotice(); setMode('walk'); }}><span>◉</span> Пройти от первого лица <span>↗</span></button></div><label className="route-toggle"><input type="checkbox" checked={showRoute} onChange={e => setShowRoute(e.target.checked)} /><span className="switch" />Кратчайший путь</label></div>
        <div className="map-panel">
          <div className="map-topline"><span><i className="live-dot" /> {analysis.reachable ? 'ВЫХОД ДОСТИЖИМ' : 'ВЫХОД НЕДОСТИЖИМ'}</span><span>ВИД СВЕРХУ / МЕТРЫ</span></div>
          <MapCanvas maze={maze} showRoute={showRoute} recorder={result?.recorder ?? null} onPlacePortal={portalEdit === null ? undefined : placePortal} onEnvironmentChange={changeEnvironment} />
          <div className="map-legend"><span><i className="legend-wall" /> Стены</span><span><i className="legend-route" /> Кратчайший путь</span>{result && <span><i className="legend-actual" /> Твой путь</span>}</div>
        </div>
        <section className="metrics-section" aria-label="Метрики лабиринта"><div className="metrics-title"><span className="eyebrow">АНАЛИЗ ТОПОЛОГИИ</span><span>{number(analysis.area, 1)} м² · {number(maze.width, 1)} × {number(maze.depth, 1)} м</span></div><div className="metric-grid">
          <Metric label={maze.parameters.moduleSize === undefined ? 'КЛЕТКИ' : 'УЗЛЫ ГРАФА'} value={number(analysis.cells)} detail={`${maze.parameters.moduleSize === undefined ? '' : `${maze.parameters.columns*maze.parameters.rows} модулей · `}${number(analysis.corridors)} коридоров`} />
          <Metric label="ТУПИКИ" value={number(analysis.deadEnds)} detail="точки возврата" />
          <Metric label="РАЗВИЛКИ" value={number(analysis.junctions)} detail="3 и более направлений" />
          <Metric label="ЦИКЛЫ" value={number(analysis.cycles)} detail={`${analysis.components} комп. · E − V + C`} />
          <Metric label="КРАТЧАЙШИЙ ПУТЬ" value={number(analysis.optimalLength, 1)} unit="м" detail={`${number(analysis.routeAreaRatio, 3)} м/м² · по центрам клеток`} accent />
        </div></section>
        {result && <section className="results" aria-label="Результаты прохождения"><div className="result-heading"><span className="eyebrow">{result.finished ? 'ВЫХОД НАЙДЕН' : 'ПРОХОЖДЕНИЕ ОСТАНОВЛЕНО'}</span><button aria-label="Закрыть результаты" onClick={() => setResult(null)}>×</button></div><div className="result-values"><div><strong>{formatTime(result.recorder.elapsed)}</strong><span>время в движении и исследовании</span></div><div><strong>{number(result.recorder.distance, 1)} <small>м</small></strong><span>твой путь</span></div><div><strong>{number(analysis.optimalLength, 1)} <small>м</small></strong><span>кратчайший путь по центрам клеток</span></div><div><strong>{result.finished ? `${number(result.recorder.distance/analysis.optimalLength, 2)}×` : '—'}</strong><span>отношение к кратчайшему</span></div></div><p>Маршрут-эталон идёт по центрам клеток; свободное движение со срезанием углов может дать отношение меньше 1.</p></section>}
        <footer className="workspace-footer"><span>{maze.parameters.algorithm === 'backtracker' ? 'Recursive Backtracker' : 'Randomized Prim'} <b>·</b> Seed: {maze.parameters.seed || '(пустой)'}</span><span>{generationMs === null ? 'ЛОКАЛЬНО · БЕЗ ТЕЛЕМЕТРИИ' : `ГЕНЕРАЦИЯ ${number(generationMs, 1)} мс`}</span></footer>
      </main>
    </> : <main className="walk-main"><WalkCanvas maze={maze} onEnd={onEnd} onError={onWalkError} /></main>}
    {(message || error) && <div className={`notification ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button onClick={resetNotice} aria-label="Закрыть уведомление">×</button></div>}
  </div>;
}

function Metric({ label, value, detail, unit, accent }: { label: string; value: string; detail: string; unit?: string; accent?: boolean }) {
  return <div className={`metric ${accent ? 'accent' : ''}`}><span>{label}</span><strong>{value}{unit && <small> {unit}</small>}</strong><p>{detail}</p></div>;
}

const root = document.getElementById('app');
if (!root) throw new Error('Не найден контейнер приложения.');
createRoot(root).render(<App />);
