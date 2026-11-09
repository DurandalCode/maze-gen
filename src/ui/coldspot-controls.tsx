import { useEffect, useRef, useState } from 'react';
import type { Maze } from '../core/maze';
import { DEFAULT_ANALYSIS, type AnalysisOptions, type ColdspotAnalysis } from '../analysis/coldspots';
import { PROFILE_NAMES, type NavigationProfile } from '../analysis/navigation';
import type { OptimizationMethod, OptimizationResult, OptimizationObjective } from '../analysis/optimize';
import { PotentialPanel } from './potential-panel';
export type HeatLayer = 'probability' | 'visits';
export interface HeatDisplay {
  analysis: ColdspotAnalysis;
  layer: HeatLayer;
  coldOnly: boolean;
}
const fmt = (value: number, digits = 1) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
export function ColdspotControls({ maze, onDisplay, onOptimized }: {
  maze: Maze;
  onDisplay: (display: HeatDisplay | null) => void;
  onOptimized: (result: OptimizationResult) => void;
}) {
  const [enabled, setEnabled] = useState(false), [show, setShow] = useState(true);
  const [options, setOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS);
  const [analysis, setAnalysis] = useState<ColdspotAnalysis | null>(null), [error, setError] = useState('');
  const [calculating, setCalculating] = useState(false), [optimizing, setOptimizing] = useState(false);
  const [layer, setLayer] = useState<HeatLayer>('probability'), [coldOnly, setColdOnly] = useState(false);
  const [method, setMethod] = useState<OptimizationMethod>('seeds'), [attempts, setAttempts] = useState(32);
  const [objective, setObjective] = useState<OptimizationObjective>('exploration');
  const [progress, setProgress] = useState(''), [notice, setNotice] = useState('');
  const optimizer = useRef<Worker | null>(null);
  // Visibility depends on topology, construction and environment; cancel every obsolete job.
  useEffect(() => {
    optimizer.current?.terminate();
    optimizer.current = null;
    setOptimizing(false);
    setProgress('');
    if (!enabled) {
      setCalculating(false);
      setAnalysis(null);
      onDisplay(null);
      return;
    }
    setCalculating(true);
    setAnalysis(null);
    setError('');
    onDisplay(null);
    const worker = new Worker(new URL('../analysis/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      if (event.data.kind === 'analysis') {
        setAnalysis(event.data.result);
        setCalculating(false);
      }
      else if (event.data.kind === 'error') {
        setError(event.data.message);
        setCalculating(false);
      }
      worker.terminate();
    };
    worker.onerror = () => { setError('Не удалось выполнить анализ.'); setCalculating(false); worker.terminate(); };
    worker.postMessage({ kind: 'analyze', maze, options });
    return () => worker.terminate();
  }, [enabled, maze.parameters, maze.passages, maze.entrance, maze.exit, maze.wallHeight, maze.roof, maze.translucentFabric, maze.environment, options, onDisplay]);
  useEffect(() => () => { optimizer.current?.terminate(); onDisplay(null); }, [onDisplay]);
  useEffect(() => { onDisplay(show && analysis ? { analysis, layer, coldOnly } : null); }, [analysis, show, layer, coldOnly, onDisplay]);
  const cancel = () => { optimizer.current?.terminate(); optimizer.current = null; setOptimizing(false); setProgress(''); setNotice('Оптимизация отменена.'); };
  const optimize = () => {
    setError('');
    setNotice('');
    setOptimizing(true);
    setProgress('Подготовка…');
    const worker = new Worker(new URL('../analysis/worker.ts', import.meta.url), { type: 'module' });
    optimizer.current = worker;
    worker.onmessage = event => {
      const data = event.data;
      if (data.kind === 'progress') {
        setProgress(`${data.done} / ${data.total}`);
        return;
      }
      worker.terminate();
      optimizer.current = null;
      setOptimizing(false);
      setProgress('');
      if (data.kind === 'error') {
        setError(data.message);
        return;
      }
      const result = data.result as OptimizationResult;
      if (result.objective === 'exploration') {
        if (result.changed) {
          setNotice(result.afterPotential?.treeForecast===false?`Проверено ${result.attempted} вариантов. Кольца и защиты сохранены; холодная площадь ${fmt(result.afterPotential.worstColdRatio*100)}%.`:`Проверено ${result.attempted} вариантов. Проёмы скрыты; прогноз разведки боковой площади ${fmt((result.afterPotential?.minOptionalCoverage ?? 0) * 100)}–${fmt((result.afterPotential?.maxOptionalCoverage ?? 0) * 100)}%.`);
          onOptimized(result);
        }
        else
          setNotice(`Проверено ${result.attempted} вариантов. Улучшения, проходящего ограничения скрытности, обязательной площади и длины проходов без выбора, не найдено.`);
        return;
      }
      if (result.changed) {
        setNotice(`Улучшение найдено: проверено ${result.attempted} вариантов. Оценка по трём профилям уменьшилась на ${fmt(100 * (1 - result.after / result.before))}%.`);
        onOptimized(result);
      }
      else
        setNotice(`Проверено ${result.attempted} вариантов. Улучшения с сохранением ограничений не найдено.`);
    };
    worker.onerror = () => { worker.terminate(); optimizer.current = null; setOptimizing(false); setError('Не удалось выполнить оптимизацию.'); };
    worker.postMessage({ kind: 'optimize', maze, options, method:analysis?.potential?.cycles?'walls':method, attempts, objective });
  };
  return <section className="coldspot-controls" aria-label="Анализ колдспотов">
  <div className="section-label"><span>КОЛДСПОТЫ И СЛОЖНОСТЬ</span><span>◈</span></div>
  <p className="field-note">Вероятность попасть в участок до выхода. Модель v8 оценивает местные развилки по видимой перспективе, направлению и заметным тупикам. Узнаваемый финиш имеет приоритет; скрытые стены заранее неизвестны.</p>
  <label className="field"><span>Профиль игрока</span><select aria-label="Профиль игрока" value={options.profile} onChange={e => setOptions({ ...options, profile: e.target.value as NavigationProfile })}>{Object.entries(PROFILE_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
  {options.profile !== 'explorer' && <label className="field"><span>Опора на направление · {options.beta}</span><input aria-label="Опора на направление" type="range" min="0" max="5" step="0.25" value={options.beta} onChange={e => setOptions({ ...options, beta: Number(e.target.value) })}/></label>}
  {options.profile !== 'explorer' && <label className="field"><span>Внутреннее удержание направления · {Math.round((options.internalOrientation ?? 1) * 100)}%</span><input aria-label="Внутреннее удержание направления" type="range" min="0" max="1" step="0.05" value={options.internalOrientation ?? 1} onChange={e => setOptions({ ...options, internalOrientation: Number(e.target.value) })}/><small>Сохраняет курс без внешних ориентиров. Не даёт знания скрытых проходов.</small></label>}
  {options.profile !== 'explorer' && <label className="field"><span>Узнавание исследованных веток · {Math.round((options.routeMemory ?? .9) * 100)}%</span><input aria-label="Узнавание исследованных веток" type="range" min="0" max="1" step="0.05" value={options.routeMemory ?? .9} onChange={e => setOptions({ ...options, routeMemory: Number(e.target.value) })}/><small>После пересмотра стратегии возможна ограниченная перепроверка знакомой ветки. Надёжное узнавание подавляет её.</small></label>}
  {options.profile !== 'explorer' && <label className="field"><span>Тяга к видимым коридорам · {options.corridorPreference ?? 1}</span><input aria-label="Тяга к видимым коридорам" type="range" min="0" max="3" step="0.25" value={options.corridorPreference ?? 1} onChange={e => setOptions({ ...options, corridorPreference: Number(e.target.value) })}/><small>Видимость до 24 м через открытые проходы, включая диагональные перспективы; учитываются развилки и тупики.</small></label>}
  {options.profile !== 'explorer' && <label className="coldspot-check"><input aria-label="Диагональная перспектива" type="checkbox" checked={options.diagonalVision ?? true} onChange={e => setOptions({ ...options, diagonalVision: e.target.checked })}/> Диагональная перспектива</label>}
  {options.profile === 'outline' && <label className="field"><span>Тяга к пути вдоль границы · {options.boundaryPreference ?? 1.5}</span><input aria-label="Тяга к пути вдоль границы" type="range" min="0" max="3" step="0.25" value={options.boundaryPreference ?? 1.5} onChange={e => setOptions({ ...options, boundaryPreference: Number(e.target.value) })}/><small>Граница обещает длинный обход. Предпочтение действует на выбор продолжения, но не запрещает уйти внутрь.</small></label>}
  {options.profile === 'outline' && <label className="field"><span>Отношение к границе</span><select aria-label="Отношение к границе" value={options.boundaryStrategy ?? 'adaptive'} onChange={e => setOptions({ ...options, boundaryStrategy: e.target.value as NonNullable<AnalysisOptions['boundaryStrategy']> })}><option value="adaptive">Пересматривает стратегию</option><option value="follow">Доверяет пути вдоль края</option><option value="avoid">Подозревает обманку у края</option></select><small>В адаптивном режиме начальные гипотезы смешаны поровну. После застоя и возврата гипотеза может смениться до двух раз.</small></label>}
  <label className="field"><span>Холодный участок · посещают менее {Math.round(options.threshold * 100)}%</span><input aria-label="Порог колдспота" type="range" min="5" max="50" step="5" value={options.threshold * 100} onChange={e => setOptions({ ...options, threshold: Number(e.target.value) / 100 })}/></label>
  {!enabled && <button type="button" className="coldspot-action" onClick={() => setEnabled(true)}>Оценить лабиринт</button>}
  {calculating && <div className="coldspot-progress" role="status">Считаем горячесть…<button type="button" onClick={() => setEnabled(false)}>Отменить анализ</button></div>}
  {error && <p className="shape-error" role="alert">{error}</p>}
  {analysis && <>
  <PotentialPanel value={analysis.potential} onLimit={(key, value) => setOptions({ ...options, [key]: value })}/>
  <label className="coldspot-check"><input aria-label="Горячесть на карте" type="checkbox" checked={show} onChange={e => setShow(e.target.checked)}/> Горячесть на карте</label>
  <label className="field"><span>Тепловой слой</span><select aria-label="Тепловой слой" value={layer} onChange={e => setLayer(e.target.value as HeatLayer)}><option value="probability">Вероятность посещения</option><option value="visits">Среднее число посещений</option></select></label>
  <label className="coldspot-check"><input aria-label="Только холодные участки" type="checkbox" checked={coldOnly} onChange={e => setColdOnly(e.target.checked)}/> Только холодные участки</label>
  <dl className="coldspot-metrics" aria-label="Метрики колдспотов">
  {analysis.landmarks && <div><dt>Площадь с различимыми ориентирами</dt><dd>{fmt(analysis.landmarks.orientedAreaRatio * 100)}% · солнце {fmt(analysis.landmarks.sunAreaRatio * 100)}% · лес {fmt(analysis.landmarks.forestAreaRatio * 100)}% · внешняя граница {fmt(analysis.landmarks.boundaryAreaRatio * 100)}%</dd></div>}
  <div><dt>Холодная площадь</dt><dd>{fmt(analysis.coldAreaRatio * 100)}% · {fmt(analysis.coldArea)} м²</dd></div>
  <div><dt>Крупнейший колдспот</dt><dd>{fmt(analysis.largestColdArea)} м²</dd></div>
  <div><dt>Холодных областей</dt><dd>{analysis.regions.length}</dd></div>
  {analysis.explorerExpectedLength !== undefined && options.profile !== 'explorer' && <div><dt>Польза ориентира против поиска без направления</dt><dd>{fmt(100 * Math.abs(1 - analysis.expectedLength / analysis.explorerExpectedLength))}% {analysis.expectedLength <= analysis.explorerExpectedLength ? 'меньше' : 'больше'} пути</dd></div>}
  {analysis.privacy && <div><dt>Прямой обзор проёмов из основной области</dt><dd>Вход: {analysis.privacy.entrance.certified ? 'перекрыт' : analysis.privacy.entrance.witness ? 'есть видимость' : 'не исключён'} · выход: {analysis.privacy.exit.certified ? 'перекрыт' : analysis.privacy.exit.witness ? 'есть видимость' : 'не исключён'}</dd></div>}
  {analysis.sideExploration && <><div><dt>Прогноз разведки боковой площади</dt><dd>{fmt(analysis.sideExploration.visitedRatio * 100)}%</dd></div><div><dt>Прогноз разведки сверх кратчайшего</dt><dd>{fmt(analysis.sideExploration.uniqueRatio * 100)}% · без повторов</dd></div></>}
  {analysis.decisions && <><div><dt>Убедительные ложные продолжения</dt><dd>{analysis.decisions.credibleDecoys} · неоднозначных развилок {analysis.decisions.ambiguousForks}</dd></div><div><dt>Площадь обязательного маршрута</dt><dd>{fmt(analysis.decisions.mandatoryArea)} м²</dd></div></>}
  {analysis.behavior && <><div><dt>Пересмотров стратегии за прохождение</dt><dd>{fmt(analysis.behavior.meanStrategyChanges, 2)}</dd></div><div><dt>Перепроверок знакомых веток</dt><dd>{fmt(analysis.behavior.meanRechecks, 2)} · {fmt(analysis.behavior.meanRecheckDistance)} м дополнительного пути</dd></div></>}
  <div><dt>Средний путь модели</dt><dd>{fmt(analysis.expectedLength)} м · {fmt(analysis.searchRatio, 2)}× кратчайшего</dd></div>
  </dl>
  <p className="field-note">{analysis.method === 'exact-tree' ? 'Точный расчёт для модели на дереве.' : `Оценка по ${analysis.samples} воспроизводимым прохождениям; значения около порога могут колебаться.`} Видимость солнца, леса и внешней ткани проверяется лучами. Без ориентиров уверенность сохраняется на уровне внутреннего удержания курса. Это приближённая модель, не статистика людей.</p>
  <div className="section-label"><span>АВТОПОДБОР ПЛАНИРОВКИ</span></div>
  <label className="field"><span>Цель подбора</span><select aria-label="Цель подбора" value={objective} disabled={optimizing} onChange={e => setObjective(e.target.value as OptimizationObjective)}><option value="exploration">Сложные решения и скрытые проёмы</option><option value="coldspots">Меньше колдспотов</option></select></label>
  <label className="field"><span>Способ улучшения</span><select aria-label="Способ улучшения" value={method} disabled={optimizing} onChange={e => setMethod(e.target.value as OptimizationMethod)}><option value="seeds" disabled={!!analysis?.potential?.cycles}>Подобрать seed</option><option value="walls">Переставить стены</option></select></label>
  <label className="field"><span>Вариантов до</span><select aria-label="Бюджет оптимизации" value={attempts} disabled={optimizing} onChange={e => setAttempts(Number(e.target.value))}>{[16, 32, 64].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
  <p className="field-note">{analysis.potential?.cycles ? 'Подбор перестановкой стен сохраняет число колец, защищённые элементы и пределы качества. Новый seed выбирается обычной генерацией.' : objective === 'exploration' ? 'Подбор по прогнозу боковой разведки без повторов. Вход и выход экранируются; обязательный маршрут занимает 35–55% площади. Форма и места проёмов сохраняются.' : 'Оценка колдспотов по трём профилям. Сохраняем форму, проёмы и циклы; не менее 80% развилок и тупиков.'} На больших лабиринтах бюджет ограничен объёмом расчёта. Изменённые стены сохраняются в JSON.</p>
  <button type="button" className="coldspot-action" disabled={optimizing || calculating} onClick={optimize}>Улучшить лабиринт</button>
  {optimizing && <div className="coldspot-progress" role="status">{progress}<button type="button" onClick={cancel}>Отмена</button></div>}
  </>}
  {notice && <p className="field-note" role="status">{notice}</p>}
  </section>;
}
