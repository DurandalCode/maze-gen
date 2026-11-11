import { canonical } from '../domain';
import { makeChunk, parseChunk, parseCondition } from '../session/format';
import type { ChunkInput, Condition, Session, SessionState, WalkChunk } from '../session/types';
import { request, StorageError, transaction } from './schema';
import type { StoredMap, WalkSummary } from './types';
const terminal = (state: SessionState) => state === 'finished' || state === 'stopped';
export class SessionRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly ranges: typeof IDBKeyRange,
  ) {}
  private summary(session: Session, previous?: WalkSummary): WalkSummary {
    return {
      sessionId: session.sessionId,
      mapHash: session.mapHash,
      title: previous?.title ?? 'Прохождение',
      titleNormalized: previous?.titleNormalized ?? 'прохождение',
      status: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      elapsedMs: session.elapsedMs,
      distanceM: session.distanceM,
      lastCommittedSequence: session.lastCommittedSequence,
    };
  }
  async create(
    sessionId: string,
    mapHash: string,
    value: Condition,
    now = Date.now(),
  ): Promise<Session> {
    const condition = parseCondition(value);
    if (!sessionId || sessionId.length > 128 || !Number.isSafeInteger(now))
      throw new StorageError('INVALID_SESSION', 'Invalid session ID/time');
    return transaction(
      this.database,
      ['maps', 'sessions', 'walkSummaries'],
      'readwrite',
      async (tx) => {
        const map = (await request(tx.objectStore('maps').get(mapHash))) as StoredMap | undefined;
        if (!map?.validationSummary.ready)
          throw new StorageError('MAP_NOT_SAVED', 'Сначала сохраните проверенную карту.');
        const existing = (await request(tx.objectStore('sessions').get(sessionId))) as
          | Session
          | undefined;
        if (existing) {
          if (
            existing.mapHash !== mapHash ||
            canonical(existing.condition) !== canonical(condition)
          )
            throw new StorageError('CONFLICT', 'Session ID already contains a different attempt');
          return existing;
        }
        const session: Session = {
          sessionId,
          mapHash,
          condition,
          state: 'prepared',
          elapsedMs: 0,
          distanceM: 0,
          lastCommittedSequence: -1,
          lastSample: null,
          createdAt: now,
          updatedAt: now,
        };
        tx.objectStore('sessions').add(session);
        tx.objectStore('walkSummaries').add(this.summary(session));
        return session;
      },
    );
  }
  async get(sessionId: string): Promise<Session> {
    return transaction(this.database, ['sessions'], 'readonly', async (tx) => {
      const s = (await request(tx.objectStore('sessions').get(sessionId))) as Session | undefined;
      if (!s) throw new StorageError('NOT_FOUND', 'Прохождение не найдено.');
      parseCondition(s.condition);
      return s;
    });
  }
  async transition(
    sessionId: string,
    state: SessionState,
    now = Date.now(),
    expectedSequence?: number,
  ): Promise<Session> {
    const allowed: Record<SessionState, SessionState[]> = {
      prepared: ['running', 'stopped'],
      running: ['paused', 'finished', 'stopped'],
      paused: ['running', 'finished', 'stopped'],
      interrupted: ['running', 'finished', 'stopped'],
      finished: [],
      stopped: [],
    };
    return transaction(this.database, ['sessions', 'walkSummaries'], 'readwrite', async (tx) => {
      const s = (await request(tx.objectStore('sessions').get(sessionId))) as Session | undefined;
      if (!s) throw new StorageError('NOT_FOUND', 'Прохождение не найдено.');
      if (expectedSequence !== undefined && expectedSequence !== s.lastCommittedSequence)
        throw new StorageError('SEQUENCE_GAP', 'Последняя часть записи ещё не подтверждена.');
      if (s.state === state) return s;
      if (!allowed[s.state].includes(state))
        throw new StorageError('SESSION_STATE', `Недопустимый переход ${s.state} → ${state}`);
      const updated = { ...s, state, updatedAt: now };
      const previous = (await request(tx.objectStore('walkSummaries').get(sessionId))) as
        | WalkSummary
        | undefined;
      tx.objectStore('sessions').put(updated);
      tx.objectStore('walkSummaries').put(this.summary(updated, previous));
      return updated;
    });
  }
  async append(
    value: ChunkInput | WalkChunk,
    now = Date.now(),
  ): Promise<{ duplicate: boolean; sequence: number; session: Session }> {
    // All hashing/validation is complete before opening the write transaction.
    const chunk = 'contentHash' in value ? parseChunk(value) : makeChunk(value);
    return transaction(
      this.database,
      ['sessions', 'walkSummaries', 'walkChunks'],
      'readwrite',
      async (tx) => {
        const s = (await request(tx.objectStore('sessions').get(chunk.sessionId))) as
          | Session
          | undefined;
        if (!s) throw new StorageError('NOT_FOUND', 'Прохождение не найдено.');
        const previous = (await request(
          tx.objectStore('walkChunks').get([chunk.sessionId, chunk.sequence]),
        )) as WalkChunk | undefined;
        if (previous) {
          if (previous.contentHash !== chunk.contentHash)
            throw new StorageError('CONFLICT', 'Номер части уже содержит другую запись.');
          return { duplicate: true, sequence: chunk.sequence, session: s };
        }
        if (terminal(s.state))
          throw new StorageError(
            'SESSION_TERMINAL',
            'Завершённая запись не изменяется поздним checkpoint.',
          );
        if (s.state === 'prepared')
          throw new StorageError('SESSION_STATE', 'Прохождение ещё не начато.');
        if (chunk.sequence !== s.lastCommittedSequence + 1)
          throw new StorageError('SEQUENCE_GAP', `Ожидалась часть ${s.lastCommittedSequence + 1}`);
        if (
          chunk.elapsedMs < s.elapsedMs ||
          chunk.distanceM < s.distanceM ||
          (chunk.samples[0] &&
            s.lastSample &&
            chunk.samples[0].activeTimeMs < s.lastSample.activeTimeMs)
        )
          throw new StorageError('TIME_ORDER', 'Время и дистанция не могут уменьшаться.');
        const session = {
          ...s,
          elapsedMs: chunk.elapsedMs,
          distanceM: chunk.distanceM,
          lastCommittedSequence: chunk.sequence,
          lastSample: chunk.samples[chunk.samples.length - 1] ?? s.lastSample,
          updatedAt: now,
        };
        const summary = (await request(tx.objectStore('walkSummaries').get(s.sessionId))) as
          | WalkSummary
          | undefined;
        tx.objectStore('walkChunks').add(chunk);
        tx.objectStore('sessions').put(session);
        tx.objectStore('walkSummaries').put(this.summary(session, summary));
        return { duplicate: false, sequence: chunk.sequence, session };
      },
    );
  }
  async finalize(
    sessionId: string,
    state: 'finished' | 'stopped',
    lastSequence: number,
    now = Date.now(),
  ): Promise<Session> {
    return this.transition(sessionId, state, now, lastSequence);
  }
  async chunk(sessionId: string, sequence: number): Promise<WalkChunk> {
    const value = await transaction(
      this.database,
      ['walkChunks'],
      'readonly',
      async (tx) =>
        (await request(tx.objectStore('walkChunks').get([sessionId, sequence]))) as
          | WalkChunk
          | undefined,
    );
    if (!value) throw new StorageError('MISSING_CHUNK', `Отсутствует часть ${sequence}`);
    return parseChunk(value);
  }
  async *chunks(sessionId: string): AsyncGenerator<WalkChunk> {
    const session = await this.get(sessionId);
    for (let sequence = 0; sequence <= session.lastCommittedSequence; sequence++)
      yield await this.chunk(sessionId, sequence);
  }
  async recover(now = Date.now()): Promise<Session[]> {
    return transaction(this.database, ['sessions', 'walkSummaries'], 'readwrite', async (tx) => {
      const sessions = (await request(tx.objectStore('sessions').getAll())) as Session[],
        recovered: Session[] = [];
      for (const session of sessions) {
        if (terminal(session.state)) continue;
        const updated: Session = { ...session, state: 'interrupted', updatedAt: now };
        const summary = (await request(tx.objectStore('walkSummaries').get(session.sessionId))) as
          | WalkSummary
          | undefined;
        tx.objectStore('sessions').put(updated);
        tx.objectStore('walkSummaries').put(this.summary(updated, summary));
        recovered.push(updated);
      }
      return recovered;
    });
  }
}
