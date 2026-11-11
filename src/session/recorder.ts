import type { ChunkInput, Sample, Session, SessionState, WalkEvent } from './types';
export interface RecordingBackend {
  append(chunk: ChunkInput): Promise<{ sequence: number }>;
  transition(state: SessionState): Promise<unknown>;
  finalize(state: 'finished' | 'stopped', lastSequence: number): Promise<unknown>;
}
export type SaveStatus = 'saved' | 'saving' | 'error';
export interface RecorderStatus {
  state: SessionState;
  save: SaveStatus;
  pendingChunks: number;
  lastCommittedSequence: number;
  elapsedMs: number;
  distanceM: number;
  error: string | null;
  unconfirmedMs: number;
}
export type Pose = Omit<Sample, 'activeTimeMs'>;
export class Recorder {
  private samples: Sample[] = [];
  private events: WalkEvent[] = [];
  private queue: ChunkInput[] = [];
  private draining = false;
  private elapsedMs: number;
  private distanceM: number;
  private committedElapsedMs: number;
  private sequence: number;
  private lastCommittedSequence: number;
  private lastSampleMs: number;
  private lastFlushMs: number;
  private pose: Pose;
  private state: SessionState;
  private save: SaveStatus = 'saved';
  private error: string | null = null;
  private waiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private terminal: 'finished' | 'stopped' | null = null;
  constructor(
    readonly session: Session,
    private readonly backend: RecordingBackend,
    initialPose: Pose,
    private readonly changed: (status: RecorderStatus) => void = () => {},
  ) {
    this.elapsedMs = session.elapsedMs;
    this.distanceM = session.distanceM;
    this.committedElapsedMs = session.elapsedMs;
    this.lastCommittedSequence = session.lastCommittedSequence;
    this.sequence = session.lastCommittedSequence + 1;
    this.lastSampleMs = session.elapsedMs;
    this.lastFlushMs = session.elapsedMs;
    this.pose = session.lastSample
      ? {
          x: session.lastSample.x,
          y: session.lastSample.y,
          z: session.lastSample.z,
          yaw: session.lastSample.yaw,
          pitch: session.lastSample.pitch,
          inputMode: session.lastSample.inputMode,
        }
      : initialPose;
    this.state = session.state;
  }
  status(): RecorderStatus {
    return {
      state: this.state,
      save: this.save,
      pendingChunks: this.queue.length,
      lastCommittedSequence: this.lastCommittedSequence,
      elapsedMs: this.elapsedMs,
      distanceM: this.distanceM,
      error: this.error,
      unconfirmedMs: Math.max(0, this.elapsedMs - this.committedElapsedMs),
    };
  }
  position(): Pose {
    return { ...this.pose };
  }
  private notify() {
    this.changed(this.status());
  }
  async start(): Promise<void> {
    if (this.terminal || this.state === 'finished' || this.state === 'stopped')
      throw new Error('Attempt already completed');
    if (this.state === 'running') return;
    if (this.save !== 'saved' || this.error)
      throw new Error('Сначала дождитесь сохранения или повторите запись.');
    await this.backend.transition('running');
    const kind = this.state === 'prepared' ? 'start' : 'resume';
    this.state = 'running';
    this.event(kind);
    this.notify();
  }
  /** Called once per physical step; distance is accumulated independently of sample frequency. */
  step(deltaMs: number, pose: Pose, distanceM: number): void {
    if (this.state !== 'running' || this.terminal || this.error) return;
    if (
      !Number.isFinite(deltaMs) ||
      deltaMs < 0 ||
      deltaMs > 100 ||
      !Number.isFinite(distanceM) ||
      distanceM < 0
    )
      throw new Error('Invalid physical step');
    this.elapsedMs += deltaMs;
    this.distanceM += distanceM;
    this.pose = { ...pose };
    if (this.elapsedMs - this.lastSampleMs >= 100 - 1e-6) this.sample();
    if (this.elapsedMs - this.lastFlushMs >= 2000 - 1e-6 || this.samples.length >= 256)
      this.flush();
  }
  contactTurn(pose: Pose): void {
    if (this.state === 'running') {
      this.pose = { ...pose };
      this.event('contact-turn');
      if (this.samples.length >= 256) this.flush();
    }
  }
  private sample(): void {
    this.samples.push({ ...this.pose, activeTimeMs: this.elapsedMs });
    this.lastSampleMs = this.elapsedMs;
  }
  private event(kind: WalkEvent['kind']): void {
    // Events own an explicit current sample even at the same time as an ordinary sample.
    if (this.samples.length >= 256) this.flush();
    this.sample();
    this.events.push({ kind, activeTimeMs: this.elapsedMs, sampleIndex: this.samples.length - 1 });
  }
  private flush(): void {
    if (this.save === 'error') return;
    if (!this.samples.length && !this.events.length) return;
    if (this.queue.length >= 5) {
      this.state = 'paused';
      this.notify();
      return;
    }
    const chunk: ChunkInput = {
      sessionId: this.session.sessionId,
      sequence: this.sequence++,
      samples: this.samples,
      events: this.events,
      elapsedMs: this.elapsedMs,
      distanceM: this.distanceM,
    };
    this.samples = [];
    this.events = [];
    this.lastFlushMs = this.elapsedMs;
    this.queue.push(chunk);
    this.save = 'saving';
    if (this.queue.length >= 5 && this.state === 'running') {
      this.state = 'paused';
      this.event('pause');
      this.error =
        'Хранилище не успевает записывать. Прохождение приостановлено; дождитесь сохранения.';
    }
    this.notify();
    void this.drain();
  }
  private async drain(): Promise<void> {
    if (this.draining || this.save === 'error') return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const chunk = this.queue[0]!;
        const receipt = await this.backend.append(chunk);
        if (receipt.sequence !== chunk.sequence)
          throw new Error('Storage acknowledged a different chunk');
        this.queue.shift();
        this.lastCommittedSequence = chunk.sequence;
        this.committedElapsedMs = chunk.elapsedMs;
        if (this.samples.length && this.state !== 'running' && this.queue.length < 5) this.flush();
        this.notify();
      }
      if (this.state === 'paused' && !this.terminal) await this.backend.transition('paused');
      this.save = 'saved';
      this.error = null;
      this.notify();
      this.waiters.splice(0).forEach((w) => w.resolve());
    } catch (error) {
      if (this.state === 'running') {
        this.state = 'paused';
        this.event('pause');
      }
      this.state = 'paused';
      this.save = 'error';
      this.error = error instanceof Error ? error.message : 'Ошибка сохранения';
      this.notify();
      this.waiters.splice(0).forEach((w) => w.reject(new Error(this.error!)));
    } finally {
      this.draining = false;
    }
  }
  private async idle(): Promise<void> {
    if (this.save === 'error') throw new Error(this.error ?? 'Ошибка сохранения');
    if (!this.queue.length && !this.draining) return;
    return new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  async checkpoint(): Promise<void> {
    if (this.save === 'error') throw new Error(this.error ?? 'Ошибка сохранения');
    this.flush();
    await this.idle();
  }
  async pause(): Promise<void> {
    if (this.state === 'finished' || this.state === 'stopped') return;
    if (this.state === 'running') {
      this.state = 'paused';
      this.event('pause');
    }
    this.notify();
    await this.checkpoint();
    try {
      await this.backend.transition('paused');
    } catch (error) {
      this.save = 'error';
      this.error = error instanceof Error ? error.message : 'Ошибка паузы';
      this.notify();
      throw error;
    }
  }
  async finish(state: 'finished' | 'stopped' = 'finished'): Promise<void> {
    if (this.state === 'finished' || this.state === 'stopped') {
      if (this.state !== state) throw new Error('Terminal state cannot be changed');
      return;
    }
    if (!this.terminal) {
      this.terminal = state;
      this.state = 'paused';
      this.event(state === 'finished' ? 'finish' : 'stop');
    }
    this.notify();
    await this.checkpoint();
    try {
      await this.backend.finalize(this.terminal, this.lastCommittedSequence);
      this.state = this.terminal;
      this.save = 'saved';
      this.notify();
    } catch (error) {
      this.save = 'error';
      this.error = error instanceof Error ? error.message : 'Ошибка завершения';
      this.notify();
      throw error;
    }
  }
  async retry(): Promise<void> {
    this.error = null;
    this.save = this.queue.length ? 'saving' : 'saved';
    void this.drain();
    await this.checkpoint();
    if (this.terminal) await this.finish(this.terminal);
    else this.notify();
  }
}
