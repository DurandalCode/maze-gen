import { expect, test } from 'bun:test';
import { defaultEnvironment, documentHashes, VERSIONS } from '../../src/domain';
import { makeChunk, makeCondition } from '../../src/session/format';
import { Recorder } from '../../src/session/recorder';
import type { RecordingBackend } from '../../src/session/recorder';
import type { ChunkInput, Session } from '../../src/session/types';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { MazeRepository } from '../../src/repository/repository';
import { twoRooms } from '../helpers/maps';
const condition = () =>
  makeCondition({
    environment: defaultEnvironment(),
    previewed: false,
    inputMode: 'keyboard',
    speedMps: 2.8,
    goalDirectionKnown: false,
    siteKnown: false,
    observationProfile: 'physical-v1',
  });
const session = (): Session => ({
  sessionId: 'walk',
  mapHash: 'a'.repeat(64),
  condition: condition(),
  state: 'prepared',
  elapsedMs: 0,
  distanceM: 0,
  lastCommittedSequence: -1,
  lastSample: null,
  createdAt: 0,
  updatedAt: 0,
});
const pose = { x: 10, y: 0, z: 10, yaw: 0, pitch: 0, inputMode: 'keyboard' as const };
function backend() {
  const chunks: ChunkInput[] = [],
    states: string[] = [],
    finals: { state: string; sequence: number }[] = [];
  return {
    chunks,
    states,
    finals,
    backend: {
      append: async (chunk: ChunkInput) => {
        chunks.push(chunk);
        return { sequence: chunk.sequence };
      },
      transition: async (state) => {
        states.push(state);
      },
      finalize: async (state, sequence) => {
        finals.push({ state, sequence });
      },
    } satisfies RecordingBackend,
  };
}
async function steps(recorder: Recorder, count: number) {
  for (let i = 0; i < count; i++) {
    recorder.step(1000 / 60, { ...pose, z: 10 + (i * 1.4) / 60 }, 1.4 / 60);
    await Promise.resolve();
  }
}
async function repository() {
  const repo = await MazeRepository.open({ factory: new IDBFactory(), ranges: IDBKeyRange }),
    document = twoRooms(),
    hash = documentHashes(document).revisionHash;
  await repo.saveMap(
    {
      document,
      revisionHash: hash,
      versions: { ...VERSIONS },
      validationSummary: { ready: true, diagnostics: [] },
    },
    'project',
    'Карта',
    1,
  );
  return { repo, hash };
}

