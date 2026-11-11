export interface NativeBridge {
  begin(requestId: string, exportId: string, filename: string, expectedBytes: number): void;
  append(requestId: string, exportId: string, sequence: number, base64: string): void;
  finish(requestId: string, exportId: string): void;
  abort(requestId: string, exportId: string): void;
}
declare global {
  interface Window {
    RebootNative?: NativeBridge;
  }
}
export function nativeExportAvailable(): boolean {
  return location.origin === 'https://appassets.androidplatform.net' && !!window.RebootNative;
}
interface Receipt {
  requestId: string;
  ok: boolean;
  result: unknown;
  error: string | null;
}
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
>();
let listening = false;
function call<T>(
  invoke: (bridge: NativeBridge, requestId: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  if (!nativeExportAvailable()) return Promise.reject(new Error('Нативный экспорт недоступен'));
  if (signal?.aborted) return Promise.reject(new Error('Экспорт отменён'));
  if (pending.size >= 2)
    return Promise.reject(new Error('Сначала дождитесь подтверждения текущих частей'));
  if (!listening) {
    window.addEventListener('maze-native-receipt', (event) => {
      const receipt = (event as CustomEvent<Receipt>).detail;
      if (!receipt || typeof receipt.requestId !== 'string' || typeof receipt.ok !== 'boolean')
        return;
      const waiter = pending.get(receipt.requestId);
      if (!waiter) return;
      pending.delete(receipt.requestId);
      waiter.cleanup();
      if (receipt.ok) waiter.resolve(receipt.result);
      else waiter.reject(new Error(receipt.error ?? 'Ошибка записи файла'));
    });
    listening = true;
  }
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const abort = () => fail('Экспорт отменён');
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (message: string) => {
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      cleanup();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Нет подтверждения записи файла. Повторите экспорт.'),
      15_000,
    );
    pending.set(requestId, { resolve: (value) => resolve(value as T), reject, cleanup });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      invoke(window.RebootNative!, requestId);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Ошибка native bridge');
    }
  });
}
export interface NativeChunk {
  sequence: number;
  base64: string;
  bytes: number;
  last: boolean;
}
export async function shareNativePacket(
  packet: { exportId: string; number: number; filename: string; bytes: number },
  read: (sequence: number) => Promise<NativeChunk>,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<void> {
  const exportId = `${packet.exportId}-${packet.number}`;
  try {
    const begun = await call<{ sequence: number }>(
      (bridge, id) => bridge.begin(id, exportId, packet.filename, packet.bytes),
      signal,
    );
    if (begun.sequence !== 0) throw new Error('Экспорт с таким ID уже начат. Повторите выбор.');
    let sequence = 0,
      bytes = 0;
    while (bytes < packet.bytes) {
      if (signal.aborted) throw new Error('Экспорт отменён');
      const chunk = await read(sequence);
      if (
        chunk.sequence !== sequence ||
        chunk.base64.length > 256 * 1024 ||
        chunk.bytes <= 0 ||
        chunk.bytes > 192 * 1024 ||
        bytes + chunk.bytes > packet.bytes
      )
        throw new Error('Повреждённая часть экспорта');
      const ack = await call<{ sequence: number }>(
        (bridge, id) => bridge.append(id, exportId, sequence, chunk.base64),
        signal,
      );
      if (ack.sequence !== sequence) throw new Error('Подтверждён другой номер части');
      bytes += chunk.bytes;
      sequence++;
      progress(bytes);
      if (chunk.last !== (bytes === packet.bytes)) throw new Error('Неверная граница пакета');
    }
    const final = await call<{ prepared: boolean; bytes: number }>(
      (bridge, id) => bridge.finish(id, exportId),
      signal,
    );
    if (!final.prepared || final.bytes !== packet.bytes)
      throw new Error('Размер записанного файла не совпадает');
  } catch (error) {
    await call((bridge, id) => bridge.abort(id, exportId)).catch(() => {});
    throw error;
  }
}
