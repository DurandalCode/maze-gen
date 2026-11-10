import type { PotentialDifficulty } from '../analysis/potential-difficulty';
const fmt = (v: number, digits = 1) => v.toLocaleString('ru-RU', { maximumFractionDigits: digits });
export function PotentialPanel({ value: p, onLimit }: {
  value: PotentialDifficulty | undefined;
  onLimit?: (key: 'maxForcedStraight' | 'maxForcedRun', value: number) => void;
}) {
  if (!p)
    return null;
  return <section className="potential-panel" aria-label="Потенциальная сложность">
  <h4>Потенциальная сложность</h4>
  {!p.supported ? <p>{p.reason}</p> : <>
    <p>{p.eligible ? 'Условия подбора выполнены.' : p.issues.join(' ')}</p>
    {!p.treeForecast&&<p className="field-note">{p.reason}</p>}
    <dl className="coldspot-metrics">
    <div><dt>Карманы, целиком видимые с развилки</dt><dd>{p.obviousDeadEnds.count} · {fmt(p.obviousDeadEnds.area)} м² · {fmt(p.obviousDeadEnds.ratio*100)}% площади</dd></div>
    <div><dt>Маршрут без альтернативного обхода</dt><dd>{fmt(p.alternatives.unavoidableRatio*100)}% · {fmt(p.alternatives.unavoidableLength)} м</dd></div>
    <div><dt>Участки маршрута с обходом</dt><dd>{p.alternatives.alternativeSections} · {fmt(p.alternatives.alternativeLength)} м</dd></div>
    <div><dt>Длиннейший участок без обхода</dt><dd>{fmt(p.alternatives.longestUnavoidableRun)} м</dd></div>
    <div><dt>Независимые кольца</dt><dd>{p.cycles}</dd></div>
    {p.treeForecast&&<>
    <div><dt>Боковая площадь, прогноз разведки</dt><dd>{fmt(p.minOptionalCoverage * 100)}–{fmt(p.maxOptionalCoverage * 100)}%</dd></div>
    <div><dt>Разведка сверх кратчайшего пути</dt><dd>{fmt(p.minUniqueExplorationRatio * 100)}–{fmt(p.maxUniqueExplorationRatio * 100)}% · без повторов</dd></div>
    <div><dt>Площадь обязательного маршрута</dt><dd>{fmt(p.mandatoryAreaRatio * 100)}% · целевой диапазон 35–55%</dd></div>
    <div><dt>Первый выбор боковой ветки, прогноз</dt><dd>{fmt(p.minFirstDetourRate * 100)}–{fmt(p.maxFirstDetourRate * 100)}%</dd></div>
    <div><dt>Глубоких заходов ≥6 м, прогноз</dt><dd>{fmt(p.minDeepBranches)}–{fmt(p.maxDeepBranches)}</dd></div>
    <div><dt>Типичная глубина захода, прогноз</dt><dd>{fmt(p.minTypicalDepth)}–{fmt(p.maxTypicalDepth)} м</dd></div>
    </>}
    <div><dt>Длиннейшая прямая без содержательного выбора</dt><dd>{fmt(p.corridors.longestForcedStraight)} м · предел {p.corridors.straightLimit} м</dd></div>
    <div><dt>Проход без содержательного выбора, с поворотами</dt><dd>{fmt(p.corridors.longestForcedRun)} м · предел {p.forcedRunLimit} м · по графу {fmt(p.corridors.graphLongestForcedRun)} м</dd></div>
    {p.treeForecast&&<>
    <div><dt>Содержательных развилок на 100 м пути</dt><dd>{fmt(p.corridors.choicesPer100Metres)}</dd></div>
    <div><dt>Доля пути в слишком длинных прямых</dt><dd>{fmt(p.corridors.longMandatoryStraightRatio * 100)}%</dd></div>
    </>}
    <div><dt>Видимая прямая перспектива, включая развилки</dt><dd>{fmt(p.corridors.longestVisibleStraight)} м</dd></div>
    {p.design&&<><div><dt>Предел видимой прямой</dt><dd>{fmt(p.design.maxVisibleStraight)} м</dd></div><div><dt>Неразведанная площадь для подбора, худшая стратегия</dt><dd>{fmt(p.worstColdRatio*100)}% · предел {fmt(p.design.maxColdRatio*100)}%</dd></div><div><dt>Крупнейшая неразведанная область для подбора</dt><dd>{fmt(p.worstColdRegion)} м² · предел {fmt(p.design.maxColdRegion)} м²</dd></div></>}
    <div><dt>Холодная площадь по прогнозу физических посещений</dt><dd>{fmt(p.rawWorstColdRatio*100)}% · крупнейшая область {fmt(p.rawWorstColdRegion)} м²</dd></div>
    <div><dt>Распознанные взглядом окончания</dt><dd>{fmt(Math.min(...p.scenarios.map(s=>s.recognizedTerminalArea)))}–{fmt(Math.max(...p.scenarios.map(s=>s.recognizedTerminalArea)))} м² по стратегиям</dd></div>
    {p.decisions&&<div><dt>Перспективные ложные продолжения</dt><dd>{p.decisions.credibleDecoys}</dd></div>}
    <div><dt>Кольцевые ловушки</dt><dd>{p.loops.qualifiedCount} · задано не менее {p.requestedLoopTraps}</dd></div>
    {p.loops.candidates.find(t=>t.qualifies)&&<div><dt>Крупнейшее ложное кольцо</dt><dd>{fmt(p.loops.candidates.find(t=>t.qualifies)!.length)} м · возврат на ту же развилку</dd></div>}
    <div><dt>Ловушки на маршруте</dt><dd>{p.traps.qualifiedCount} · задано не менее {p.requestedRouteTraps}</dd></div>
    {p.traps.best && <><div><dt>Лучшая пара путей на одной развилке</dt><dd>{p.traps.best.qualifies ? 'Подходит под критерии ловушки' : 'Не проходит критерии ловушки'}</dd></div><div><dt>Ложное приближение к выходу</dt><dd>{fmt(p.traps.best.falseApproach)} м · тупик в {fmt(p.traps.best.deadEndDistance)} м от зоны выхода</dd></div><div><dt>Правильный путь: необходимое удаление</dt><dd>{fmt(p.traps.best.requiredRetreat)} м</dd></div><div><dt>Длительность движения от выхода</dt><dd>{fmt(p.traps.best.awayLength)} м пути до первого приближения</dd></div><div><dt>Возврат из ложного тупика до развилки</dt><dd>{fmt(p.traps.best.returnLength)} м</dd></div></>}
    <div><dt>Скрытность входа и выхода</dt><dd>Вход: {p.privacy.entrance.certified ? 'доказана' : 'не доказана'} · выход: {p.privacy.exit.certified ? 'доказана' : 'не доказана'}</dd></div>
    <div><dt>Относительный рейтинг автоподбора</dt><dd>{!p.eligible ? 'Не допущен к подбору' : p.score === null ? '—' : fmt(p.score, 2)}</dd></div>
    </dl>
    {onLimit && !p.design && <><label className="field"><span>Предел прямой без выбора</span><select aria-label="Предел прямой без выбора" value={p.corridors.straightLimit} onChange={e => onLimit('maxForcedStraight', Number(e.target.value))}>{[4, 6, 8, 10, 12, 16, 20].map(v => <option key={v} value={v}>{v} м</option>)}</select></label><label className="field"><span>Предел прохода без развилок, с поворотами</span><select aria-label="Предел прохода без развилок" value={p.forcedRunLimit} onChange={e => onLimit('maxForcedRun', Number(e.target.value))}>{[8, 12, 16, 20, 24, 32].map(v => <option key={v} value={v}>{v} м</option>)}</select></label></>}
    <details><summary>Прогноз по стратегиям</summary><dl className="coldspot-metrics">{p.scenarios.map(s => <div key={s.strategy}><dt>{s.strategy === 'follow' ? 'Доверяет краю' : s.strategy === 'avoid' ? 'Подозревает обманку' : s.strategy === 'explorer' ? 'Без предпочтения направления' : s.strategy === 'compass' ? 'Знает направление' : 'Меняет стратегию'}</dt><dd>{p.treeForecast?<>{fmt(s.optionalCoverage * 100)}% боковой площади · {fmt(s.uniqueExplorationLength)} м разведки · {fmt(s.deepBranches)} глубоких веток</>:<>По посещениям {fmt(s.coldArea)} м² · для подбора {fmt(s.effectiveColdArea)} м² · распознано взглядом {fmt(s.recognizedTerminalArea)} м²</>}</dd></div>)}</dl></details>
    <p className="field-note">Холодное тепло означает отсутствие реального посещения. Окончание ветки, распознанное взглядом после скрытого поворота, остаётся синим. Для подбора исключается только окончание, видимое из достаточно часто посещаемой точки; холодная неизвестная ветка учитывается полностью. Рейтинг отдельно снижает площадь прямых карманов, целиком видимых с развилки.</p>
    <p className="field-note">Ловушка на маршруте: ложный путь обещает продвижение ≥6 м и скрыто заканчивается тупиком; правильный на той же развилке сначала удаляется ≥8 м. Близость к самому финишу не требуется. Длины считаются по центрам клеток, расстояние до выхода — по контуру без внутренних стен. Это проектная эвристика, не гарантия поведения человека.</p>
    <p className="field-note">Прогноз рассчитывается до прохождения. Длинная перспектива с развилками может заманивать; пределы выше ограничивают движение без выбора. Для знающего контур проверяем доверие к краю, подозрение и смену стратегии. Рейтинг сравнивают при одинаковых настройках и числе колец; прогноз проверяется прохождениями.</p>
  </>}
  </section>;
}
