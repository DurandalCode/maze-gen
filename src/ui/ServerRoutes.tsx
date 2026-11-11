import { useEffect, useState } from 'react';
import { fetchServerRoutes } from '../platform/server-routes';
import type { ServerRoute } from '../platform/server-routes';
export function ServerRoutes() {
  const [routes, setRoutes] = useState<ServerRoute[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetchServerRoutes(controller.signal)
      .then(setRoutes)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог маршрутов.');
      });
    return () => controller.abort();
  }, []);
  if (!routes.length && !error) return null;
  return (
    <section aria-label="Маршруты сервера">
      <h2>Готовые маршруты</h2>
      <p>Эти карты доступны в любом браузере по прямой ссылке.</p>
      {error && <p>{error}</p>}
      {routes.map((r) => (
        <article className="card" key={r.id}>
          <h3>{r.title}</h3>
          <a className="download" href={`?route=${encodeURIComponent(r.id)}`}>
            Открыть маршрут
          </a>
        </article>
      ))}
    </section>
  );
}