test('REC-01: distance uses each physics step; 10 Hz sampling, pause time, and terminal commit are independent', async () => {
  const b = backend(),
    recorder = new Recorder(session(), b.backend, pose);
  await recorder.start();
  await steps(recorder, 600);
  await recorder.pause();
  const elapsed = recorder.status().elapsedMs;
  await steps(recorder, 600);
  expect(recorder.status().elapsedMs).toBe(elapsed);
  await recorder.start();
  await steps(recorder, 60);
  await recorder.finish();
  expect(recorder.status().distanceM).toBeCloseTo(15.4, 6);
  expect(recorder.status().elapsedMs).toBeCloseTo(11000, 5);
  expect(recorder.status().save).toBe('saved');
  expect(recorder.status().state).toBe('finished');
  expect(b.chunks.every((c) => c.samples.length <= 256)).toBe(true);
  expect(b.chunks.flatMap((c) => c.samples).length).toBeLessThan(120);
  expect(b.chunks.map((c) => c.sequence)).toEqual(b.chunks.map((_, i) => i));
  expect(b.finals[0]!.sequence).toBe(b.chunks.length - 1);
});
test('backpressure pauses at five pending chunks and never accumulates unbounded samples', async () => {
  const b = backend();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  const append = b.backend.append;
  b.backend.append = async (chunk) => {
    if (first) {
      first = false;
      await blocked;
    }
    return append(chunk);
  };
  const recorder = new Recorder(session(), b.backend, pose);
  await recorder.start();
  await steps(recorder, 1200);
  expect(recorder.status().pendingChunks).toBe(5);
  expect(recorder.status().state).toBe('paused');
  const elapsed = recorder.status().elapsedMs;
  await steps(recorder, 1200);
  expect(recorder.status().elapsedMs).toBe(elapsed);
  expect(recorder.status().pendingChunks).toBe(5);
  release();
  await recorder.checkpoint();
  expect(recorder.status().save).toBe('saved');
  expect(b.chunks.every((c) => c.samples.length <= 256)).toBe(true);
  expect(b.states).toContain('paused');
});
test('failed flush retains sequence/body for idempotent retry; finalization error can retry without rewriting chunks', async () => {
  const b = backend();
  let fail = true,
    finalFail = true;
  const append = b.backend.append,
    finalize = b.backend.finalize;
  b.backend.append = async (chunk) => {
    if (fail) {
      fail = false;
      throw new Error('quota');
    }
    return append(chunk);
  };
  b.backend.finalize = async (state, sequence) => {
    if (finalFail) {
      finalFail = false;
      throw new Error('finish failure');
    }
    return finalize(state, sequence);
  };
  const recorder = new Recorder(session(), b.backend, pose);
  await recorder.start();
  await steps(recorder, 121);
  await expect(recorder.checkpoint()).rejects.toThrow('quota');
  expect(recorder.status().state).toBe('paused');
  expect(recorder.status().save).toBe('error');
  await recorder.retry();
  expect(b.chunks[0]!.sequence).toBe(0);
  await expect(recorder.finish()).rejects.toThrow('finish failure');
  const count = b.chunks.length;
  await recorder.retry();
  expect(recorder.status().state).toBe('finished');
  expect(b.chunks).toHaveLength(count);
});
test('hour-long synthetic recording is chunked and distance is not reconstructed from samples', async () => {
  const b = backend(),
    recorder = new Recorder(session(), b.backend, pose);
  await recorder.start();
  await steps(recorder, 216000);
  await recorder.finish();
  expect(recorder.status().elapsedMs).toBeCloseTo(3_600_000, 2);
  expect(recorder.status().distanceM).toBeCloseTo(5040, 4);
  expect(b.chunks.length).toBeGreaterThanOrEqual(1800);
  expect(b.chunks.length).toBeLessThanOrEqual(1801);
  expect(b.chunks.every((c) => c.samples.length <= 256)).toBe(true);
  expect(recorder.status().pendingChunks).toBe(0);
});
test('prepared session requires a saved ready map; append/finalize are atomic and idempotent', async () => {
  const { repo, hash } = await repository();
  await expect(
    repo.sessions.create('missing', 'f'.repeat(64), condition(), 2),
  ).rejects.toMatchObject({ code: 'MAP_NOT_SAVED' });
  const s = await repo.sessions.create('walk', hash, condition(), 2);
  expect(s.state).toBe('prepared');
  await repo.sessions.transition('walk', 'running', 3);
  const chunk = makeChunk({
    sessionId: 'walk',
    sequence: 0,
    samples: [{ ...pose, activeTimeMs: 100 }],
    events: [],
    elapsedMs: 100,
    distanceM: 0.14,
  });
  expect((await repo.sessions.append(chunk, 4)).duplicate).toBe(false);
  expect((await repo.sessions.append(chunk, 5)).duplicate).toBe(true);
  const different = makeChunk({
    sessionId: 'walk',
    sequence: 0,
    samples: chunk.samples,
    events: [],
    elapsedMs: 100,
    distanceM: 1,
  });
  await expect(repo.sessions.append(different, 6)).rejects.toMatchObject({ code: 'CONFLICT' });
  const gap = makeChunk({
    sessionId: 'walk',
    sequence: 2,
    samples: [],
    events: [],
    elapsedMs: 200,
    distanceM: 1,
  });
  await expect(repo.sessions.append(gap)).rejects.toMatchObject({ code: 'SEQUENCE_GAP' });
  await repo.sessions.finalize('walk', 'finished', 0, 7);
  expect((await repo.sessions.append(chunk, 8)).duplicate).toBe(true);
  const late = makeChunk({
    sessionId: 'walk',
    sequence: 1,
    samples: [],
    events: [],
    elapsedMs: 200,
    distanceM: 1,
  });
  await expect(repo.sessions.append(late)).rejects.toMatchObject({ code: 'SESSION_TERMINAL' });
  expect((await repo.sessions.get('walk')).state).toBe('finished');
  repo.close();
});
test('REC-03: recovery resumes only confirmed checkpoint; project deletion retains attempts', async () => {
  const { repo, hash } = await repository();
  await repo.sessions.create('walk', hash, condition(), 2);
  await repo.sessions.transition('walk', 'running', 3);
  const chunk = makeChunk({
    sessionId: 'walk',
    sequence: 0,
    samples: [{ ...pose, activeTimeMs: 2000 }],
    events: [],
    elapsedMs: 2000,
    distanceM: 2.8,
  });
  await repo.sessions.append(chunk, 4);
  const recovered = await repo.sessions.recover(5);
  expect(recovered[0]!.state).toBe('interrupted');
  expect(recovered[0]!.lastSample).toEqual(chunk.samples[0]!);
  const r = new Recorder(recovered[0]!, backend().backend, { ...pose, x: 99 });
  expect(r.position().x).toBe(10);
  expect(r.status().elapsedMs).toBe(2000);
  expect(r.status().lastCommittedSequence).toBe(0);
  await repo.deleteProject('project');
  expect((await repo.getMap(hash)).revisionHash).toBe(hash);
  expect((await repo.listWalks()).items).toHaveLength(1);
  await repo.deleteWalk('walk');
  await expect(repo.getMap(hash)).rejects.toThrow('не найдена');
  repo.close();
});

test('lifecycle pause preserves prepared state and wins a pending start acknowledgement', async () => {
  const b = backend();
  const recorder = new Recorder(session(), b.backend, pose);
  await recorder.pause();
  expect(recorder.status().state).toBe('prepared');
  expect(b.states).toEqual([]);
  let release!: () => void;
  b.backend.transition = async (state) => {
    b.states.push(state);
    if (state === 'running')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  const first = recorder.start();
  const same = recorder.start();
  await recorder.pause();
  release();
  await Promise.all([first, same]);
  expect(recorder.status().state).toBe('paused');
  expect(b.states).toEqual(['running', 'paused', 'paused']);
  const before = recorder.status().elapsedMs;
  recorder.step(1000 / 60, pose, 1);
  expect(recorder.status().elapsedMs).toBe(before);
});

test('fixed-step event and chunk times use the same grid at every step boundary', () => {
  let elapsedMs = 0;
  for (let step = 0; step < 600; step++) {
    elapsedMs += 1000 / 60;
    const chunk = makeChunk({
      sessionId: 'walk',
      sequence: step,
      elapsedMs,
      distanceM: 0,
      samples: [{ ...pose, activeTimeMs: elapsedMs }],
      events: [{ activeTimeMs: elapsedMs, kind: 'pause', sampleIndex: 0 }],
    });
    expect(chunk.events[0]!.activeTimeMs).toBe(chunk.elapsedMs);
  }
  expect(() =>
    makeChunk({
      sessionId: 'walk',
      sequence: 0,
      elapsedMs: 1,
      distanceM: 0,
      samples: [{ ...pose, activeTimeMs: 0 }],
      events: [{ activeTimeMs: 1, kind: 'pause', sampleIndex: 0 }],
    }),
  ).toThrow('Event time');
});
