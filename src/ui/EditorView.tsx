import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { controlCatalog, instantiate } from '../catalog/catalog';
import type { Definition, Diagnostic, Document, MapRevision, Opening, Point } from '../domain';
import { CommandStore, removal, snapped } from '../editor/commands';
import type { Selection } from '../editor/commands';
import { nearestBoundary } from '../editor/plan';
import { EditorPreparation } from '../jobs/editor-preparation';
import type { EditorPreparationState } from '../jobs/editor-preparation';
import type { PreparedWorld } from '../jobs/compute';
import { EditorPlan } from '../renderer/editor-plan';
import { EditorProperties, rotateWall } from './EditorProperties';
import { compute, message, store } from './services';
const WorldView = lazy(() => import('./WorldView').then((m) => ({ default: m.WorldView })));
export interface EditorInput {
  document: Document;
  projectId: string;
  baseRevisionHash: string | null;
  commandRevision?: number;
  recovered?: boolean;
  forkRequired?: boolean;
  notice?: string;
}
export interface EditorViewProps extends EditorInput {
  onClose: () => void;
  onPlay: (world: PreparedWorld) => void;
  onImport: (document: Document) => void;
}
type PendingDraft = { document: Document; projectId: string; baseRevisionHash: string | null };
const pendingState: EditorPreparationState = {
  status: 'pending',
  world: null,
  diagnostics: [],
  error: null,
  geometryRevision: -1,
  visualRevision: -1,
  sourceRevision: -1,
};
const diagnosticTitle = (d: Diagnostic) =>
  (
    ({
      OVERLAP: 'Модули пересекаются',
      WIDTH: 'Не хватает реального просвета',
      OPENING_REGION: 'Проём выходит за допустимую область',
      CONNECTION_SPAN: 'Соединение слишком длинное',
      UNREACHABLE: 'Вход, выход или часть карты недостижимы',
      TERMINALS: 'Нужны один вход и один выход',
      SITE: 'Конструкция выходит за площадку',
    }) as Record<string, string>
  )[d.code] ?? d.message;
