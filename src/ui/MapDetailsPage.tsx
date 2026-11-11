import { lazy, Suspense, useEffect, useMemo, useState, useRef } from 'react';
import type { GenerationOrigin } from '../domain';
import type { PreparedWorld } from '../jobs/compute';
import type { ListCursor, Page, WalkSummary } from '../repository/types';
import { store, message } from './services';
import { stateLabels } from './session-labels';
import { ExportPanel } from './ExportPanel';
const WorldView = lazy(() => import('./WorldView').then((m) => ({ default: m.WorldView })));
const date = (value: number) =>
  new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const duration = (ms: number) => `${Math.floor(ms / 60000)} мин ${Math.floor(ms / 1000) % 60} с`;
interface Props {
  world: PreparedWorld;
  title: string;
  preview: boolean;
  origin?: GenerationOrigin;
  shared: boolean | null;
  speed: number;
  inputMode: 'keyboard' | 'touch';
  busy: boolean;
  error: string;
  canEdit: boolean;
  onSpeed: (value: number) => void;
  onInput: (value: 'keyboard' | 'touch') => void;
  onClose: () => void;
  onStart: (immediate: boolean) => void;
  onEdit: () => void;
  onReveal: () => void;
  onAttempt: (row: WalkSummary) => void;
}
export function MapDetailsPage(p: Props) {
  const d = p.world.physical.document,
    profile = d.physicalProfile,
    quantities = p.world.physical.quantities,
    [exporting, setExporting] = useState(false),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(''),
    [attempts, setAttempts] = useState<WalkSummary[]>([]),
    [cursor, setCursor] = useState<ListCursor | null>(null),
    [historyError, setHistoryError] = useState(''),
    [historyLoading, setHistoryLoading] = useState(true);
  const composition = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of d.instances) {
      const definition = d.definitions.find((v) => v.contentHash === i.definitionHash)!,
        b = definition.builder,
        v = i.parameterValues;
      const label =
        b.kind === 'rectangle'
          ? `${v[b.width] === v[b.depth] ? 'Квадрат' : 'Прямоугольник'} ${v[b.width]} × ${v[b.depth]} м`
          : b.kind === 'circle'
            ? `Круг · радиус ${v[b.radius]} м`
            : b.kind === 'equilateralTriangle'
              ? `Треугольник · сторона ${v[b.side]} м`
              : definition.id;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts];
  }, [d]);
  useEffect(() => {
    document.title = p.preview ? `${p.title} — Maze Lab` : 'Слепой маршрут — Maze Lab';
    if (p.preview) localStorage.setItem(`maze-preview:${p.world.revisionHash}`, '1');
    return () => {
      document.title = 'Maze Lab';
    };
  }, [p.title, p.preview, p.world.revisionHash]);
  const historyRequest = useRef(0);
  const loadHistory = async (next: ListCursor | null = null) => {
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const page = await store<Page<WalkSummary>>('list', {
        kind: 'walks',
        query: { mapHash: p.world.revisionHash, sort: 'updated-desc', limit: 10, cursor: next },
      });
      if (request !== historyRequest.current) return;
      setAttempts((old) => (next ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      if (request === historyRequest.current) setHistoryError(message(e));
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  };
  useEffect(() => {
    void loadHistory();
    return () => {
      historyRequest.current++;
    };
  }, [p.world.revisionHash]);
  const copy = async () => {
    try {
      setCopyError('');
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('map', p.world.revisionHash);
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
    } catch (e) {
      setCopyError(message(e));
    }
  };
  const terminal = (s: WalkSummary) => s.status === 'finished' || s.status === 'stopped';
  const latest = attempts.find((s) => !terminal(s)),
    bounds = p.world.physical.bounds;
  return (
    <main className="map-details" aria-label="Карточка лабиринта">
      <nav className="map-breadcrumb" aria-label="Навигация">
        <button onClick={p.onClose}>← Библиотека</button>
        <span>/</span>
        <span>{p.preview ? p.title : 'Слепой маршрут'}</span>
      </nav>
      <header className="map-hero">
        <div>
          <p className="eyebrow">
            ЛАБИРИНТ ·{' '}
            {p.preview
              ? p.world.metrics.cycles
                ? 'С ЦИКЛАМИ'
                : 'ДЕРЕВО'
              : 'ПРОХОЖДЕНИЕ БЕЗ ПЛАНА'}
          </p>
          <h1>{p.preview ? p.title : 'Слепой маршрут'}</h1>
          <p className="map-lead">
            {p.preview
              ? `Комнат: ${d.instances.length}. Развилок: ${p.world.metrics.decisionCount}. Найдите путь от входа к выходу и сохраните своё прохождение.`
              : 'План и название скрыты. Можно начать без предварительного просмотра.'}
          </p>
          <div className="map-badges">
            <span>✓ Геометрия и путь проверены</span>
            <span>
              {p.shared
                ? 'Общая библиотека'
                : p.shared === false
                  ? 'Локальная библиотека'
                  : 'Библиотека'}
            </span>
          </div>
        </div>
        <div className="map-secondary-actions">
          <button onClick={() => void copy()}>
            {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
          </button>
          {p.canEdit && (
            <button disabled={p.busy} onClick={p.onEdit}>
              Редактировать
            </button>
          )}
          <button onClick={() => setExporting(true)}>Скачать JSON</button>
        </div>
      </header>
      {copyError && <p role="alert">{copyError}</p>}
      {p.preview && (
        <section className="map-key-stats" aria-label="Основные параметры">
          <div>
            <span>Комнаты</span>
            <strong>{d.instances.length}</strong>
          </div>
          <div>
            <span>Опорный маршрут · прибл.</span>
            <strong>
              {p.world.metrics.routeLengthM.toFixed(1)} <small>м</small>
            </strong>
          </div>
          <div>
            <span>Развилки / циклы</span>
            <strong>
              {p.world.metrics.decisionCount} <small>/ {p.world.metrics.cycles}</small>
            </strong>
          </div>
          <div>
            <span>Площадь пола</span>
            <strong>
              {quantities.floorM2.toFixed(1)} <small>м²</small>
            </strong>
          </div>
        </section>
      )}
      <div className="map-detail-layout">
        <div className="map-detail-content">
          <section className="map-panel map-plan-panel" aria-label="План и просмотр">
            <header>
              <div>
                <p className="eyebrow">ПРОСТРАНСТВО</p>
                <h2>{p.preview ? 'План и обзор' : 'План скрыт'}</h2>
              </div>
            </header>
            {p.preview ? (
              <>
                <Suspense fallback={<p role="status">Открываем план…</p>}>
                  <WorldView world={p.world} fitContent showMetrics={false} />
                </Suspense>
                <p className="map-caption">
                  Вход отмечен зелёным, выход — красным. Можно переключиться на 3D и осмотреть
                  конструкцию.
                </p>
              </>
            ) : (
              <div className="map-hidden-plan">
                <span aria-hidden="true">?</span>
                <p>
                  Сохраните первое впечатление для прохождения или откройте полную карточку с планом
                  и параметрами.
                </p>
                <button onClick={p.onReveal}>Открыть полную карточку</button>
              </div>
            )}
          </section>
          {p.preview && (
            <>
              <section className="map-panel">
                <p className="eyebrow">УСТРОЙСТВО</p>
                <h2>Из чего состоит лабиринт</h2>
                <div className="map-spec-columns">
                  <dl className="map-spec-list">
                    {composition.map(([name, count]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{count} шт.</dd>
                      </div>
                    ))}
                    <div>
                      <dt>Соединения между комнатами</dt>
                      <dd>{d.connections.length}</dd>
                    </div>
                    <div>
                      <dt>Отдельные стены</dt>
                      <dd>{d.freeWalls.length}</dd>
                    </div>
                  </dl>
                  <dl className="map-spec-list">
                    <div>
                      <dt>Площадка</dt>
                      <dd>
                        {(bounds.maxX - bounds.minX).toFixed(1)} ×{' '}
                        {(bounds.maxZ - bounds.minZ).toFixed(1)} м
                      </dd>
                    </div>
                    <div>
                      <dt>Высота стен</dt>
                      <dd>{profile.wallHeightM} м</dd>
                    </div>
                    <div>
                      <dt>Минимальный просвет</dt>
                      <dd>
                        {Math.min(
                          ...p.world.physical.openPassages.map((o) => o.clearWidthM),
                        ).toFixed(2)}{' '}
                        м
                      </dd>
                    </div>
                    <div>
                      <dt>Крыша</dt>
                      <dd>{d.environment.roof ? 'Установлена' : 'Открытый верх'}</dd>
                    </div>
                    <div>
                      <dt>Вход / выход</dt>
                      <dd>По одному, путь связан</dd>
                    </div>
                  </dl>
                </div>
              </section>
              <section className="map-panel">
                <p className="eyebrow">КОНСТРУКЦИЯ</p>
                <h2>Материалы</h2>
                <dl className="map-materials">
                  <div>
                    <dt>Ткань</dt>
                    <dd>{quantities.fabricM2.toFixed(1)} м²</dd>
                  </div>
                  <div>
                    <dt>Древесина</dt>
                    <dd>{quantities.timberM3.toFixed(3)} м³</dd>
                  </div>
                  <div>
                    <dt>Панели</dt>
                    <dd>{quantities.panels} шт.</dd>
                  </div>
                  <div>
                    <dt>Опорные доски</dt>
                    <dd>{quantities.postBoards} шт.</dd>
                  </div>
                  <div>
                    <dt>Укосины</dt>
                    <dd>{quantities.braces} шт.</dd>
                  </div>
                  <div>
                    <dt>Крепёж</dt>
                    <dd>{quantities.fastenerCount} шт.</dd>
                  </div>
                </dl>
              </section>
              <section className="map-panel">
                <p className="eyebrow">ПРОИСХОЖДЕНИЕ</p>
                <h2>Как создана карта</h2>
                {p.origin ? (
                  <>
                    <p>
                      {p.origin.request.generatorVersion === 'prototype-grid-v1'
                        ? 'Сгенерирована из квадратных комнат на ортогональной сетке.'
                        : 'Создана генератором.'}
                      {p.origin.sourceRevisionHash !== p.world.revisionHash
                        ? ' После генерации карта изменена в редакторе.'
                        : ''}
                    </p>
                    <dl className="map-spec-list">
                      <div>
                        <dt>Seed</dt>
                        <dd className="map-seed">{p.origin.request.seed}</dd>
                      </div>
                      <div>
                        <dt>Режим</dt>
                        <dd>
                          {p.origin.request.placement.mode === 'orthogonal'
                            ? 'Ортогональный'
                            : 'Свободный'}{' '}
                          · {p.origin.request.topology.mode === 'tree' ? 'дерево' : 'с циклами'}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p>Карта создана вручную или загружена из JSON.</p>
                )}
                <details className="map-technical">
                  <summary>Ревизия и версии</summary>
                  <p className="hash">{p.world.revisionHash}</p>
                  <p>
                    {p.world.versions.geometry} · {p.world.versions.navigation}
                    {p.origin ? ` · ${p.origin.request.generatorVersion}` : ''}
                  </p>
                </details>
              </section>
            </>
          )}
          <section className="map-panel" aria-label="История прохождений">
            <p className="eyebrow">ВАШИ МАРШРУТЫ</p>
            <h2>Прохождения</h2>
            {historyLoading && <p role="status">Загружаем прохождения…</p>}
            {historyError && (
              <p role="alert">
                {historyError}
                <button onClick={() => void loadHistory()}>Повторить загрузку</button>
              </p>
            )}
            {!historyLoading && !historyError && !attempts.length && (
              <div className="map-empty-history">
                <h3>Первое прохождение ещё впереди</h3>
                <p>
                  После старта здесь появятся время, пройденная дистанция и сохранённый результат.
                </p>
              </div>
            )}
            {attempts.length > 0 && (
              <div className="map-history-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Попытка</th>
                      <th>Время</th>
                      <th>Дистанция</th>
                      <th>Дата</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((s) => (
                      <tr key={s.sessionId}>
                        <td>
                          <strong>{stateLabels[s.status]}</strong>
                          <small>#{s.sessionId.slice(0, 8)}</small>
                        </td>
                        <td>{duration(s.elapsedMs)}</td>
                        <td>{s.distanceM.toFixed(2)} м</td>
                        <td>{date(s.updatedAt)}</td>
                        <td>
                          <button onClick={() => p.onAttempt(s)}>
                            {terminal(s) ? 'Результат' : 'Продолжить'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cursor && (
              <button disabled={historyLoading} onClick={() => void loadHistory(cursor)}>
                Ещё прохождения
              </button>
            )}
          </section>
        </div>
        <aside className="map-play-panel" aria-label="Старт прохождения">
          <p className="eyebrow">ГОТОВЫ НАЙТИ ВЫХОД?</p>
          <h2>Начните свой маршрут</h2>
          <p>
            Прогресс и результат сохраняются{' '}
            {p.shared ? 'в общей библиотеке сервера' : 'в этом браузере'}.
          </p>
          <label>
            Скорость
            <select value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))}>
              <option value={1.4}>Шаг · 1,4 м/с</option>
              <option value={2.8}>Бег · 2,8 м/с</option>
            </select>
          </label>
          <label>
            Управление
            <select
              value={p.inputMode}
              onChange={(e) => p.onInput(e.target.value as 'keyboard' | 'touch')}
            >
              <option value="keyboard">Клавиатура и мышь</option>
              <option value="touch">Сенсорное</option>
            </select>
          </label>
          {(p.preview || localStorage.getItem(`maze-preview:${p.world.revisionHash}`) === '1') && (
            <p className="map-caption">
              Карта уже просмотрена. Это будет записано в условиях попытки.
            </p>
          )}
          <button className="primary map-start" disabled={p.busy} onClick={() => p.onStart(true)}>
            {p.busy ? 'Подготавливаем…' : 'Начать прохождение →'}
          </button>
          <button className="map-prepare" disabled={p.busy} onClick={() => p.onStart(false)}>
            Подготовить попытку
          </button>
          {latest && (
            <button disabled={p.busy} onClick={() => p.onAttempt(latest)}>
              Продолжить сохранённую попытку
            </button>
          )}
          {p.error && <p role="alert">{p.error}</p>}
          <div className="map-controls">
            <h3>Как играть</h3>
            <p>
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> — движение
              <br />
              Стрелки ← → — поворот
              <br />
              <kbd>Esc</kbd> — пауза
            </p>
            <p>В режиме мыши нажмите на сцену. Выход завершит попытку автоматически.</p>
          </div>
          <p className="map-caption">
            Длина опорного маршрута приблизительная. Ваш фактический путь зависит от выбранных
            поворотов.
          </p>
        </aside>
      </div>
      {exporting && (
        <ExportPanel
          selection={{ mapHashes: [p.world.revisionHash], sessionIds: [] }}
          onClose={() => setExporting(false)}
        />
      )}
    </main>
  );
}
