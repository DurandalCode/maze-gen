export interface ServerRoute {
  id: string;
  title: string;
}
export const validRouteId = (value: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
/** Static JSON is served by Vite public/ in dev and copied unchanged into dist. */
export async function fetchRouteFile(
  path: string,
  signal: AbortSignal,
  maxBytes = 32 * 1024 * 1024,
): Promise<Blob> {
  const response = await fetch(new URL(`routes/${path}`, document.baseURI), {
    signal,
    cache: 'no-cache',
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'Маршрут не найден на сервере.'
        : `Не удалось загрузить маршрут (HTTP ${response.status}).`,
    );
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Сервер не вернул JSON маршрута. Проверьте файл в public/routes/.');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new Error('JSON маршрута слишком большой.');
  if (!response.body) throw new Error('Сервер вернул пустой ответ.');
  const reader = response.body.getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error('JSON маршрута слишком большой.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return new Blob(chunks, { type: 'application/json' });
}
export async function fetchServerRoutes(signal: AbortSignal): Promise<ServerRoute[]> {
  const file = await fetchRouteFile('index.json', signal, 64 * 1024),
    o = JSON.parse(await file.text());
  if (
    !o ||
    o.kind !== 'maze-server-routes' ||
    o.schemaVersion !== 1 ||
    !Array.isArray(o.routes) ||
    o.routes.length > 32
  )
    throw new Error('Неверный каталог серверных маршрутов.');
  const ids = new Set<string>();
  return o.routes.map((r: ServerRoute) => {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !validRouteId(r.id) ||
      ids.has(r.id) ||
      typeof r.title !== 'string' ||
      !r.title.length ||
      r.title.length > 256
    )
      throw new Error('Неверная запись каталога маршрутов.');
    ids.add(r.id);
    return { id: r.id, title: r.title };
  });
}
