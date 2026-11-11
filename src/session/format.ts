import { conditionHash, hashValue, normalizeEnvironment, number } from '../domain';
import { fail } from '../domain/validate';
import type { ChunkInput, Condition, Sample, WalkChunk, WalkEvent } from './types';
function object(value: unknown, path: string, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('SCHEMA', path, 'Expected object');
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) if (!fields.includes(key)) fail('UNKNOWN_FIELD', path, key);
  return o;
}
function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.length > 128)
    fail('SCHEMA', path, 'Expected ID');
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('SCHEMA', path, 'Expected boolean');
  return value;
}
function inputMode(value: unknown): Sample['inputMode'] {
  if (value !== 'keyboard' && value !== 'touch')
    fail('SCHEMA', 'inputMode', 'Expected keyboard/touch');
  return value;
}
export function makeCondition(value: Omit<Condition, 'id'>): Condition {
  const o = object(value, 'condition', [
    'environment',
    'previewed',
    'inputMode',
    'speedMps',
    'goalDirectionKnown',
    'siteKnown',
    'observationProfile',
  ]);
  const speedMps = number(o.speedMps, 'condition.speedMps', 1.4, 2.8);
  if (speedMps !== 1.4 && speedMps !== 2.8)
    fail('RANGE', 'condition.speedMps', 'Expected 1.4 or 2.8');
  const condition = {
    environment: normalizeEnvironment(o.environment),
    previewed: boolean(o.previewed, 'condition.previewed'),
    inputMode: inputMode(o.inputMode),
    speedMps,
    goalDirectionKnown: boolean(o.goalDirectionKnown, 'condition.goalDirectionKnown'),
    siteKnown: boolean(o.siteKnown, 'condition.siteKnown'),
    observationProfile: id(o.observationProfile, 'condition.observationProfile'),
  };
  const { environment, ...settings } = condition;
  return { ...condition, id: conditionHash(environment, settings) };
}
export function parseCondition(value: unknown): Condition {
  const o = object(value, 'condition', [
      'id',
      'environment',
      'previewed',
      'inputMode',
      'speedMps',
      'goalDirectionKnown',
      'siteKnown',
      'observationProfile',
    ]),
    { id, ...body } = o;
  const condition = makeCondition(body as unknown as Omit<Condition, 'id'>);
  if (condition.id !== id) fail('HASH_MISMATCH', 'condition', 'Condition hash mismatch');
  return condition;
}
export function normalizeSample(value: unknown): Sample {
  const o = object(value, 'sample', ['activeTimeMs', 'x', 'y', 'z', 'yaw', 'pitch', 'inputMode']);
  return {
    activeTimeMs: number(o.activeTimeMs, 'sample.activeTimeMs', 0, 1e12, 1e3),
    x: number(o.x, 'sample.x'),
    y: number(o.y, 'sample.y', 0, 100),
    z: number(o.z, 'sample.z'),
    yaw: number(o.yaw, 'sample.yaw', -1e6, 1e6, 1e9),
    pitch: number(o.pitch, 'sample.pitch', -Math.PI / 2, Math.PI / 2, 1e9),
    inputMode: inputMode(o.inputMode),
  };
}
export function makeChunk(value: ChunkInput): WalkChunk {
  const o = object(value, 'chunk', [
    'sessionId',
    'sequence',
    'samples',
    'events',
    'elapsedMs',
    'distanceM',
  ]);
  if (
    !Number.isSafeInteger(o.sequence) ||
    (o.sequence as number) < 0 ||
    (o.sequence as number) > 1e9
  )
    fail('SEQUENCE', 'chunk', 'Invalid sequence');
  if (
    !Array.isArray(o.samples) ||
    o.samples.length > 256 ||
    !Array.isArray(o.events) ||
    o.events.length > 512
  )
    fail('RESOURCE_LIMIT', 'chunk', 'At most 256 samples and 512 events');
  const samples = o.samples.map(normalizeSample),
    elapsedMs = number(o.elapsedMs, 'chunk.elapsedMs', 0, 1e12, 1e3),
    distanceM = number(o.distanceM, 'chunk.distanceM', 0, 1e9);
  for (let i = 0; i < samples.length; i++)
    if (
      samples[i]!.activeTimeMs > elapsedMs ||
      (i > 0 && samples[i]!.activeTimeMs < samples[i - 1]!.activeTimeMs)
    )
      fail('TIME_ORDER', 'chunk', 'Samples must be monotone and inside chunk elapsed time');
  const events: WalkEvent[] = o.events.map((value) => {
    const e = object(value, 'event', ['activeTimeMs', 'kind', 'sampleIndex']);
    if (!['start', 'pause', 'resume', 'finish', 'stop', 'contact-turn'].includes(e.kind as string))
      fail('SCHEMA', 'event.kind', 'Unknown event');
    if (
      !Number.isInteger(e.sampleIndex) ||
      (e.sampleIndex as number) < 0 ||
      (e.sampleIndex as number) >= samples.length
    )
      fail('RANGE', 'event.sampleIndex', 'Event must refer to a sample in this chunk');
    // Apply the same time grid before comparing with the normalized chunk limit.
    // A fixed-step clock can produce 550.0000000000001 for a 550 ms event.
    const activeTimeMs = number(e.activeTimeMs, 'event.activeTimeMs', 0, 1e12, 1e3);
    if (activeTimeMs > elapsedMs || activeTimeMs !== samples[e.sampleIndex as number]!.activeTimeMs)
      fail('TIME_ORDER', 'event', 'Event time must match its referenced sample inside the chunk');
    return {
      activeTimeMs,
      kind: e.kind as WalkEvent['kind'],
      sampleIndex: e.sampleIndex as number,
    };
  });
  const body = {
    sessionId: id(o.sessionId, 'chunk.sessionId'),
    sequence: o.sequence as number,
    samples,
    events,
    elapsedMs,
    distanceM,
  };
  return { ...body, contentHash: hashValue(body) };
}
export function parseChunk(value: unknown): WalkChunk {
  const o = object(value, 'chunk', [
      'sessionId',
      'sequence',
      'samples',
      'events',
      'elapsedMs',
      'distanceM',
      'contentHash',
    ]),
    { contentHash, ...body } = o;
  const chunk = makeChunk(body as unknown as ChunkInput);
  if (chunk.contentHash !== contentHash) fail('HASH_MISMATCH', 'chunk', 'Chunk hash mismatch');
  return chunk;
}
