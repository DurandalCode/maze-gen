import { compute } from './compute';
import { isJobRequest, response } from './protocol';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = (event) => {
  if (!isJobRequest(event.data)) return;
  const request = event.data;
  let lastProgress = -Infinity;
  try {
    const result = compute(request, (message) => {
      const now = performance.now();
      if (now - lastProgress >= 200) {
        scope.postMessage(message);
        lastProgress = now;
      }
    });
    scope.postMessage(result.message, result.transfer);
  } catch {
    scope.postMessage(
      response(request, 'error', {
        code: 'INTERNAL_ERROR',
        message: 'Не удалось подготовить карту. Можно повторить.',
      }),
    );
  }
};
