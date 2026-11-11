import { normalizeRequest, requestHash } from '../generation/request';
import type { GenerationRequest } from '../generation/request';
import type { GenerationProgress, GenerationResult, GenerationVariant } from '../generation/types';
import type { JobHandle, JobManager } from './manager';

export interface SearchState {
  running: boolean;
  request: GenerationRequest | null;
  progress: (GenerationProgress & { elapsedMs?: number }) | null;
  result: GenerationResult | null;
  variants: GenerationVariant[];
}
const initial = (): SearchState => ({
  running: false,
  request: null,
  progress: null,
  result: null,
  variants: [],
});
/** A separate worker lane: generation never supersedes editor preparation or recording. */
export class GenerationSearch {
  private state = initial();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private activeStart = 0;
  private active: JobHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private jobs: JobManager) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: SearchState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  start(value: unknown) {
    const request = normalizeRequest(value); // Invalid input preserves existing variants and project.
    this.stopActive();
    this.publish({ ...initial(), request });
    this.launch(request, 0);
  }
  resume(watchdogMs: number) {
    if (this.state.running || !this.state.request || this.state.result?.status !== 'interrupted')
      return;
    const request = normalizeRequest({
      ...this.state.request,
      budgets: { ...this.state.request.budgets, watchdogMs },
    });
    if (watchdogMs <= this.state.request.budgets.watchdogMs)
      throw new Error('Для продолжения увеличьте время ожидания.');
    this.launch(request, this.state.result.nextVariantIndex);
  }
  private accept(variant: GenerationVariant) {
    if (!this.state.request || variant.manifest.requestHash !== requestHash(this.state.request))
      return;
    if (
      this.state.variants.some(
        (v) =>
          v.manifest.variantIndex === variant.manifest.variantIndex ||
          v.diversityHash === variant.diversityHash,
      )
    )
      return;
    this.state = {
      ...this.state,
      variants: [...this.state.variants, variant].sort(
        (a, b) => a.manifest.variantIndex - b.manifest.variantIndex,
      ),
    };
  }
  private launch(request: GenerationRequest, startVariantIndex: number) {
    const epoch = ++this.epoch;
    this.activeStart = startVariantIndex;
    this.publish({ ...this.state, running: true, request, result: null, progress: null });
    const handle = this.jobs.submit(
      'generation-search',
      null,
      'generate',
      { request, startVariantIndex },
      {
        progress: (value) => {
          if (this.epoch !== epoch) return;
          const progress = value as GenerationProgress & { elapsedMs?: number };
          if (progress.variant) this.accept(progress.variant);
          this.publish({ ...this.state, progress });
        },
      },
    );
    this.active = handle;
    // Also interrupts an indivisible library call during final validation. Never relies on worker timers.
    this.timer = setTimeout(() => this.interrupt('TIMEOUT'), request.budgets.watchdogMs);
    void handle.result.then((outcome) => {
      if (this.epoch !== epoch) return;
      this.clearTimer();
      this.active = null;
      if (outcome.state === 'completed') {
        const result = outcome.payload as GenerationResult;
        for (const variant of result.variants) this.accept(variant);
        const complete =
          this.state.variants.length === request.requestedVariants &&
          this.state.variants.every((v) => v.status === 'ready');
        this.publish({
          ...this.state,
          running: false,
          result: {
            ...result,
            status: complete
              ? 'complete'
              : result.status === 'complete'
                ? 'exhausted'
                : result.status,
            variants: this.state.variants,
          },
        });
      } else
        this.publish({
          ...this.state,
          running: false,
          result: {
            status: 'failed',
            requestHash: requestHash(request),
            variants: this.state.variants,
            diagnostics: [
              {
                code: 'WORKER_CRASH',
                path: 'generation',
                message: 'Поиск прервался из-за ошибки worker. Завершённые варианты сохранены.',
              },
            ],
            nextVariantIndex: this.state.progress?.variantIndex ?? startVariantIndex,
          },
        });
    });
  }
  cancel = () => this.interrupt('CANCELLED');
  private interrupt(code: 'TIMEOUT' | 'CANCELLED') {
    if (!this.state.running || !this.state.request) return;
    const progress = this.state.progress,
      nextVariantIndex = progress?.variant
        ? progress.variantIndex + 1
        : (progress?.variantIndex ?? this.activeStart);
    this.stopActive();
    this.publish({
      ...this.state,
      running: false,
      result: {
        status: 'interrupted',
        requestHash: requestHash(this.state.request),
        variants: this.state.variants,
        diagnostics: [
          {
            code,
            path: 'generation',
            message:
              code === 'TIMEOUT'
                ? 'Истекло время ожидания. Завершённые варианты сохранены.'
                : 'Поиск отменён. Завершённые варианты сохранены.',
          },
        ],
        nextVariantIndex,
      },
    });
  }
  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private stopActive() {
    this.epoch++;
    this.clearTimer();
    this.active?.cancel();
    this.active = null;
  }
  dispose() {
    this.stopActive();
    this.jobs.dispose();
    this.listeners.clear();
  }
}
