import { useEffect, useRef, useState } from 'react';
import type { Maze } from '../core/maze';
import { DEFAULT_ANALYSIS, type AnalysisOptions, type ColdspotAnalysis } from '../analysis/coldspots';
import { PROFILE_NAMES, type NavigationProfile } from '../analysis/navigation';
import type { OptimizationMethod, OptimizationResult, OptimizationObjective } from '../analysis/optimize';
import { PotentialPanel } from './potential-panel';
import {metrics} from '../core/metrics';
export type HeatLayer = 'probability' | 'visits';
export interface HeatDisplay {
  analysis: ColdspotAnalysis;
  layer: HeatLayer;
  coldOnly: boolean;
  showDistricts?:boolean;
}
const fmt = (value: number, digits = 1) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
export function ColdspotControls({ maze, request = 0, onDisplay, onOptimized }: {
  maze: Maze;
  request?: number;
  onDisplay: (display: HeatDisplay | null) => void;
  onOptimized: (result: OptimizationResult) => void;
}) {
  const [enabled, setEnabled] = useState(false), [show, setShow] = useState(true);
  const [options, setOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS);
  const [analysis, setAnalysis] = useState<ColdspotAnalysis | null>(null), [error, setError] = useState('');
  const [detailRequest,setDetailRequest]=useState<{maze:Maze;options:AnalysisOptions}|null>(null);
  const detailed=detailRequest?.maze===maze&&detailRequest.options===options;
  const [calculating, setCalculating] = useState(false), [optimizing, setOptimizing] = useState(false);
  const [analysisAttempt,setAnalysisAttempt]=useState(0);
  const [layer, setLayer] = useState<HeatLayer>('probability'), [coldOnly, setColdOnly] = useState(false),[showDistricts,setShowDistricts]=useState(false);
  const [method, setMethod] = useState<OptimizationMethod>('seeds'), [attempts, setAttempts] = useState(32);
  const [objective, setObjective] = useState<OptimizationObjective>('exploration');
  const [progress, setProgress] = useState(''), [notice, setNotice] = useState('');
  const optimizer = useRef<Worker | null>(null);
  useEffect(()=>{if(request>0)setEnabled(true);},[request]);
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
    if(!detailed)setAnalysis(null);
    setError('');
    if(!detailed)onDisplay(null);
    let active=true,worker:Worker|undefined;
    // Sliders and quick edits form one request; no workers for intermediate values.
    const timer=window.setTimeout(()=>{
    worker = new Worker(new URL('../analysis/worker.ts', import.meta.url), { type: 'module' });
    const job=worker;
    worker.onmessage = event => {
      if(!active)return;
      if (event.data.kind === 'analysis') {
        setAnalysis(event.data.result);
        setCalculating(false);
      }
      else if (event.data.kind === 'error') {
        setError(event.data.message);
        setCalculating(false);
      }
      job.terminate();
    };
    worker.onerror = event => { event.preventDefault();if(!active)return;setError('Не удалось выполнить анализ.'); setCalculating(false); job.terminate(); };
    worker.postMessage({ kind: 'analyze', maze, options, detailed });
    },100);
    return () => {active=false;window.clearTimeout(timer);worker?.terminate();};
  }, [enabled, request, maze.free,maze.parameters, maze.passages, maze.entrance, maze.exit, maze.wallHeight, maze.roof, maze.translucentFabric, maze.fabricTransmissionStrength, maze.environment, options, onDisplay,detailRequest,analysisAttempt]);
  useEffect(() => () => { optimizer.current?.terminate(); onDisplay(null); }, [onDisplay]);
  useEffect(() => { onDisplay(show && analysis ? { analysis, layer, coldOnly,showDistricts } : null); }, [analysis, show, layer, coldOnly,showDistricts, onDisplay]);
  const cancel = () => { optimizer.current?.terminate(); optimizer.current = null; setOptimizing(false); setProgress(''); setNotice('Оптимизация отменена.'); };
  const optimize = () => {
    setError('');
    setNotice('');
    setOptimizing(true);
    setProgress('Подготовка…');
    const worker = new Worker(new URL('../analysis/worker.ts', import.meta.url), { type: 'module' });
    optimizer.current = worker;
    worker.onmessage = event => {
      if(optimizer.current!==worker)return;
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
      if(result.freeQuality){setNotice(`Проверено ${result.attempted} вариантов. ${result.changed?'Найдено улучшение без ухудшения других показателей.':'Улучшения без ухудшения других показателей не найдено.'} `+result.freeQuality.after.map(p=>`${p.profile}: холод ${(p.coldRatio*100).toFixed(1)}%, область ${p.largestColdArea.toFixed(1)} м², неразведано ${(p.unseenRatio*100).toFixed(1)}%`).join(' · '));if(result.changed)onOptimized(result);return;}
      if (result.objective === 'exploration') {
        if (result.changed) {
          setNotice(maze.parameters.generationType==='living'?`Проверено ${result.attempted} вариантов. Контуры сохранены; неразведанная площадь для подбора ${fmt((result.afterPotential?.worstColdRatio??0)*100)}%.`:result.afterPotential?.treeForecast===false?`Проверено ${result.attempted} вариантов. Кольца и защиты сохранены; холодная площадь ${fmt(result.afterPotential.worstColdRatio*100)}%.`:`Проверено ${result.attempted} вариантов. Проёмы скрыты; прогноз разведки боковой площади ${fmt((result.afterPotential?.minOptionalCoverage ?? 0) * 100)}–${fmt((result.afterPotential?.maxOptionalCoverage ?? 0) * 100)}%.`);
          onOptimized(result);
        }
        else
          setNotice(`Проверено ${result.attempted} вариантов. Улучшения, сохраняющего тип лабиринта, ловушки и включённые ограничения качества, не найдено.`);
        return;
      }
      if (result.changed) {
        setNotice(`Улучшение найдено: проверено ${result.attempted} вариантов. Оценка по трём профилям уменьшилась на ${fmt(100 * (1 - result.after / result.before))}%.`);
        onOptimized(result);
      }
      else
        setNotice(`Проверено ${result.attempted} вариантов. Улучшения с сохранением ограничений не найдено.`);
    };
    worker.onerror = () => { if(optimizer.current!==worker)return;worker.terminate(); optimizer.current = null; setOptimizing(false); setError('Не удалось выполнить оптимизацию.'); };
    worker.postMessage({ kind: 'optimize', maze, options, method:metrics(maze).cycles&&!maze.storeys?'walls':method, attempts, objective });
  };
  return <section className="coldspot-controls" aria-label="Анализ колдспотов">
  <div className="section-label"><span>КОЛДСПОТЫ И СЛОЖНОСТЬ</span><span>◈</span></div>
  {!enabled && <button type="button" className="coldspot-action" onClick={() => setEnabled(true)}>Проанализировать лабиринт</button>}
  <details className="analysis-options"><summary>Параметры модели</summary>
  <p className="field-note">Вероятность попасть в участок до выхода. {(maze.version===5||maze.version===7)?'Локальная модель свободных пространств учитывает направление и реальные длины переходов, помнит исследованные ветки и возвращается к непроверенным развилкам по известным проходам. Её точность требует проверки прохождениями.':maze.storeys?'Модель v11 учитывает два этажа, лестницы и непрозрачные перекрытия; верхние площадки изучаются по мере наблюдения. Требует проверки прохождениями.':maze.version===4?'Модель v10 коридорного типа движется между реальными проёмами, учитывает диагональный обзор и открытые пространства модулей. Она требует проверки прохождениями.':'Модель v9 помнит увиденные соединения и оценивает местные развилки по видимой перспективе, направлению и заметным тупикам.'} Узнаваемый финиш имеет приоритет; скрытые стены заранее неизвестны.</p>
  <label className="field"><span>Профиль игрока</span><select aria-label="Профиль игрока" value={options.profile} onChange={e => setOptions({ ...options, profile: e.target.value as NavigationProfile })}>{Object.entries(PROFILE_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
  {(maze.version!==5&&maze.version!==7)&&<>
  {options.profile !== 'explorer' && <label className="field"><span>Опора на направление · {options.beta}</span><input aria-label="Опора на направление" type="range" min="0" max="5" step="0.25" value={options.beta} onChange={e => setOptions({ ...options, beta: Number(e.target.value) })}/></label>}
  {options.profile !== 'explorer' && <label className="field"><span>Внутреннее удержание направления · {Math.round((options.internalOrientation ?? 1) * 100)}%</span><input aria-label="Внутреннее удержание направления" type="range" min="0" max="1" step="0.05" value={options.internalOrientation ?? 1} onChange={e => setOptions({ ...options, internalOrientation: Number(e.target.value) })}/><small>Сохраняет курс без внешних ориентиров. Не даёт знания скрытых проходов.</small></label>}
  {options.profile !== 'explorer' && <label className="field"><span>Узнавание исследованных веток · {Math.round((options.routeMemory ?? .9) * 100)}%</span><input aria-label="Узнавание исследованных веток" type="range" min="0" max="1" step="0.05" value={options.routeMemory ?? .9} onChange={e => setOptions({ ...options, routeMemory: Number(e.target.value) })}/><small>После пересмотра стратегии возможна ограниченная перепроверка знакомой ветки. Надёжное узнавание подавляет её.</small></label>}
  {options.profile !== 'explorer' && <label className="field"><span>Тяга к видимым коридорам · {options.corridorPreference ?? 1}</span><input aria-label="Тяга к видимым коридорам" type="range" min="0" max="3" step="0.25" value={options.corridorPreference ?? 1} onChange={e => setOptions({ ...options, corridorPreference: Number(e.target.value) })}/><small>Видимость до 24 м через открытые проходы, включая диагональные перспективы; учитываются развилки и тупики.</small></label>}
  {options.profile !== 'explorer' && <label className="coldspot-check"><input aria-label="Диагональная перспектива" type="checkbox" checked={options.diagonalVision ?? true} onChange={e => setOptions({ ...options, diagonalVision: e.target.checked })}/> Диагональная перспектива</label>}
  {options.profile === 'outline' && <label className="field"><span>Тяга к пути вдоль границы · {options.boundaryPreference ?? 1.5}</span><input aria-label="Тяга к пути вдоль границы" type="range" min="0" max="3" step="0.25" value={options.boundaryPreference ?? 1.5} onChange={e => setOptions({ ...options, boundaryPreference: Number(e.target.value) })}/><small>Граница обещает длинный обход. Предпочтение действует на выбор продолжения, но не запрещает уйти внутрь.</small></label>}
  {options.profile === 'outline' && <label className="field"><span>Отношение к границе</span><select aria-label="Отношение к границе" value={options.boundaryStrategy ?? 'adaptive'} onChange={e => setOptions({ ...options, boundaryStrategy: e.target.value as NonNullable<AnalysisOptions['boundaryStrategy']> })}><option value="adaptive">Пересматривает стратегию</option><option value="follow">Доверяет пути вдоль края</option><option value="avoid">Подозревает обманку у края</option></select><small>В адаптивном режиме начальные гипотезы смешаны поровну. После застоя и возврата гипотеза может смениться до двух раз.</small></label>}
  </>}
  <label className="field"><span>Холодный участок · посещают менее {Math.round(options.threshold * 100)}%</span><input aria-label="Порог колдспота" type="range" min="5" max="50" step="5" value={options.threshold * 100} onChange={e => setOptions({ ...options, threshold: Number(e.target.value) / 100 })}/></label>
  </details>
  {calculating && <div className="coldspot-progress" role="status">{detailed?'Считаем подробную оценку…':'Считаем горячесть…'}<button type="button" onClick={() => {setDetailRequest(null);setEnabled(false);}}>Отменить анализ</button></div>}
  {error && <div className="shape-error" role="alert"><p>{error}</p><button type="button" disabled={calculating} onClick={()=>{setEnabled(true);setAnalysisAttempt(n=>n+1);}}>Повторить анализ</button></div>}
  {analysis && <>
  {(maze.version!==5&&maze.version!==7)&&<details className="analysis-options"><summary>Подробная оценка сложности</summary>{!analysis.potential&&<button disabled={calculating} type="button" onClick={()=>setDetailRequest({maze,options})}>Рассчитать подробную оценку</button>}<PotentialPanel value={analysis.potential} onLimit={(key, value) => setOptions({ ...options, [key]: value })}/></details>}
  <label className="coldspot-check"><input aria-label="Горячесть на карте" type="checkbox" checked={show} onChange={e => setShow(e.target.checked)}/> Горячесть на карте</label>
  <label className="field"><span>Тепловой слой</span><select aria-label="Тепловой слой" value={layer} onChange={e => setLayer(e.target.value as HeatLayer)}><option value="probability">Вероятность посещения</option><option value="visits">Среднее число посещений</option></select></label>
  <label className="coldspot-check"><input aria-label="Только холодные участки" type="checkbox" checked={coldOnly} onChange={e => setColdOnly(e.target.checked)}/> Только холодные участки</label>
  {analysis.sideDistricts&&<label className="coldspot-check"><input aria-label="Холодные боковые районы" type="checkbox" checked={showDistricts} onChange={e=>setShowDistricts(e.target.checked)}/> Холодные боковые районы · {analysis.sideDistricts.problemCount}</label>}
  <dl className="coldspot-metrics" aria-label="Метрики колдспотов">
  {analysis.completionRatio!==undefined&&<div><dt>Симуляций дошло до выхода</dt><dd>{fmt(analysis.completionRatio*100)}%</dd></div>}
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
  <p className="field-note">{analysis.method === 'exact-tree' ? 'Точный расчёт для модели на дереве.' : `Оценка по ${analysis.samples} воспроизводимым прохождениям; значения около порога могут колебаться.`} {(maze.version===5||maze.version===7)?'Модель предполагает точную память исследованных соединений; она не прогнозирует потерю ориентации и не моделирует видимость внешних ориентиров.':'Видимость солнца, леса и внешней ткани проверяется лучами. Без ориентиров уверенность сохраняется на уровне внутреннего удержания курса. Это приближённая модель, не статистика людей.'}</p>
  {(maze.version===5||maze.version===7)?<><p className="field-note">Локальный подбор размещения сохраняет модули, связи, проёмы и ограничения. Колдспоты, крупнейшая холодная область и неразведанная площадь сравниваются отдельно по трём стратегиям; ухудшение одного показателя не компенсируется другим. Это модель покрытия, не рейтинг сложности для человека.</p><button className="coldspot-action" disabled={optimizing||calculating} onClick={optimize}>Улучшить размещение</button>{optimizing&&<div role="status">{progress}<button onClick={cancel}>Отмена</button></div>}</>:<>
  <details className="analysis-options"><summary>Улучшение лабиринта</summary>
  <div className="section-label"><span>АВТОПОДБОР ПЛАНИРОВКИ</span></div>
  <label className="field"><span>Цель подбора</span><select aria-label="Цель подбора" value={objective} disabled={optimizing} onChange={e => setObjective(e.target.value as OptimizationObjective)}><option value="exploration">Сложные решения и скрытые проёмы</option><option value="coldspots">Меньше колдспотов</option></select></label>
  {maze.version!==4&&<label className="field"><span>Способ улучшения</span><select aria-label="Способ улучшения" value={method} disabled={optimizing} onChange={e => setMethod(e.target.value as OptimizationMethod)}><option value="seeds" disabled={!!analysis?.potential?.cycles&&!maze.storeys&&maze.parameters.generationType!=='living'&&maze.parameters.generationType!=='corridor'}>Подобрать seed</option><option value="walls">Переставить стены</option></select></label>}
  <label className="field"><span>Вариантов до</span><select aria-label="Бюджет оптимизации" value={attempts} disabled={optimizing} onChange={e => setAttempts(Number(e.target.value))}>{[16, 32, 64].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
  <p className="field-note">{maze.parameters.generationType==='corridor'?'Подбор перестраивает размещение и проёмы вместе, сохраняя открытые модули 2×6, ширину проходов и заданные ограничения.':maze.parameters.generationType==='living'?'Подбор сохраняет минимум 80% достижимых контурных связей, заданные ловушки, число колец и включённые пределы качества.':analysis.potential?.cycles ? 'Подбор перестановкой стен сохраняет число колец, защищённые элементы и пределы качества. Новый seed выбирается обычной генерацией.' : objective === 'exploration' ? 'Подбор по прогнозу боковой разведки без повторов. Вход и выход экранируются; обязательный маршрут занимает 35–55% площади. Форма и места проёмов сохраняются.' : 'Оценка колдспотов по трём профилям. Сохраняем форму, проёмы и циклы; не менее 80% развилок и тупиков.'} На больших лабиринтах бюджет ограничен объёмом расчёта. Изменённые стены сохраняются в JSON.</p>
  <button type="button" className="coldspot-action" disabled={optimizing || calculating} onClick={optimize}>Улучшить лабиринт</button>
  {optimizing && <div className="coldspot-progress" role="status">{progress}<button type="button" onClick={cancel}>Отмена</button></div>}
  </details>
  </>}
  </>}
  {!!analysis?.bridgeUsage?.length&&<p className="field-note" aria-label="Использование мостов">{analysis.bridgeUsage.map((b,i)=>`М${i+1}: сверху посещают ${fmt(b.overProbability*100)}%, снизу ${fmt(b.underProbability*100)}% симуляций`).join(' · ')}. Оценка локальной модели, не статистика людей.</p>}
  {notice && <p className="field-note" role="status">{notice}</p>}
  </section>;
}
