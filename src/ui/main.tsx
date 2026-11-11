import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MapRevision } from '../domain';
import type { PreparedWorld } from '../jobs/compute';
import type { ListCursor, MapSummary, Page, WalkSummary } from '../repository/types';
import type { Session } from '../session/types';
import { makeCondition } from '../session/format';
import { store, prepare, revision, message } from './services';
import { starterDocument } from './starter';
import { WorldView } from './WorldView';
import { ImportPanel } from './ImportPanel';
import { ExportPanel } from './ExportPanel';
import type { ExportSelection } from '../exchange/export-repository';
import { WalkView, stateLabels } from './WalkView';
import './styles.css';

interface Listing<T> {
  rows: T[];
  cursor: ListCursor | null;
  loading: boolean;
  error: string;
}
const empty = <T,>(): Listing<T> => ({ rows: [], cursor: null, loading: false, error: '' });
function useListing<T>(
  kind: 'maps' | 'walks',
  search: string,
  sort: string,
  status: string,
  refresh: number,
  mapHash: string,
) {
  const [list, setList] = useState<Listing<T>>(empty);
  const request = useRef(0);
  const load = async (cursor: ListCursor | null = null) => {
    const id = ++request.current;
    setList((old) => ({ ...old, loading: true, error: '' }));
    try {
      const page = await store<Page<T>>('list', {
        kind,
        query: { search, sort, status, mapHash, cursor, limit: 30 },
      });
      if (request.current === id)
        setList((old) => ({
          rows: cursor ? [...old.rows, ...page.items] : page.items,
          cursor: page.nextCursor,
          loading: false,
          error: '',
        }));
    } catch (error) {
      if (request.current === id)
        setList((old) => ({ ...old, loading: false, error: message(error) }));
    }
  };
  useEffect(() => {
    setList(empty());
    const timer = setTimeout(() => void load(), 120);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [kind, search, sort, status, refresh, mapHash]);
  return { ...list, more: () => load(list.cursor), retry: () => load() };
}
type Selection = { world: PreparedWorld; title: string; preview: boolean; mapHash: string };
function App() {
  const [exportSelection, setExportSelection] = useState<ExportSelection | null>(null);
  const [markedMaps, setMarkedMaps] = useState<string[]>([]);
  const [markedWalks, setMarkedWalks] = useState<string[]>([]);
  const mark = (id: string, checked: boolean, setter: typeof setMarkedMaps) =>
    setter((old) => (checked ? [...old.filter((v) => v !== id), id] : old.filter((v) => v !== id)));
  const [tab, setTab] = useState<'maps' | 'walks'>('maps');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('updated-desc');
  const [status, setStatus] = useState('');
  const [mapFilter, setMapFilter] = useState('');
  const [refresh, setRefresh] = useState(0);
  const maps = useListing<MapSummary>('maps', search, sort, '', refresh, '');
  const walks = useListing<WalkSummary>('walks', search, sort, status, refresh, mapFilter);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [active, setActive] = useState<{ world: PreparedWorld; session: Session } | null>(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [speed, setSpeed] = useState(1.4);
  const [inputMode, setInputMode] = useState<'keyboard' | 'touch'>(
    navigator.maxTouchPoints > 0 ? 'touch' : 'keyboard',
  );
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [pendingWrite, setPendingWrite] = useState(false);
  const [rename, setRename] = useState<MapSummary | null>(null);
  const [title, setTitle] = useState('');
  const [deletion, setDeletion] = useState<{
    kind: 'project' | 'walk';
    id: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void store<{ sessions: Session[] }>('recover', {})
      .then((r) => {
        if (live) {
          if (r.sessions.length)
            setNotice(
              `Незавершённых попыток: ${r.sessions.length}. Откройте вкладку «Прохождения», чтобы продолжить с последней записи.`,
            );
          setRefresh((n) => n + 1);
        }
      })
      .catch((e) => {
        if (live) setNotice(message(e));
      });
    return () => {
      live = false;
    };
  }, []);
  const cancel = () => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setLoading('');
    setError('');
    setSelection(null);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || event.defaultPrevented || pendingWrite) return;
      if (exportSelection) setExportSelection(null);
      else if (rename) setRename(null);
      else if (deletion) setDeletion(null);
      else if (selection || loading || error) cancel();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [exportSelection, rename, deletion, selection, loading, error, pendingWrite]);
  const begin = (label: string) => {
    cancel();
    const id = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(label);
    return { id, signal: abort.signal, fresh: () => generation.current === id };
  };
  const openMap = async (row: MapSummary, preview: boolean) => {
    const job = begin('Загружаем и проверяем карту…');
    try {
      const saved = await store<MapRevision>('get', { kind: 'map', hash: row.revisionHash });
      if (!job.fresh()) return;
      const world = await prepare(saved.document, job.signal);
      if (!job.fresh()) return;
      if (preview) localStorage.setItem(`maze-preview:${row.revisionHash}`, '1');
      setSelection({ world, title: row.title, preview, mapHash: row.revisionHash });
      setLoading('');
    } catch (e) {
      if (job.fresh()) {
        setError(message(e));
        setLoading('');
      }
    }
  };
  const create = async () => {
    const job = begin('Подготавливаем две комнаты…');
    try {
      const world = await prepare(starterDocument(), job.signal);
      if (!job.fresh()) return;
      setPendingWrite(true);
      await store('save', {
        revision: revision(world),
        projectId: crypto.randomUUID(),
        title: world.physical.document.metadata.title,
      });
      setRefresh((n) => n + 1);
      if (job.fresh()) {
        setSelection({ world, title: 'Две комнаты', preview: false, mapHash: world.revisionHash });
        setLoading('');
      }
    } catch (e) {
      if (job.fresh()) {
        setError(message(e));
        setLoading('');
      }
    } finally {
      setPendingWrite(false);
    }
  };
  const start = async () => {
    if (!selection || pendingWrite) return;
    setPendingWrite(true);
    setError('');
    try {
      const condition = makeCondition({
        environment: selection.world.physical.document.environment,
        previewed: localStorage.getItem(`maze-preview:${selection.mapHash}`) === '1',
        inputMode,
        speedMps: speed,
        goalDirectionKnown: false,
        siteKnown: false,
        observationProfile: 'visual-v1',
      });
      const session = await store<Session>('save', {
        kind: 'session',
        sessionId: crypto.randomUUID(),
        mapHash: selection.mapHash,
        condition,
      });
      setActive({ world: selection.world, session });
      setSelection(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setPendingWrite(false);
    }
  };
  const openWalk = async (row: WalkSummary) => {
    const job = begin('Восстанавливаем подтверждённую запись…');
    try {
      const session = await store<Session>('get', { kind: 'session', sessionId: row.sessionId });
      if (!job.fresh()) return;
      const saved = await store<MapRevision>('get', { kind: 'map', hash: session.mapHash });
      if (!job.fresh()) return;
      const world = await prepare(saved.document, job.signal);
      if (!job.fresh()) return;
      setActive({ world, session });
      setLoading('');
    } catch (e) {
      if (job.fresh()) {
        setError(message(e));
        setLoading('');
      }
    }
  };
  const removeMap = async (row: MapSummary) => {
    try {
      const preview = await store<{ walks: number; retainedMap: boolean }>('delete', {
        kind: 'project-preview',
        projectId: row.projectId,
      });
      setDeletion({
        kind: 'project',
        id: row.projectId,
        text: `Удалить проект «${row.title}» и его черновик? Связанных попыток: ${preview.walks}. Прохождения сохранятся. ${preview.retainedMap ? 'Карта останется доступна по существующим ссылкам.' : 'Карта без ссылок будет удалена.'}`,
      });
    } catch (e) {
      setNotice(message(e));
    }
  };
  const runMutation = async (run: () => Promise<unknown>) => {
    setPendingWrite(true);
    try {
      await run();
      setRefresh((n) => n + 1);
      setRename(null);
      setDeletion(null);
    } catch (e) {
      setNotice(message(e));
    } finally {
      setPendingWrite(false);
    }
  };
  if (active)
    return (
      <WalkView
        world={active.world}
        session={active.session}
        onClose={() => {
          setActive(null);
          setRefresh((n) => n + 1);
        }}
      />
    );
  const list = tab === 'maps' ? maps : walks;
  return (
    <main>
      <header className="masthead">
        <div>
          <p className="eyebrow">MAZE LAB · НОВОЕ НАЧАЛО</p>
          <h1>Библиотека лабиринтов</h1>
          <p className="intro">Проектируйте пространство. Исследуйте маршрут.</p>
        </div>
        <button
          className="primary"
          disabled={pendingWrite || !!loading}
          onClick={() => void create()}
        >
          Создать две комнаты
        </button>
      </header>
      {notice && (
        <aside className="notice" role="status">
          {notice}
          <button aria-label="Закрыть уведомление" onClick={() => setNotice('')}>
            ×
          </button>
        </aside>
      )}
      <ImportPanel
        onCommitted={(notice) => {
          setNotice(notice);
          setRefresh((n) => n + 1);
        }}
      />
      <nav className="tabs" aria-label="Библиотека">
        <button aria-current={tab === 'maps' ? 'page' : undefined} onClick={() => setTab('maps')}>
          Карты
        </button>
        <button aria-current={tab === 'walks' ? 'page' : undefined} onClick={() => setTab('walks')}>
          Прохождения
        </button>
      </nav>
      <div className="filters">
        <label>
          Поиск
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск в библиотеке"
          />
        </label>
        <label>
          Сортировка
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="updated-desc">Сначала недавние</option>
            <option value="title-asc">По названию</option>
          </select>
        </label>
        {tab === 'walks' && (
          <label>
            Статус
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Все</option>
              {Object.entries(stateLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        {mapFilter && tab === 'walks' && (
          <button onClick={() => setMapFilter('')}>Сбросить фильтр карты</button>
        )}
      </div>
      {!!(markedMaps.length + markedWalks.length) && (
        <div className="toolbar">
          <button
            onClick={() => setExportSelection({ mapHashes: markedMaps, sessionIds: markedWalks })}
          >
            Экспортировать выбранное ({markedMaps.length + markedWalks.length})
          </button>
          <button
            onClick={() => {
              setMarkedMaps([]);
              setMarkedWalks([]);
            }}
          >
            Снять выбор
          </button>
        </div>
      )}
      <section
        className="library"
        aria-label={tab === 'maps' ? 'Список карт' : 'Список прохождений'}
        aria-busy={list.loading}
      >
        {list.error && (
          <div role="alert">
            <p>{list.error}</p>
            <button onClick={() => void list.retry()}>Повторить загрузку</button>
          </div>
        )}
        {list.loading && <p role="status">Загрузка списка…</p>}
        {!list.loading && !list.error && !list.rows.length && (
          <div className="empty">
            <h2>
              {search || status || mapFilter
                ? 'Ничего не найдено'
                : tab === 'maps'
                  ? 'Здесь начнётся первый маршрут'
                  : 'Попыток пока нет'}
            </h2>
            <p>
              {tab === 'maps'
                ? 'Создайте карту из двух комнат или измените поиск.'
                : 'Выберите карту и начните прохождение.'}
            </p>
          </div>
        )}
        {tab === 'maps'
          ? maps.rows.map((row, index) => (
              <article className="card" key={row.revisionHash}>
                <div>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать карту ${index + 1}`}
                      checked={markedMaps.includes(row.revisionHash)}
                      onChange={(e) => mark(row.revisionHash, e.target.checked, setMarkedMaps)}
                    />
                    Выбрать
                  </label>
                  <p className="eyebrow">
                    КАРТА {index + 1} · {row.revisionHash.slice(0, 8)}
                  </p>
                  <h2>Неизвестный маршрут</h2>
                  <p>Готова к прохождению</p>
                </div>
                <div className="actions">
                  <button className="primary" onClick={() => void openMap(row, false)}>
                    Пройти вслепую
                  </button>
                  <button onClick={() => void openMap(row, true)}>Посмотреть</button>
                  <button
                    onClick={() => {
                      setTab('walks');
                      setMapFilter(row.revisionHash);
                    }}
                  >
                    Попытки
                  </button>
                  <button
                    onClick={() => {
                      setRename(row);
                      setTitle(row.title);
                    }}
                  >
                    Переименовать
                  </button>
                  <button
                    onClick={() =>
                      setExportSelection({ mapHashes: [row.revisionHash], sessionIds: [] })
                    }
                  >
                    Экспорт карты
                  </button>
                  <button onClick={() => void removeMap(row)}>Удалить</button>
                </div>
              </article>
            ))
          : walks.rows.map((row) => (
              <article className="card" key={row.sessionId}>
                <div>
                  <p className="eyebrow">ПОПЫТКА {row.sessionId.slice(0, 8)}</p>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать попытку ${row.sessionId.slice(0, 8)}`}
                      checked={markedWalks.includes(row.sessionId)}
                      onChange={(e) => mark(row.sessionId, e.target.checked, setMarkedWalks)}
                    />
                    Выбрать
                  </label>
                  <h2>{stateLabels[row.status]}</h2>
                  <p>
                    {(row.elapsedMs / 1000).toFixed(1)} с · {row.distanceM.toFixed(2)} м
                  </p>
                </div>
                <div className="actions">
                  <button onClick={() => void openWalk(row)}>
                    {['finished', 'stopped'].includes(row.status) ? 'Результат' : 'Продолжить'}
                  </button>
                  <button
                    onClick={() =>
                      setExportSelection({ mapHashes: [], sessionIds: [row.sessionId] })
                    }
                  >
                    Экспорт попытки
                  </button>
                  <button
                    onClick={() =>
                      setDeletion({
                        kind: 'walk',
                        id: row.sessionId,
                        text: 'Удалить эту попытку и все её записи движения? Карта сохранится.',
                      })
                    }
                  >
                    Удалить
                  </button>
                </div>
              </article>
            ))}
        {list.cursor && (
          <button disabled={list.loading} onClick={() => void list.more()}>
            Загрузить ещё
          </button>
        )}
      </section>
      {(loading || selection || error) && (
        <div className={selection ? 'modal-backdrop' : 'load-panel'}>
          <section
            className="modal"
            role={selection ? 'dialog' : 'region'}
            aria-modal={selection ? true : undefined}
            aria-label="Выбранная карта"
          >
            <header className="toolbar">
              <h2>{selection?.preview ? selection.title : 'Подготовка маршрута'}</h2>
              <button disabled={pendingWrite} onClick={cancel}>
                Закрыть
              </button>
            </header>
            {loading && <p role="status">{loading}</p>}
            {error && <p role="alert">{error}</p>}
            {selection && (
              <>
                {selection.preview && <WorldView world={selection.world} />}
                <p>
                  {localStorage.getItem(`maze-preview:${selection.mapHash}`) === '1'
                    ? 'Карта уже просмотрена. Это будет записано в условиях попытки.'
                    : 'План и название скрыты. Можно начать без предварительного просмотра.'}
                </p>
                <div className="filters">
                  <label>
                    Скорость
                    <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                      <option value={1.4}>Шаг · 1,4 м/с</option>
                      <option value={2.8}>Бег · 2,8 м/с</option>
                    </select>
                  </label>
                  <label>
                    Управление
                    <select
                      value={inputMode}
                      onChange={(e) => setInputMode(e.target.value as typeof inputMode)}
                    >
                      <option value="keyboard">Клавиатура и мышь</option>
                      <option value="touch">Сенсорное</option>
                    </select>
                  </label>
                </div>
                <button className="primary" disabled={pendingWrite} onClick={() => void start()}>
                  Подготовить попытку
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {exportSelection && (
        <ExportPanel
          key={JSON.stringify(exportSelection)}
          selection={exportSelection}
          onClose={() => setExportSelection(null)}
        />
      )}
      {rename && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Переименование проекта"
            onSubmit={(e) => {
              e.preventDefault();
              void runMutation(() => store('rename', { projectId: rename.projectId, title }));
            }}
          >
            <h2>Название проекта</h2>
            <label>
              Название
              <input
                maxLength={256}
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button disabled={pendingWrite}>Сохранить название</button>
            <button type="button" disabled={pendingWrite} onClick={() => setRename(null)}>
              Отмена
            </button>
          </form>
        </div>
      )}
      {deletion && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение удаления"
          >
            <p>{deletion.text}</p>
            <button
              disabled={pendingWrite}
              onClick={() =>
                void runMutation(() =>
                  store('delete', {
                    kind: deletion.kind,
                    confirmed: true,
                    ...(deletion.kind === 'project'
                      ? { projectId: deletion.id }
                      : { sessionId: deletion.id }),
                  }),
                )
              }
            >
              Подтвердить удаление
            </button>
            <button disabled={pendingWrite} onClick={() => setDeletion(null)}>
              Отмена
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
