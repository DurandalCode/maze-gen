import { expect, test } from '@playwright/test';
import { twoRooms } from '../helpers/maps';

test('compute worker returns one prepared artifact, preserves active buffers, and restarts after cancellation', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (document) => {
    const url = '/src/jobs/clients.ts',
      { computeJobs } = await import(/* @vite-ignore */ url),
      manager = computeJobs();
    const a = await manager.submit('view', document.revision, 'compile', { document }).result;
    const first = a.payload.world,
      byteLength = first.floorMesh.positions.byteLength;
    const pending = manager.submit('cancel', document.revision, 'compile', { document });
    const before = performance.now();
    pending.cancel();
    const cancelled = await pending.result,
      cancelMs = performance.now() - before;
    const b = await manager.submit('view', document.revision, 'compile', { document }).result;
    const result = {
      a: a.state,
      b: b.state,
      cancelled: cancelled.state,
      cancelMs,
      bufferPreserved: first.floorMesh.positions.byteLength === byteLength,
      byteLength,
      worldHash: first.physical.worldHash,
      secondHash: b.payload.world.physical.worldHash,
      route: first.navigation.referenceLengthM,
      sharedPhysical: first.physical === first.navigation.collision.physical,
    };
    manager.dispose();
    return { ...result, stats: manager.stats() };
  }, twoRooms());
  expect(result.a).toBe('completed');
  expect(result.b).toBe('completed');
  expect(result.cancelled).toBe('cancelled');
  expect(result.cancelMs).toBeLessThan(100);
  expect(result.byteLength).toBeGreaterThan(0);
  expect(result.bufferPreserved).toBe(true);
  expect(result.sharedPhysical).toBe(true);
  expect(result.worldHash).toBe(result.secondHash);
  expect(result.route).toBeGreaterThan(3);
  expect(result.stats).toEqual({ active: 0, pending: 0, workers: 0, owners: 0 });
});