export function EditorView(props: EditorViewProps) {
  const [commands] = useState(
    () =>
      new CommandStore({
        ...props.document,
        revision: Math.max(props.document.revision, props.commandRevision ?? 0),
      }),
  );
  const state = useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  const [preparation, setPreparation] = useState<EditorPreparationState>(pendingState);
  const [catalog] = useState(controlCatalog);
  const definitions = useMemo(() => {
    const byId = new Map(catalog.map((d) => [d.id, d]));
    for (const d of state.document.definitions) byId.set(d.id, d);
    return [...byId.values()];
  }, [catalog, state.document.definitions]);
  const [mode, setMode] = useState<'select' | 'wall' | 'opening' | 'connect'>('select');
  const [panel, setPanel] = useState<'selection' | 'site' | 'environment'>('selection');
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [snap, setSnap] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(
      props.notice ??
        (props.forkRequired ? 'Открыта предыдущая ревизия. Сохраните её отдельной копией.' : ''),
    );
  const [saving, setSaving] = useState(false),
    [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'error'>(
      props.recovered || props.baseRevisionHash !== null ? 'saved' : 'saving',
    );
  const [forkRequired, setForkRequired] = useState(props.forkRequired ?? false);
  const [draftError, setDraftError] = useState(''),
    [discard, setDiscard] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    plan = useRef<EditorPlan | null>(null),
    preparer = useRef<EditorPreparation | null>(null);
  const modeRef = useRef(mode),
    snapRef = useRef(snap),
    savingRef = useRef(false),
    live = useRef(true);
  const firstPoint = useRef<Point | null>(null),
    firstOpening = useRef<string | null>(null);
  const project = useRef(props.projectId),
    base = useRef(props.baseRevisionHash);
  const initialRevision = useRef(commands.getSnapshot().document.revision);
  const committedRevision = useRef(
    props.recovered || props.baseRevisionHash === null ? -1 : initialRevision.current,
  );
  const writtenRevision = useRef(
    props.recovered || props.baseRevisionHash !== null ? initialRevision.current : -1,
  );
  const draftRunner = useRef<{ running: Promise<void> | null; pending: PendingDraft | null }>({
    running: null,
    pending: null,
  });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  modeRef.current = mode;
  snapRef.current = snap;
  const report = (e: unknown) => {
    if (live.current) setError(message(e));
  };
  const apply = (label: string, changes: Parameters<CommandStore['execute']>[1]) => {
    if (savingRef.current) return false;
    try {
      setError('');
      return commands.execute(label, changes);
    } catch (e) {
      report(e);
      return false;
    }
  };
  const saveDraft = (): Promise<void> => {
    const document = commands.getSnapshot().document;
    if (writtenRevision.current === document.revision && !draftRunner.current.pending)
      return draftRunner.current.running ?? Promise.resolve();
    draftRunner.current.pending = {
      document,
      projectId: project.current,
      baseRevisionHash: base.current,
    };
    if (draftRunner.current.running) return draftRunner.current.running;
    const drain = async () => {
      if (live.current) {
        setDraftStatus('saving');
        setDraftError('');
      }
      while (draftRunner.current.pending) {
        const item = draftRunner.current.pending;
        draftRunner.current.pending = null;
        try {
          await store('draft', {
            projectId: item.projectId,
            document: item.document,
            baseRevisionHash: item.baseRevisionHash,
            commandRevision: item.document.revision,
          });
          writtenRevision.current = item.document.revision;
        } catch (e) {
          if (!draftRunner.current.pending) draftRunner.current.pending = item;
          if (live.current) {
            setDraftStatus('error');
            setDraftError(message(e));
          }
          throw e;
        }
      }
      if (live.current) {
        setDraftStatus('saved');
        setDraftError('');
      }
    };
    const running = drain().finally(() => {
      draftRunner.current.running = null;
    });
    draftRunner.current.running = running;
    return running;
  };
  useEffect(() => {
    live.current = true;
    const owner = `edit-${crypto.randomUUID()}`;
    const preparation = new EditorPreparation(commands, compute, owner, (value) => {
      if (live.current) {
        setPreparation(value);
        plan.current?.setDiagnostics(value.diagnostics);
      }
    });
    preparer.current = preparation;
    return () => {
      live.current = false;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      preparation.dispose();
      preparer.current = null;
    };
  }, [commands]);
  useEffect(() => {
    if (savingRef.current) return;
    if (
      state.document.revision === writtenRevision.current ||
      state.document.revision === committedRevision.current
    )
      return;
    setDraftStatus('saving');
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      void saveDraft().catch(() => {});
    }, 350);
    return () => {
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
    };
  }, [state.document]);
  useEffect(() => {
    if (state.selection) setPanel('selection');
  }, [state.selection?.field, state.selection?.id]);
  const ready =
    preparation.status === 'ready' &&
    !!preparation.world &&
    preparation.geometryRevision === state.geometryRevision &&
    preparation.visualRevision === state.visualRevision &&
    !state.gesture;
  useEffect(() => {
    if (ready && preparation.world) {
      try {
        localStorage.setItem(`maze-preview:${preparation.world.revisionHash}`, '1');
      } catch {
        setNotice('Браузер не разрешил запомнить факт просмотра.');
      }
    }
  }, [ready, preparation.world?.revisionHash]);
  const pointSnap = (point: Point) =>
    snapped({ position: point, rotationRad: 0 }, snapRef.current).position;
  const pointer = (
    kind: 'down' | 'move' | 'up',
    point: Point,
    selection: Selection | null,
  ): boolean => {
    if (savingRef.current) return true;
    const tool = modeRef.current;
    if (tool === 'select') return false;
    if (kind === 'move' && tool === 'wall' && firstPoint.current) {
      plan.current?.setGuide([firstPoint.current, pointSnap(point)]);
      return true;
    }
    if (kind !== 'down') return true;
    try {
      if (tool === 'wall') {
        const next = pointSnap(point);
        if (!firstPoint.current) {
          firstPoint.current = next;
          plan.current?.setGuide([next, next]);
          setNotice('Выберите вторую точку стены.');
          return true;
        }
        if (Math.hypot(next.x - firstPoint.current.x, next.z - firstPoint.current.z) < 0.01) {
          setNotice('Вторая точка должна отличаться от первой.');
          return true;
        }
        const id = crypto.randomUUID();
        commands.execute('Добавление стены', [
          {
            field: 'freeWalls',
            id,
            value: {
              id,
              centerline: { id: `segment-${id}`, kind: 'line', from: firstPoint.current, to: next },
              constructionProfileRef: 'physical-v1',
            },
          },
        ]);
        commands.select({ field: 'freeWalls', id });
        firstPoint.current = null;
        plan.current?.setGuide(null);
        setMode('select');
        setNotice('');
        return true;
      }
      if (tool === 'opening') {
        const selected = commands.getSnapshot().selection;
        const moduleId =
          selection?.field === 'instances'
            ? selection.id
            : selected?.field === 'instances'
              ? selected.id
              : selection?.field === 'openings'
                ? commands.getSnapshot().document.openings.find((o) => o.id === selection.id)
                    ?.instanceId
                : selected?.field === 'openings'
                  ? commands.getSnapshot().document.openings.find((o) => o.id === selected.id)
                      ?.instanceId
                  : undefined;
        const module = moduleId && plan.current?.getModel()?.modules.get(moduleId);
        if (!module) {
          setNotice('Сначала выберите модуль или нажмите на его грань.');
          return true;
        }
        const nearest = nearestBoundary(module, point);
        if (!nearest) return true;
        const definition = commands
            .getSnapshot()
            .document.definitions.find((d) => d.contentHash === module.instance.definitionHash)!,
          region = definition.openingRegions.find((r) => r.segmentId === nearest.segment.id);
        if (!region) {
          setNotice('На этой грани проёмы не предусмотрены.');
          return true;
        }
        const id = crypto.randomUUID();
        commands.execute('Добавление проёма', [
          {
            field: 'openings',
            id,
            value: {
              id,
              instanceId: module.instance.id,
              regionId: region.id,
              boundarySegmentId: region.segmentId,
              uCenter: nearest.u,
              widthM: Math.min(region.maxWidthM, Math.max(region.minWidthM, 1.4)),
              role: 'ordinary',
            },
          },
        ]);
        commands.select({ field: 'openings', id });
        setMode('select');
        setNotice('Укажите назначение проёма и проверьте его положение.');
        return true;
      }
      if (tool === 'connect') {
        if (selection?.field !== 'openings') {
          setNotice('Нажмите на маркер внутреннего проёма.');
          return true;
        }
        const doc = commands.getSnapshot().document,
          opening = doc.openings.find((o) => o.id === selection.id)!;
        if (opening.role !== 'ordinary') {
          setNotice('Вход и выход не используются как внутреннее соединение.');
          return true;
        }
        if (doc.connections.some((c) => c.openingA === opening.id || c.openingB === opening.id)) {
          setNotice('Этот проём уже соединён.');
          return true;
        }
        if (!firstOpening.current) {
          firstOpening.current = opening.id;
          commands.select(selection);
          setNotice('Теперь выберите второй внутренний проём.');
          return true;
        }
        if (firstOpening.current === opening.id) return true;
        const id = crypto.randomUUID();
        commands.execute('Соединение проёмов', [
          {
            field: 'connections',
            id,
            value: { id, openingA: firstOpening.current, openingB: opening.id },
          },
        ]);
        commands.select({ field: 'connections', id });
        firstOpening.current = null;
        setMode('select');
        setNotice('');
        return true;
      }
    } catch (e) {
      report(e);
    }
    return true;
  };
  const pointerRef = useRef(pointer);
  pointerRef.current = pointer;
  useEffect(() => {
    if (view !== 'plan' || !canvas.current) return;
    const renderer = new EditorPlan(canvas.current, commands, {
      snap: () => snapRef.current,
      error: report,
      pointer: (...args) => pointerRef.current(...args),
    });
    plan.current = renderer;
    renderer.setDiagnostics(preparation.diagnostics);
    return () => {
      renderer.dispose();
      plan.current = null;
    };
  }, [commands, view]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || savingRef.current) return;
      if (
        event.target instanceof HTMLElement &&
        /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)
      )
        return;
      if (
        event.code === 'Escape' &&
        (modeRef.current !== 'select' || firstPoint.current || firstOpening.current)
      ) {
        event.preventDefault();
        setMode('select');
        firstPoint.current = null;
        firstOpening.current = null;
        plan.current?.setGuide(null);
        setNotice('');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) commands.redo();
        else commands.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
        event.preventDefault();
        commands.redo();
        return;
      }
      const current = commands.getSnapshot(),
        selected = current.selection;
      if ((event.code === 'Delete' || event.code === 'Backspace') && selected) {
        event.preventDefault();
        apply('Удаление объекта', removal(current.document, selected));
      }
      if (event.code === 'KeyR' && selected) {
        const delta = ((event.shiftKey ? -1 : 1) * Math.PI) / 12;
        if (selected.field === 'instances') {
          const instance = current.document.instances.find((i) => i.id === selected.id)!;
          apply('Поворот модуля', [
            {
              field: 'instances',
              id: instance.id,
              value: { ...instance, rotationRad: instance.rotationRad + delta },
            },
          ]);
        } else if (selected.field === 'freeWalls') {
          const wall = current.document.freeWalls.find((w) => w.id === selected.id)!;
          apply('Поворот стены', [
            { field: 'freeWalls', id: wall.id, value: rotateWall(wall, delta) },
          ]);
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [commands]);
  const add = (definition: Definition) => {
    if (savingRef.current) return;
    const doc = commands.getSnapshot().document,
      model = plan.current?.getModel();
    const r = canvas.current?.getBoundingClientRect();
    const center =
      r && plan.current
        ? plan.current.worldPoint(r.left + r.width / 2, r.top + r.height / 2)
        : { x: 25, z: 25 };
    const positions = [
      center,
      ...Array.from({ length: 100 }, (_, i) => {
        const direction = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
          ][i % 8]!,
          distance = (Math.floor(i / 8) + 1) * 5;
        return { x: center.x + direction[0]! * distance, z: center.z + direction[1]! * distance };
      }),
    ];
    const position =
      positions.find(
        (p) =>
          ![...(model?.modules.values() ?? [])].some(
            (m) =>
              p.x >= m.bounds.minX - 2.5 &&
              p.x <= m.bounds.maxX + 2.5 &&
              p.z >= m.bounds.minZ - 2.5 &&
              p.z <= m.bounds.maxZ + 2.5,
          ),
      ) ?? center;
    const id = crypto.randomUUID(),
      changes: Parameters<CommandStore['execute']>[1] = [];
    if (!doc.definitions.some((d) => d.contentHash === definition.contentHash))
      changes.push({ field: 'definitions', id: definition.contentHash, value: definition });
    changes.push({
      field: 'instances',
      id,
      value: instantiate(definition, id, pointSnap(position)),
    });
    if (!apply('Добавление модуля', changes)) return;
    commands.select({ field: 'instances', id });
    setMode('select');
    setPanel('selection');
    plan.current?.fit('objects');
  };
  const addArc = () => {
    if (savingRef.current) return;
    const r = canvas.current?.getBoundingClientRect(),
      center =
        r && plan.current
          ? plan.current.worldPoint(r.left + r.width / 2, r.top + r.height / 2)
          : { x: 25, z: 25 };
    const id = crypto.randomUUID();
    const added = apply('Дуговая стена', [
      {
        field: 'freeWalls',
        id,
        value: {
          id,
          centerline: {
            id: `segment-${id}`,
            kind: 'arc',
            center,
            radius: 1,
            startAngle: 0,
            sweep: Math.PI / 2,
          },
          constructionProfileRef: 'physical-v1',
        },
      },
    ]);
    if (added) commands.select({ field: 'freeWalls', id });
  };
  const saveReady = async (copy = false): Promise<PreparedWorld> => {
    const source = commands.getSnapshot(),
      checked = preparer.current?.getState();
    if (
      !checked ||
      checked.status !== 'ready' ||
      !checked.world ||
      checked.geometryRevision !== source.geometryRevision ||
      checked.visualRevision !== source.visualRevision ||
      source.gesture
    )
      throw new Error('Дождитесь проверки текущей карты и исправьте ошибки.');
    savingRef.current = true;
    setSaving(true);
    setError('');
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    try {
      if (draftRunner.current.running) await draftRunner.current.running.catch(() => {});
      if (!copy && writtenRevision.current !== source.document.revision) await saveDraft();
      const target = copy ? crypto.randomUUID() : project.current;
      const revision: MapRevision = {
        revisionHash: checked.world.revisionHash,
        document: source.document,
        versions: checked.world.versions,
        validationSummary: { ready: true, diagnostics: [] },
      };
      await store('save', {
        revision,
        projectId: target,
        title: source.document.metadata.title,
        expectedBaseRevisionHash: copy ? null : base.current,
      });
      project.current = target;
      base.current = revision.revisionHash;
      committedRevision.current = source.document.revision;
      writtenRevision.current = source.document.revision;
      draftRunner.current.pending = null;
      setForkRequired(false);
      setDraftStatus('saved');
      setDraftError('');
      setNotice(
        copy ? 'Карта сохранена отдельным проектом.' : 'Проверенная карта сохранена в библиотеке.',
      );
      return {
        ...checked.world,
        physical: {
          ...checked.world.physical,
          document: source.document,
          sourceRevision: source.document.revision,
        },
      };
    } finally {
      savingRef.current = false;
      if (live.current) setSaving(false);
    }
  };
  const save = async (copy = false, play = false) => {
    try {
      const world = await saveReady(copy);
      if (play) props.onPlay(world);
    } catch (e) {
      report(e);
    }
  };
  const close = async () => {
    if (savingRef.current) return;
    try {
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
      if (commands.getSnapshot().document.revision !== committedRevision.current) await saveDraft();
      if (draftRunner.current.running) await draftRunner.current.running;
      props.onClose();
    } catch (e) {
      setDraftError(message(e));
      setDiscard(true);
    }
  };
  const backup = async () => {
    try {
      const data = await store<{ blob: Blob; filename: string }>('export', {
        kind: 'draft',
        document: commands.getSnapshot().document,
      });
      const url = URL.createObjectURL(data.blob),
        anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = data.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      report(e);
    }
  };
  const loadBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const doc = await store<Document>('get', { kind: 'draft-file', file });
      if (commands.getSnapshot().document.revision !== committedRevision.current) await saveDraft();
      props.onImport(doc);
    } catch (e) {
      report(e);
    }
  };
  return (
    <main className="editor-app">
      <header className="editor-header">
        <div>
          <p className="eyebrow">MAZE LAB · РЕДАКТОР</p>
          <label>
            Название проекта
            <input
              key={state.document.metadata.title}
              defaultValue={state.document.metadata.title}
              maxLength={256}
              disabled={saving}
              onBlur={(event) => {
                if (event.target.value !== commands.getSnapshot().document.metadata.title)
                  apply('Название', [
                    {
                      field: 'metadata',
                      value: {
                        ...commands.getSnapshot().document.metadata,
                        title: event.target.value,
                      },
                    },
                  ]);
              }}
            />
          </label>
        </div>
        <div className="actions">
          <button disabled={saving} onClick={() => void close()}>
            В библиотеку
          </button>
          <button disabled={saving || !ready} onClick={() => void save(forkRequired)}>
            Сохранить {forkRequired ? 'копию' : 'карту'}
          </button>
          <button
            disabled={saving || !ready}
            className="primary"
            onClick={() => void save(forkRequired, true)}
          >
            Пройти
          </button>
        </div>
      </header>
      <div className="editor-status" role="status">
        {preparation.status === 'pending'
          ? 'Проверяем карту…'
          : preparation.status === 'ready'
            ? 'Карта проверена'
            : preparation.status === 'invalid'
              ? 'Нужно исправить карту'
              : 'Проверка не завершена'}{' '}
        ·{' '}
        {draftStatus === 'saving'
          ? 'Черновик сохраняется…'
          : draftStatus === 'error'
            ? 'Ошибка сохранения черновика'
            : state.document.revision === committedRevision.current
              ? 'Карта сохранена'
              : 'Черновик сохранён'}
      </div>
      <div className="editor-notice">
        {notice && (
          <p className="notice">
            {notice}
            <button aria-label="Закрыть подсказку" onClick={() => setNotice('')}>
              ×
            </button>
          </p>
        )}
      </div>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setError('')}>Закрыть ошибку</button>
          {ready && (
            <button disabled={saving} onClick={() => void save(true)}>
              Сохранить отдельную копию
            </button>
          )}
        </p>
      )}
      {draftError && (
        <p role="alert">
          {draftError}
          <button disabled={saving} onClick={() => void saveDraft().catch(report)}>
            Повторить сохранение
          </button>
          <button onClick={() => void backup()}>Скачать черновик</button>
        </p>
      )}
      <div className="editor-layout">
        <aside className="editor-catalog">
          <h2>Модули</h2>
          {definitions.map((d) => (
            <button key={d.contentHash} disabled={saving} onClick={() => add(d)}>
              {d.id}
            </button>
          ))}
          <h2>Инструменты</h2>
          <button
            aria-pressed={mode === 'select'}
            onClick={() => {
              setMode('select');
              firstPoint.current = null;
              firstOpening.current = null;
              plan.current?.setGuide(null);
            }}
          >
            Выбор
          </button>
          <button
            aria-pressed={mode === 'wall'}
            onClick={() => {
              setView('plan');
              setMode('wall');
              setNotice('Нажмите на две точки стены. Esc отменяет инструмент.');
            }}
          >
            Стена по двум точкам
          </button>
          <button disabled={saving} onClick={addArc}>
            Дуговая стена
          </button>
          <button
            aria-pressed={mode === 'opening'}
            onClick={() => {
              setView('plan');
              setMode('opening');
              setNotice('Выберите модуль, затем нажмите рядом с нужной гранью.');
            }}
          >
            Добавить проём
          </button>
          <button
            aria-pressed={mode === 'connect'}
            onClick={() => {
              setView('plan');
              setMode('connect');
              firstOpening.current = null;
              setNotice('Выберите два внутренних проёма.');
            }}
          >
            Соединить проёмы
          </button>
          <button
            onClick={() => {
              commands.select(null);
              setPanel('site');
            }}
          >
            Площадка
          </button>
          <button
            onClick={() => {
              commands.select(null);
              setPanel('environment');
            }}
          >
            Окружение
          </button>
          <label className="checkbox">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Привязка 0,1 м / 15°
          </label>
          <button onClick={() => void backup()}>Скачать черновик</button>
          <label>
            Открыть черновик JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={saving}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                void loadBackup(file);
              }}
            />
          </label>
        </aside>
        <section className="editor-stage" aria-label="Рабочая область редактора">
          <div className="toolbar">
            <div className="actions">
              <button disabled={!state.undoLabel || saving} onClick={() => commands.undo()}>
                Отменить
              </button>
              <button disabled={!state.redoLabel || saving} onClick={() => commands.redo()}>
                Повторить
              </button>
              <button aria-pressed={view === 'plan'} onClick={() => setView('plan')}>
                Редактировать план
              </button>
              <button disabled={!ready} aria-pressed={view === '3d'} onClick={() => setView('3d')}>
                Проверить 3D
              </button>
            </div>
            {view === 'plan' && (
              <div className="actions">
                <button onClick={() => plan.current?.fit('objects')}>По объектам</button>
                <button onClick={() => plan.current?.fit('site')}>Вся площадка</button>
              </div>
            )}
          </div>
          {view === 'plan' ? (
            <canvas
              ref={canvas}
              tabIndex={0}
              className={`editor-canvas${saving ? ' editor-busy' : ''}`}
              aria-label="План редактора"
            />
          ) : ready && preparation.world ? (
            <Suspense fallback={<p role="status">Открываем сцену…</p>}>
              <WorldView world={preparation.world} initialMode="3d" />
            </Suspense>
          ) : (
            <p>Исправьте карту для просмотра актуальной сцены.</p>
          )}
          <p className="editor-hint">
            Колесо — масштаб · средняя кнопка / Alt — панорама · Shift + перенос — поворот ·
            Ctrl/Cmd + Z — отмена
          </p>
          {preparation.error && (
            <p role="alert">
              {preparation.error}
              <button onClick={() => preparer.current?.retry()}>Повторить проверку</button>
            </p>
          )}
          {!!preparation.diagnostics.length && (
            <section aria-label="Ошибки карты" className="editor-diagnostics">
              <h2>Проверка карты</h2>
              {preparation.diagnostics.map((d, index) => (
                <div key={`${d.code}-${index}`}>
                  <button
                    onClick={() => {
                      const doc = commands.getSnapshot().document;
                      for (const id of d.objectIds ?? [])
                        for (const field of [
                          'instances',
                          'openings',
                          'connections',
                          'freeWalls',
                        ] as const)
                          if (doc[field].some((o) => o.id === id)) {
                            commands.select({ field, id });
                            return;
                          }
                    }}
                  >
                    {diagnosticTitle(d)}
                  </button>
                  <p>
                    {d.path}
                    {d.actual !== undefined ? ` · Сейчас: ${d.actual}` : ''}
                    {d.limit !== undefined ? ` · Предел: ${d.limit}` : ''}
                  </p>
                </div>
              ))}
            </section>
          )}
        </section>
        <aside className="editor-properties">
          <h2>Свойства</h2>
          <fieldset disabled={saving}>
            <EditorProperties store={commands} state={state} panel={panel} error={report} />
          </fieldset>
        </aside>
      </div>
      {discard && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Несохранённый черновик"
          >
            <p>
              Не удалось сохранить изменения. Скачайте черновик или повторите запись перед выходом.
            </p>
            <button onClick={() => void backup()}>Скачать черновик</button>
            <button
              onClick={() => {
                setDiscard(false);
                void close();
              }}
            >
              Повторить запись и выйти
            </button>
            <button onClick={props.onClose}>Выйти без сохранения</button>
            <button onClick={() => setDiscard(false)}>Остаться в редакторе</button>
          </section>
        </div>
      )}
    </main>
  );
}
