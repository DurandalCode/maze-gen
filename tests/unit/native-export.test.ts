import { expect, test } from 'bun:test';
import { nativeExportAvailable, shareNativePacket } from '../../src/platform/native-export';
import type { NativeBridge, NativeChunk } from '../../src/platform/native-export';
test('native bridge sends bounded acknowledged chunks, byte-identical data, and scoped abort on invalid ack', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const target = new EventTarget() as EventTarget & { RebootNative: NativeBridge };
  const received: Uint8Array[] = [],
    aborted: string[] = [],
    calls: string[] = [];
  let expected = 0,
    invalidAck = false,
    outstanding = 0,
    maxOutstanding = 0;
  const receipt = (requestId: string, result: unknown) => {
    outstanding++;
    maxOutstanding = Math.max(maxOutstanding, outstanding);
    queueMicrotask(() => {
      outstanding--;
      target.dispatchEvent(
        new CustomEvent('maze-native-receipt', { detail: { requestId, ok: true, result } }),
      );
    });
  };
  target.RebootNative = {
    begin: (requestId, id, _filename, bytes) => {
      calls.push(`begin:${id}`);
      expected = bytes;
      receipt(requestId, { sequence: 0 });
    },
    append: (requestId, _id, sequence, base64) => {
      expect(base64.length).toBeLessThanOrEqual(256 * 1024);
      received.push(new Uint8Array(Buffer.from(base64, 'base64')));
      receipt(requestId, { sequence: invalidAck ? sequence + 1 : sequence });
    },
    finish: (requestId, id) => {
      calls.push(`finish:${id}`);
      receipt(requestId, { prepared: true, bytes: expected });
    },
    abort: (requestId, id) => {
      aborted.push(id);
      receipt(requestId, { aborted: true });
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://appassets.androidplatform.net' },
  });
  try {
    expect(nativeExportAvailable()).toBe(true);
    const source = new Uint8Array(600_013);
    for (let i = 0; i < source.length; i++) source[i] = i % 251;
    const read = async (sequence: number): Promise<NativeChunk> => {
      const bytes = source.slice(sequence * 192 * 1024, (sequence + 1) * 192 * 1024);
      return {
        sequence,
        base64: Buffer.from(bytes).toString('base64'),
        bytes: bytes.length,
        last: (sequence + 1) * 192 * 1024 >= source.length,
      };
    };
    const progress: number[] = [];
    await shareNativePacket(
      { exportId: 'test', number: 1, filename: 'maze.json', bytes: source.length },
      read,
      new AbortController().signal,
      (bytes) => progress.push(bytes),
    );
    expect(new Uint8Array(Buffer.concat(received.map((b) => Buffer.from(b))))).toEqual(source);
    expect(progress.at(-1)).toBe(source.length);
    expect(maxOutstanding).toBe(1);
    expect(aborted).toEqual([]);
    expect(calls).toEqual(['begin:test-1', 'finish:test-1']);
    invalidAck = true;
    await expect(
      shareNativePacket(
        { exportId: 'bad', number: 2, filename: 'maze.json', bytes: source.length },
        read,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('другой номер');
    expect(aborted).toEqual(['bad-2']);
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'https://untrusted.invalid' },
    });
    expect(nativeExportAvailable()).toBe(false);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorLocation) Object.defineProperty(globalThis, 'location', priorLocation);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});
