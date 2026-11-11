import type { JobRequest } from '../jobs/protocol';
import { decodeStorage, encodeStorage } from '../platform/storage-wire';
import { StorageError } from './schema';
const endpoint = '/__maze/library',
  clientId = crypto.randomUUID();
let configuration: Promise<{ enabled: boolean; libraryId?: string }> | null = null;
export function sharedConfiguration() {
  return (configuration ??= (async () => {
    if (!import.meta.env.DEV) return { enabled: false };
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
      throw new StorageError(
        'SHARED_UNAVAILABLE',
        'Общая библиотека недоступна. Перезапустите dev-сервер.',
      );
    const value = await response.json();
    if (typeof value.enabled !== 'boolean')
      throw new StorageError('SHARED_UNAVAILABLE', 'Неверный ответ сервера библиотеки.');
    return value as { enabled: boolean; libraryId?: string };
  })().catch((e) => {
    configuration = null;
    throw e;
  }));
}
export async function sharedDispatch(request: JobRequest, signal: AbortSignal): Promise<unknown> {
  const cancel = () => {
    void fetch(endpoint + '/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, jobId: request.jobId }),
    }).catch(() => {});
  };
  if (request.operation === 'import') signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        request: { ...request, input: await encodeStorage(request.input) },
      }),
      ...(request.operation === 'import' ? {} : { signal }),
    });
    const value = await response.json();
    if (!value.ok)
      throw new StorageError(
        value.error?.code ?? 'SHARED_STORAGE_ERROR',
        value.error?.message ?? 'Ошибка общей библиотеки.',
      );
    return decodeStorage(value.result);
  } catch (e) {
    if (e instanceof StorageError || (e instanceof DOMException && e.name === 'AbortError'))
      throw e;
    throw new StorageError(
      'SHARED_UNAVAILABLE',
      'Нет связи с общей библиотекой. Повторите сохранение после восстановления сервера.',
    );
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
