import { useEffect, useState } from 'react';
import type { MapSummary } from '../repository/types';
import type { MapRevision } from '../domain';
import type { PreparedWorld } from '../jobs/compute';
import { fetchRouteFile, validRouteId } from '../platform/server-routes';
import { message, prepare, store, revision } from './services';
export function ServerRouteView({
  id,
  onReady,
  onClose,
}: {
  id: string;
  onReady: (value: { world: PreparedWorld; map: MapRevision; summary: MapSummary | null }) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState('Загружаем JSON маршрута…'),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(),
      live = () => !controller.signal.aborted;
    setError('');
    setStatus('Загружаем JSON маршрута…');
    void (async () => {
      if (!validRouteId(id)) throw new Error('Неверная ссылка на маршрут.');
      const file = await fetchRouteFile(`${id}.json`, controller.signal);
      if (!live()) return;
      const map = await store<MapRevision>('get', { kind: 'route-file', file });
      if (!live()) return;
      setStatus('Проверяем геометрию и путь к выходу…');
      const world = await prepare(map.document, controller.signal);
      if (!live()) return;
      if (world.revisionHash !== map.revisionHash)
        throw new Error('JSON не соответствует ревизии маршрута.');
      const existing = await store<MapRevision | null>('get', {
        kind: 'map-if-present',
        hash: map.revisionHash,
      });
      if (!live()) return;
      if (!existing) {
        setStatus('Сохраняем карту в этом браузере…');
        await store('save', {
          revision: {
            ...revision(world),
            ...(map.generationOrigin ? { generationOrigin: map.generationOrigin } : {}),
          },
          projectId: `route-${id}-${map.revisionHash.slice(0, 24)}`,
          title: map.document.metadata.title,
          expectedBaseRevisionHash: null,
        });
      }
      if (!live()) return;
      const summary = await store<MapSummary | null>('get', {
        kind: 'map-summary',
        hash: map.revisionHash,
      });
      if (live()) onReady({ world, map, summary });
    })().catch((e) => {
      if (live()) setError(message(e));
    });
    return () => controller.abort();
  }, [id, retry]);
  return (
    <main>
      <h1>Открываем маршрут</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => setRetry((n) => n + 1)}>Повторить загрузку маршрута</button>
        </>
      ) : (
        <p role="status">{status}</p>
      )}
      <button onClick={onClose}>В библиотеку</button>
    </main>
  );
}
