import { generate } from '../generation/generate';
import { normalizeRequest, requestHash } from '../generation/request';
import type { GenerationVariant } from '../generation/types';
import { isJobRequest, response } from './protocol';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = async (event) => {
  if (!isJobRequest(event.data) || event.data.operation !== 'generate') return;
  const job = event.data;
  const input = job.input as { request?: unknown; startVariantIndex?: number } | null;
  const completed: GenerationVariant[] = [];
  const started = performance.now();
  let nextVariantIndex = input?.startVariantIndex ?? 0,
    lastProgress = -Infinity;
  try {
    let request;
    try {
      request = normalizeRequest(input?.request);
    } catch {
      // The pure parser returns the precise public diagnostic, with no host exception details.
      const parsed = generate(input?.request).next();
      scope.postMessage(response(job, 'result', parsed.value));
      return;
    }
    const search = generate(request, nextVariantIndex);
    while (true) {
      if (performance.now() - started >= request.budgets.watchdogMs) {
        scope.postMessage(
          response(job, 'result', {
            status: 'interrupted',
            requestHash: requestHash(request),
            variants: completed,
            diagnostics: [
              {
                code: 'TIMEOUT',
                path: 'generation',
                message:
                  'Истекло время ожидания. Завершённые варианты сохранены; незавершённый можно повторить.',
              },
            ],
            nextVariantIndex,
          }),
        );
        search.return({
          status: 'interrupted',
          requestHash: '',
          variants: [],
          diagnostics: [],
          nextVariantIndex,
        });
        return;
      }
      const step = search.next();
      if (step.done) {
        scope.postMessage(response(job, 'result', step.value));
        return;
      }
      const progress = step.value;
      nextVariantIndex = progress.variantIndex;
      if (progress.variant) {
        completed.push(progress.variant);
        nextVariantIndex = progress.variantIndex + 1;
      }
      if (progress.variant && performance.now() - lastProgress < 200)
        await new Promise((resolve) =>
          setTimeout(resolve, 200 - (performance.now() - lastProgress)),
        );
      const now = performance.now();
      if (progress.variant || now - lastProgress >= 200) {
        scope.postMessage(response(job, 'progress', { ...progress, elapsedMs: now - started }));
        lastProgress = now;
      }
      // Browser task boundary: cancellation is also guaranteed by host terminate/recreate.
      if (now - lastProgress < 2 || progress.variant)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch {
    scope.postMessage(
      response(job, 'result', {
        status: 'failed',
        requestHash: completed[0]?.manifest.requestHash ?? '',
        variants: completed,
        diagnostics: [
          {
            code: 'INTERNAL_ERROR',
            path: 'generation',
            message: 'Внутренняя ошибка поиска. Повторите запрос; завершённые варианты сохранены.',
          },
        ],
        nextVariantIndex,
      }),
    );
  }
};
