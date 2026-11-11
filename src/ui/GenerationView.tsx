import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import type { Document } from '../domain';
import { prototypeRequest } from '../generation/prototype';
import type { PrototypeSize } from '../generation/prototype';
import type { GenerationVariant } from '../generation/types';
import { GenerationSearch } from '../jobs/generation-search';
import { generationJobs } from '../jobs/clients';
import type { PreparedWorld } from '../jobs/compute';
import { message, prepare } from './services';
const WorldView = lazy(() => import('./WorldView').then((m) => ({ default: m.WorldView })));
const stages = {
  root: 'Готовим площадку',
  growth: 'Размещаем комнаты',
  cycles: 'Проверяем связи',
  validation: 'Проверяем геометрию и маршрут',
  variant: 'Карта готова',
};
export function GenerationView({
  source,
  onClose,
  onChoose,
}: {
  source: Document;
  onClose: () => void;
  onChoose: (variant: GenerationVariant) => void;
}) {
  const [search] = useState(() => new GenerationSearch(generationJobs())),
    state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const [seed, setSeed] = useState('maze-' + crypto.randomUUID().slice(0, 8)),
    [size, setSize] = useState<PrototypeSize>(12);
  const [error, setError] = useState(''),
    [selected, setSelected] = useState<GenerationVariant | null>(null),
    [world, setWorld] = useState<PreparedWorld | null>(null),
    [previewing, setPreviewing] = useState(false);
  useEffect(() => () => search.dispose(), [search]);
  useEffect(() => {
    setWorld(null);
    if (!selected) return;
    const controller = new AbortController();
    setPreviewing(true);
    void prepare(selected.document, controller.signal)
      .then((w) => {
        if (!controller.signal.aborted) setWorld(w);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewing(false);
      });
    return () => controller.abort();
  }, [selected]);
  const run = () => {
    try {
      setError('');
      setSelected(null);
      search.start(prototypeRequest(crypto.randomUUID(), seed, size));
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <main className="generation-app">
      <header className="masthead">
        <div>
          <p className="eyebrow">MAZE LAB · ВЕБ-ПРОТОТИП</p>
          <h1>Создать лабиринт</h1>
          <p>Сгенерируйте карту, поправьте её в редакторе и попробуйте пройти.</p>
        </div>
        <button onClick={onClose}>Назад</button>
      </header>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setError('')}>Закрыть ошибку</button>
        </p>
      )}
      <div className="generation-layout">
        <section aria-label="Параметры генерации">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <fieldset disabled={state.running}>
              <legend>Карта</legend>
              <label>
                Размер лабиринта
                <select
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value) as PrototypeSize)}
                >
                  <option value={12}>Небольшой · 12 комнат</option>
                  <option value={30}>Средний · 30 комнат</option>
                </select>
              </label>
              <label>
                Seed
                <input
                  value={seed}
                  maxLength={128}
                  required
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
              <p>Один и тот же размер и seed дают одну и ту же карту.</p>
              <button
                type="button"
                onClick={() => setSeed('maze-' + crypto.randomUUID().slice(0, 8))}
              >
                Новый seed
              </button>
              <button className="primary" type="submit">
                Сгенерировать
              </button>
            </fieldset>
          </form>
          {state.running && <button onClick={search.cancel}>Отменить поиск</button>}
          <details open>
            <summary>Возможности прототипа</summary>
            <p>
              Квадратные комнаты 2×2 м, ортогональное дерево проходов, проёмы 1.4 м, коридоры 0.4 м.
              Новая площадка 20×20 м. Один вариант за запуск.
            </p>
            <p>
              Заполнение всей площадки, циклическая генерация и пределы хода 12/20 м в этот режим не
              входят. Формы, стены и проёмы можно менять вручную в редакторе.
            </p>
          </details>
          <p className="muted">Результат откроется отдельным проектом.</p>
        </section>
        <section aria-label="Результаты генерации">
          <div role="status" aria-live="polite">
            {state.running
              ? state.progress
                ? stages[state.progress.stage]
                : 'Запускаем генерацию…'
              : state.result?.status === 'complete'
                ? 'Карта готова'
                : state.result?.status === 'interrupted'
                  ? 'Генерация прервана'
                  : state.result
                    ? 'Карта не создана. Попробуйте другой seed.'
                    : 'Выберите размер и нажмите «Сгенерировать».'}
          </div>
          {state.result?.diagnostics.map((d, i) => (
            <p key={i}>{d.message}</p>
          ))}
          {state.variants.map((v) => (
            <article className="variant-card" key={v.revisionHash}>
              <h2>{v.document.metadata.title}</h2>
              <p>Геометрия и путь от входа к выходу проверены.</p>
              <dl>
                <dt>Комнаты</dt>
                <dd>{v.document.instances.length}</dd>
                <dt>Маршрут-эталон (приближение)</dt>
                <dd>{v.metrics.routeLengthM.toFixed(1)} м</dd>
                <dt>Развилки</dt>
                <dd>{v.metrics.decisionCount}</dd>
                <dt>Seed</dt>
                <dd>{v.manifest.request.seed}</dd>
              </dl>
              <button aria-pressed={selected === v} onClick={() => setSelected(v)}>
                Посмотреть карту
              </button>
              <button className="primary" onClick={() => onChoose(v)}>
                Открыть в редакторе
              </button>
            </article>
          ))}
          {selected && (
            <section aria-label="Предпросмотр карты">
              <h2>Предпросмотр</h2>
              {previewing && <p role="status">Подготавливаем вид…</p>}
              {world && (
                <Suspense fallback={<p>Открываем вид…</p>}>
                  <WorldView key={world.revisionHash} world={world} />
                </Suspense>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
