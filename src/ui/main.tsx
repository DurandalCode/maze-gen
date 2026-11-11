import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { emptyDocument } from '../domain';
import type { Document, MapRevision, GenerationOrigin } from '../domain';
import type { PreparedWorld } from '../jobs/compute';
import type {
  Draft,
  DraftSummary,
  ListCursor,
  MapSummary,
  Page,
  WalkSummary,
  Project,
} from '../repository/types';
import type { Session } from '../session/types';
import { makeCondition } from '../session/format';
import { store, prepare, revision, message } from './services';
import { starterDocument } from './starter';
const WorldView = lazy(() => import('./WorldView').then((m) => ({ default: m.WorldView })));
const WalkView = lazy(() => import('./WalkView').then((m) => ({ default: m.WalkView })));
const EditorView = lazy(() => import('./EditorView').then((m) => ({ default: m.EditorView })));
const GenerationView = lazy(() =>
  import('./GenerationView').then((m) => ({ default: m.GenerationView })),
);
import { generationOrigin } from '../generation/manifest';
import type { EditorInput } from './EditorView';
import { nativeExportAvailable } from '../platform/native-export';
import { ImportPanel } from './ImportPanel';
import { ExportPanel } from './ExportPanel';
import type { ExportSelection } from '../exchange/export-repository';
import { stateLabels } from './session-labels';
import { MapDetailsPage } from './MapDetailsPage';
import { ServerRoutes } from './ServerRoutes';
const ServerRouteView = lazy(() =>
  import('./ServerRouteView').then((m) => ({ default: m.ServerRouteView })),
);
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
type Selection = {
  world: PreparedWorld;
  title: string;
  preview: boolean;
  mapHash: string;
  origin?: GenerationOrigin;
};
function App() {
  const [serverRoute, setServerRoute] = useState(() =>
    new URLSearchParams(window.location.search).get('route'),
  );
  const closeServerRoute = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('route');
    url.searchParams.delete('map');
    url.searchParams.delete('blind');
    window.history.replaceState(null, '', url);
    setServerRoute(null);
  };
  const [sharedMode, setSharedMode] = useState<boolean | null>(null);
  useEffect(() => {
    void store<{ shared: boolean }>('get', { kind: 'storage-mode' })
      .then((m) => setSharedMode(m.shared))
      .catch(() => {});
  }, []);
  const [generationSource, setGenerationSource] = useState<Document | null>(null);
  const [editor, setEditor] = useState<EditorInput | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const desktopEditing = !nativeExportAvailable() && !/Android/i.test(navigator.userAgent);
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
  const [active, setActive] = useState<{
    world: PreparedWorld;
    session: Session;
    autoStart?: boolean;
  } | null>(null);
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
  useEffect(() => {
    if (!sharedMode || active || editor || generationSource || serverRoute !== null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh((n) => n + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [sharedMode, active, editor, generationSource, serverRoute]);

  const [rename, setRename] = useState<MapSummary | null>(null);
  const [title, setTitle] = useState('');
  const [deletion, setDeletion] = useState<{
    kind: 'project' | 'walk';
    id: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void store<{ sessions: Session[]; drafts: DraftSummary[] }>('recover', {})
      .then((r) => {
        if (live) {
          setDrafts(r.drafts);
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
  useEffect(() => {
    let live = true;
    void store<DraftSummary[]>('list', { kind: 'drafts' })
      .then((rows) => {
        if (live) setDrafts(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refresh]);
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
  const openMap = async (row: MapSummary, preview: boolean, navigate = true) => {
    const job = begin('Загружаем и проверяем карту…');
    try {
      const saved = await store<MapRevision>('get', { kind: 'map', hash: row.revisionHash });
      if (!job.fresh()) return;
      const world = await prepare(saved.document, job.signal);
      if (!job.fresh()) return;
      if (preview) localStorage.setItem(`maze-preview:${row.revisionHash}`, '1');
      setSelection({
        world,
        title: row.title,
        preview,
        mapHash: row.revisionHash,
        origin: saved.generationOrigin,
      });
      if (navigate) {
        const url = new URL(window.location.href);
        url.search = '';
        url.searchParams.set('map', row.revisionHash);
        if (!preview) url.searchParams.set('blind', '1');
        window.history.pushState(null, '', url);
      }
      setLoading('');
    } catch (e) {
      if (job.fresh()) {
        setError(message(e));
        setLoading('');
      }
    }
  };
  const openHash = async (hash: string, preview: boolean) => {
    try {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Неверная ссылка на лабиринт.');
      const row = await store<MapSummary | null>('get', { kind: 'map-summary', hash });
      if (!row) throw new Error('Лабиринт не найден в этой библиотеке.');
      await openMap(row, preview, false);
    } catch (e) {
      setError(message(e));
    }
  };
  useEffect(() => {
    const url = new URL(window.location.href),
      hash = url.searchParams.get('map');
    if (hash && !url.searchParams.has('route'))
      void openHash(hash, url.searchParams.get('blind') !== '1');
  }, []);
  useEffect(() => {
    const back = () => {
      if (active || editor) return;
      const url = new URL(window.location.href),
        hash = url.searchParams.get('map');
      if (hash) void openHash(hash, url.searchParams.get('blind') !== '1');
      else {
        cancel();
        setServerRoute(url.searchParams.get('route'));
      }
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [active, editor]);
  const openEditor = async (row: MapSummary) => {
    const previous = selection;
    const job = begin('Открываем редактор…');
    if (previous) setSelection(previous);
    try {
      const [saved, project] = await Promise.all([
        store<MapRevision>('get', { kind: 'map', hash: row.revisionHash }),
        store<Project | null>('get', { kind: 'project', projectId: row.projectId }),
      ]);
      if (!job.fresh()) return;
      const current = project?.currentRevisionHash === row.revisionHash;
      setSelection(null);
      setEditor({
        document: {
          ...saved.document,
          metadata: {
            ...saved.document.metadata,
            title: current ? row.title : `${row.title.slice(0, 240)} (копия)`,
          },
        },
        projectId: current ? row.projectId : crypto.randomUUID(),
        baseRevisionHash: current ? row.revisionHash : null,
        generationOrigin: saved.generationOrigin,
        notice: current ? '' : 'Предыдущая ревизия открыта как черновик нового проекта.',
      });
      setLoading('');
    } catch (e) {
      if (job.fresh()) {
        setError(message(e));
        setLoading('');
      }
    }
  };
  const openDraft = async (row: DraftSummary) => {
    const job = begin('Открываем черновик…');
    try {
      const [draft, project] = await Promise.all([
        store<Draft>('get', { kind: 'draft', projectId: row.projectId }),
        store<Project | null>('get', { kind: 'project', projectId: row.projectId }),
      ]);
      if (!job.fresh()) return;
      const fork = (project?.currentRevisionHash ?? null) !== draft.baseRevisionHash;
      setEditor({
        document: fork
          ? {
              ...draft.document,
              metadata: {
                ...draft.document.metadata,
                title: `${draft.document.metadata.title.slice(0, 240)} (копия)`,
              },
            }
          : draft.document,
        projectId: fork ? crypto.randomUUID() : row.projectId,
        baseRevisionHash: fork ? null : draft.baseRevisionHash,
        commandRevision: draft.commandRevision,
        generationOrigin: draft.generationOrigin,
        recovered: !fork,
        notice: fork
          ? 'Проект изменился. Черновик открыт отдельной копией.'
          : 'Восстановлен сохранённый черновик.',
      });
      setLoading('');
    } catch (e) {
      if (job.fresh()) {
        setError(message(e));
        setLoading('');
      }
    }
  };
  const newEditor = (document?: Document, origin?: GenerationOrigin) => {
    cancel();
    const doc = document ?? emptyDocument(crypto.randomUUID());
    if (!document) {
      const now = new Date().toISOString();
      doc.metadata = { ...doc.metadata, createdAt: now, updatedAt: now };
    }
    setEditor({
      document: doc,
      generationOrigin: origin,
      projectId: crypto.randomUUID(),
      baseRevisionHash: null,
    });
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
  const start = async (autoStart = false) => {
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
      setActive({ world: selection.world, session, autoStart });
      setSelection(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setPendingWrite(false);
    }
  };
  const openWalk = async (row: WalkSummary, autoStart = false) => {
    const previous = selection;
    const job = begin('Восстанавливаем подтверждённую запись…');
    if (previous) setSelection(previous);
    try {
      const session = await store<Session>('get', { kind: 'session', sessionId: row.sessionId });
      if (!job.fresh()) return;
      const saved = await store<MapRevision>('get', { kind: 'map', hash: session.mapHash });
      if (!job.fresh()) return;
      const world = await prepare(saved.document, job.signal);
      if (!job.fresh()) return;
      setSelection(null);
      setActive({ world, session, autoStart });
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
  if (serverRoute !== null)
    return (
      <Suspense
        fallback={
          <main>
            <p role="status">Загружаем маршрут…</p>
          </main>
        }
      >
        <ServerRouteView
          id={serverRoute}
          onClose={closeServerRoute}
          onReady={(value) => {
            setServerRoute(null);
            const { world, map } = value;
            setSelection({
              world,
              title: value.summary?.title ?? map.document.metadata.title,
              preview: true,
              mapHash: map.revisionHash,
              origin: map.generationOrigin,
            });
            const url = new URL(window.location.href);
            url.search = '';
            url.searchParams.set('map', map.revisionHash);
            window.history.replaceState(null, '', url);
            setRefresh((n) => n + 1);
          }}
        />
      </Suspense>
    );
  if (generationSource)
    return (
      <Suspense
        fallback={
          <main>
            <p role="status">Открываем генератор…</p>
          </main>
        }
      >
        <GenerationView
          source={generationSource}
          onClose={() => setGenerationSource(null)}
          onChoose={(variant) => {
            setGenerationSource(null);
            newEditor(variant.document, generationOrigin(variant));
          }}
        />
      </Suspense>
    );
  if (editor)
    return (
      <Suspense
        fallback={
          <main>
            <p role="status">Открываем редактор…</p>
          </main>
        }
      >
        <EditorView
          key={editor.projectId}
          {...editor}
          onClose={() => {
            setEditor(null);
            setRefresh((n) => n + 1);
          }}
          onPlay={(world) => {
            setEditor(null);
            setSelection({
              world,
              title: world.physical.document.metadata.title,
              preview: true,
              mapHash: world.revisionHash,
              origin: editor.generationOrigin,
            });
            setRefresh((n) => n + 1);
          }}
          onImport={newEditor}
          onGenerate={(input) => {
            setEditor(input);
            setGenerationSource(input.document);
          }}
        />
      </Suspense>
    );
  if (active)
    return (
      <Suspense
        fallback={
          <main>
            <p role="status">Открываем прохождение…</p>
          </main>
        }
      >
        <WalkView
          world={active.world}
          session={active.session}
          autoStart={active.autoStart}
          onClose={() => {
            setActive(null);
            closeServerRoute();
            setRefresh((n) => n + 1);
          }}
        />
      </Suspense>
    );
  if (selection)
    return (
      <MapDetailsPage
        key={selection.mapHash}
        world={selection.world}
        title={selection.title}
        preview={selection.preview}
        origin={selection.origin}
        shared={sharedMode}
        speed={speed}
        inputMode={inputMode}
        busy={pendingWrite || !!loading}
        error={error}
        canEdit={desktopEditing}
        onSpeed={setSpeed}
        onInput={setInputMode}
        onClose={() => {
          cancel();
          closeServerRoute();
        }}
        onStart={(immediate) => void start(immediate)}
        onReveal={() => setSelection({ ...selection, preview: true })}
        onAttempt={(row) =>
          void openWalk(row, row.status !== 'finished' && row.status !== 'stopped')
        }
        onEdit={() => {
          void store<MapSummary | null>('get', { kind: 'map-summary', hash: selection.mapHash })
            .then((row) =>
              row
                ? openEditor(row)
                : newEditor(selection.world.physical.document, selection.origin),
            )
            .catch((e) => setError(message(e)));
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
        <button disabled={pendingWrite || !!loading} onClick={() => void create()}>
          Создать две комнаты
        </button>
        {desktopEditing && <button onClick={() => newEditor()}>Новый проект</button>}
        {desktopEditing && (
          <button
            className="primary"
            onClick={() => setGenerationSource(emptyDocument(crypto.randomUUID()))}
          >
            Создать лабиринт
          </button>
        )}
      </header>
      {notice && (
        <aside className="notice" role="status">
          {notice}
          <button aria-label="Закрыть уведомление" onClick={() => setNotice('')}>
            ×
          </button>
        </aside>
      )}
      {sharedMode !== null && (
        <p>
          {sharedMode
            ? 'Общая JSON-библиотека dev-сервера: карты и прохождения доступны во всех браузерах.'
            : 'Локальная библиотека этого браузера.'}
        </p>
      )}
      <ServerRoutes />
      <ImportPanel
        onCommitted={(notice) => {
          setNotice(notice);
          setRefresh((n) => n + 1);
        }}
      />
      {desktopEditing && drafts.length > 0 && (
        <section aria-label="Черновики" className="draft-list">
          <h2>Черновики</h2>
          {drafts.map((d) => (
            <article className="card" key={d.projectId}>
              <div>
                <h3>{d.title}</h3>
                <p>Модулей: {d.modules}</p>
              </div>
              <button onClick={() => void openDraft(d)}>Продолжить редактирование</button>
            </article>
          ))}
        </section>
      )}
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
                ? 'Создайте лабиринт или откройте пример из двух комнат.'
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
                  <h2>
                    {localStorage.getItem(`maze-preview:${row.revisionHash}`) === '1'
                      ? row.title
                      : 'Неизвестный маршрут'}
                  </h2>
                  <p>Готова к прохождению</p>
                </div>
                <div className="actions">
                  <button className="primary" onClick={() => void openMap(row, false)}>
                    Пройти вслепую
                  </button>
                  <button onClick={() => void openMap(row, true)}>Открыть карточку</button>
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
                  {desktopEditing && (
                    <button onClick={() => void openEditor(row)}>Редактировать</button>
                  )}
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
      {(loading || error) && (
        <section className="load-panel" aria-label="Loading map">
          <button onClick={cancel}>Закрыть</button>
          {loading && <p role="status">{loading}</p>}
          {error && <p role="alert">{error}</p>}
        </section>
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
