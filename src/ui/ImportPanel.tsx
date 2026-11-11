import { useEffect, useRef, useState } from 'react';
import type { MapRevision } from '../domain';
import type { JobHandle } from '../jobs/manager';
import type { GeometryProof, ImportPreview } from '../exchange/import-repository';
import type { PackageCounts } from '../exchange/package';
import { commitImport, compute, message, store, unwrap } from './services';

type Phase = 'idle' | 'checking' | 'review' | 'committing' | 'cancelling' | 'done' | 'error';
export function ImportPanel({ onCommitted }: { onCommitted: (notice: string) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [copies, setCopies] = useState(false);
  const state = useRef<{
    live: boolean;
    cancelled: boolean;
    stage: string | null;
    abort: AbortController | null;
    commit: JobHandle | null;
  }>({ live: true, cancelled: false, stage: null, abort: null, commit: null });
  const cleanupStage = async () => {
    const id = state.current.stage;
    if (id) {
      await store('validate-import', { kind: 'cancel', importId: id });
      if (state.current.stage === id) state.current.stage = null;
    }
  };
  useEffect(() => {
    state.current.live = true;
    return () => {
      state.current.live = false;
      state.current.cancelled = true;
      state.current.abort?.abort();
      if (state.current.commit) state.current.commit.cancel();
      else void cleanupStage().catch(() => {});
    };
  }, []);
  const check = async (file: File | undefined) => {
    if (!file) return;
    const s = state.current;
    s.cancelled = false;
    s.abort = new AbortController();
    setPhase('checking');
    setPreview(null);
    setCopies(false);
    setError('');
    setProgress('Проверяем формат, размер и зависимости…');
    try {
      await cleanupStage();
      const stage = await store<{ importId: string; counts: PackageCounts; mapHashes: string[] }>(
        'validate-import',
        { file },
      );
      s.stage = stage.importId;
      const proofs: GeometryProof[] = [];
      for (const [index, hash] of stage.mapHashes.entries()) {
        if (s.cancelled || !s.live) break;
        setProgress(`Проверяем геометрию карты ${index + 1} из ${stage.mapHashes.length}…`);
        const map = await store<MapRevision>('get', {
          kind: 'import-map',
          importId: stage.importId,
          hash,
        });
        if (s.cancelled || !s.live) break;
        const result = unwrap<{
          ok: boolean;
          revisionHash: string;
          worldHash: string;
          navHash: string;
          versions: GeometryProof['versions'];
          diagnostics?: { code: string; message: string }[];
        }>(
          await compute.submit(
            'import-preflight',
            map.document.revision,
            'validate',
            { document: map.document },
            { signal: s.abort.signal },
          ).result,
        );
        if (!result.ok)
          throw new Error(
            result.diagnostics?.map((d) => `${d.code}: ${d.message}`).join('\n') ??
              'Геометрия не прошла проверку',
          );
        proofs.push({
          revisionHash: result.revisionHash,
          worldHash: result.worldHash,
          navHash: result.navHash,
          versions: result.versions,
        });
      }
      if (s.cancelled || !s.live) {
        await cleanupStage();
        if (s.live) {
          setPhase('idle');
          setProgress('Проверка отменена. Библиотека не изменена.');
        }
        return;
      }
      const result = await store<ImportPreview>('validate-import', {
        kind: 'finish',
        importId: stage.importId,
        proofs,
      });
      if (s.cancelled || !s.live) {
        await cleanupStage();
        if (s.live) {
          setPhase('idle');
          setProgress('Проверка отменена. Библиотека не изменена.');
        }
        return;
      }
      setPreview(result);
      setPhase('review');
      setProgress('Проверка завершена. Библиотека ещё не изменена.');
    } catch (e) {
      await cleanupStage().catch(() => {});
      if (s.live) {
        setPhase(s.cancelled ? 'idle' : 'error');
        setError(s.cancelled ? '' : message(e));
        setProgress(
          s.cancelled ? 'Проверка отменена. Библиотека не изменена.' : 'Файл не импортирован.',
        );
      }
    }
  };
  const apply = async () => {
    const s = state.current;
    if (!preview || !s.stage) return;
    setPhase('committing');
    setProgress('Применяем импорт…');
    setError('');
    const job = commitImport(s.stage, copies);
    s.commit = job;
    try {
      const result = await job.result;
      if (result.state === 'completed') {
        const data = unwrap<{ committed: true; inserted: number }>(result);
        s.stage = null;
        const notice = data.inserted
          ? 'Импорт завершён. Библиотека обновлена.'
          : 'Все записи уже есть в библиотеке. Дубликаты пропущены.';
        if (s.live) {
          setPhase('done');
          setProgress(notice);
          setPreview(null);
        }
        onCommitted(notice);
      } else {
        await cleanupStage();
        if ((result.payload as { code?: string } | null)?.code === 'IMPORT_OUTCOME_UNKNOWN')
          onCommitted(
            'Статус импорта неизвестен после сбоя хранилища. Проверьте обновлённую библиотеку.',
          );
        if (s.live) {
          setPreview(null);
          setPhase(result.state === 'cancelled' ? 'idle' : 'error');
          setProgress(
            result.state === 'cancelled'
              ? 'Импорт отменён до коммита. Библиотека не изменена.'
              : 'Не удалось завершить импорт.',
          );
          if (result.state !== 'cancelled') {
            try {
              unwrap(result);
            } catch (e) {
              setError(message(e));
            }
          }
        }
      }
    } catch (e) {
      if (s.live) {
        setPhase('error');
        setError(message(e));
      }
    } finally {
      s.commit = null;
    }
  };
  const cancel = async () => {
    const s = state.current;
    s.cancelled = true;
    s.abort?.abort();
    if (s.commit) {
      setPhase('cancelling');
      setProgress('Запрошена отмена. Ожидаем результат транзакции…');
      s.commit.cancel();
      return;
    }
    if (phase === 'checking') {
      setPhase('cancelling');
      setProgress('Отменяем проверку…');
      return;
    }
    try {
      await cleanupStage();
      setPreview(null);
      setPhase('idle');
      setProgress('Импорт отменён. Библиотека не изменена.');
    } catch (e) {
      setPhase('error');
      setPreview(null);
      setError(message(e));
    }
  };
  const busy = ['checking', 'committing', 'cancelling'].includes(phase);
  return (
    <details className="import-panel">
      <summary>Импорт JSON</summary>
      <section aria-label="Импорт пакета">
        <p>
          Выберите пакет Maze Lab. До применения вы увидите состав, дубликаты и конфликты. Один файл
          — до 32 MiB.
        </p>
        <label>
          JSON-файл
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy || phase === 'review'}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void check(file);
            }}
          />
        </label>
        {progress && <p role="status">{progress}</p>}
        {error && <p role="alert">{error}</p>}
        {preview && (
          <div>
            <p>
              Карт: {preview.counts.maps} · Прохождений: {preview.counts.sessions} · Отсчётов:{' '}
              {preview.counts.samples}
            </p>
            <p>
              Дубликаты: карт {preview.duplicates.maps}, прохождений {preview.duplicates.sessions},
              определений {preview.duplicates.definitions}.
            </p>
            {!!preview.projectCopies.length && (
              <p>
                Проектов с совпадающим ID и другим содержимым: {preview.projectCopies.length}. Они
                будут добавлены копиями; существующие проекты сохранятся.
              </p>
            )}
            {!!preview.sessionConflicts.length && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={copies}
                  disabled={busy}
                  onChange={(e) => setCopies(e.target.checked)}
                />
                Импортировать {preview.sessionConflicts.length} конфликтующих попыток новыми копиями
              </label>
            )}
            <button
              className="primary"
              disabled={busy || (!!preview.sessionConflicts.length && !copies)}
              onClick={() => void apply()}
            >
              Применить импорт
            </button>
          </div>
        )}
        {(busy || preview) && (
          <button disabled={phase === 'cancelling'} onClick={() => void cancel()}>
            Отменить импорт
          </button>
        )}
      </section>
    </details>
  );
}
