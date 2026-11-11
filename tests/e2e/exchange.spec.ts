import { expect, test } from '@playwright/test';
import { documentHashes, VERSIONS } from '../../src/domain';
import { makePackage, storedRevision } from '../../src/exchange/package';
import { mixedFixture } from '../fixtures/factory';
import type { Document } from '../../src/domain';
function packageFile(document: Document = mixedFixture()) {
  const revisionHash = documentHashes(document).revisionHash;
  return {
    name: 'maze-package.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify(
        makePackage({
          definitions: document.definitions,
          maps: [
            storedRevision({
              document,
              revisionHash,
              versions: { ...VERSIONS },
              validationSummary: { ready: true, diagnostics: [] },
            }),
          ],
          projects: [
            {
              projectId: 'package-project',
              title: 'Смешанные формы',
              currentRevisionHash: revisionHash,
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          sessions: [],
          chunks: [],
        }),
      ),
    ),
  };
}
test('file preflight remains invisible until commit; cancel, duplicate and legacy rejection preserve the library', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByText('Импорт JSON', { exact: true }).click();
  const input = page.getByRole('region', { name: 'Импорт пакета' }).locator('input[type=file]');
  const maps = page.getByRole('region', { name: 'Список карт' });
  await input.setInputFiles(packageFile());
  await expect(page.getByRole('button', { name: 'Применить импорт' })).toBeEnabled();
  await expect(maps.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить импорт' }).click();
  await expect(page.getByText('Импорт отменён. Библиотека не изменена.')).toBeVisible();
  await expect(maps.getByRole('article')).toHaveCount(0);
  await input.setInputFiles(packageFile());
  await page.getByRole('button', { name: 'Применить импорт' }).click();
  await expect(maps.getByRole('article')).toHaveCount(1);
  await input.setInputFiles(packageFile());
  await expect(page.getByText('Дубликаты: карт 1, прохождений 0, определений 4.')).toBeVisible();
  await page.getByRole('button', { name: 'Применить импорт' }).click();
  await expect(
    page.getByText('Все записи уже есть в библиотеке. Дубликаты пропущены.').first(),
  ).toBeVisible();
  await expect(maps.getByRole('article')).toHaveCount(1);
  await input.setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"kind":"maze-package","schemaVersion":1}'),
  });
  await expect(page.getByRole('alert')).toContainText('Старые форматы не мигрируются');
  await expect(maps.getByRole('article')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('schema-valid package with invalid geometry never becomes ready in the library', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByText('Импорт JSON', { exact: true }).click();
  const document = mixedFixture();
  document.connections = [];
  await page.locator('input[type=file]').setInputFiles(packageFile(document));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить импорт' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Список карт' }).getByRole('article')).toHaveCount(
    0,
  );
});

test('selection exports a self-contained Blob download and another browser library imports the same identity', async ({
  page,
  browser,
}) => {
  test.setTimeout(30_000);
  await page.goto('/');
  await page.getByText('Импорт JSON', { exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(packageFile());
  await page.getByRole('button', { name: 'Применить импорт' }).click();
  await expect(page.getByRole('region', { name: 'Список карт' }).getByRole('article')).toHaveCount(
    1,
  );
  await page.getByRole('checkbox', { name: 'Выбрать карту 1', exact: true }).check();
  await page.getByRole('button', { name: 'Экспортировать выбранное (1)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Экспорт пакетов' });
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('link', { name: 'Сохранить пакет 1' }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  await expect(
    dialog.getByText('Все пакеты отправлены на скачивание.', { exact: false }),
  ).toBeVisible();
  const other = await browser.newContext();
  try {
    const target = await other.newPage();
    await target.goto('/');
    await target.getByText('Импорт JSON', { exact: true }).click();
    await target.locator('input[type=file]').setInputFiles(path!);
    await target.getByRole('button', { name: 'Применить импорт' }).click();
    await expect(
      target.getByRole('region', { name: 'Список карт' }).getByRole('article'),
    ).toHaveCount(1);
    await target.getByRole('button', { name: 'Посмотреть', exact: true }).click();
    await expect(
      target
        .getByRole('dialog', { name: 'Выбранная карта' })
        .getByRole('heading', { name: 'Смешанные формы', exact: true }),
    ).toBeVisible();
    await expect(target.getByLabel('План лабиринта', { exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
});

test('native export is read as bounded worker chunks and reconstructs the same portable package', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByText('Импорт JSON', { exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(packageFile());
  await page.getByRole('button', { name: 'Применить импорт' }).click();
  await expect(page.getByRole('region', { name: 'Список карт' }).getByRole('article')).toHaveCount(
    1,
  );
  const result = await page.evaluate(async () => {
    const clientUrl = '/src/jobs/clients.ts',
      formatUrl = '/src/session/format.ts',
      packageUrl = '/src/exchange/package.ts';
    const [{ storageJobs }, { makeCondition }, { parsePackage }] = await Promise.all([
      import(/* @vite-ignore */ clientUrl),
      import(/* @vite-ignore */ formatUrl),
      import(/* @vite-ignore */ packageUrl),
    ]);
    const jobs = storageJobs();
    let owner = 0;
    const call = async (operation: string, input: unknown): Promise<any> => {
      const result = await jobs.submit(`test-${++owner}`, null, operation, input).result;
      if (result.state !== 'completed') throw new Error(JSON.stringify(result));
      return result.payload;
    };
    try {
      const maps = await call('list', { kind: 'maps' }),
        hash = maps.items[0].revisionHash;
      const map = await call('get', { kind: 'map', hash });
      const condition = makeCondition({
        environment: map.document.environment,
        previewed: false,
        inputMode: 'touch',
        speedMps: 1.4,
        goalDirectionKnown: false,
        siteKnown: false,
        observationProfile: 'visual-v1',
      });
      await call('save', { kind: 'session', sessionId: 'native-walk', mapHash: hash, condition });
      await call('save', { kind: 'session-state', sessionId: 'native-walk', state: 'running' });
      for (let sequence = 0; sequence < 16; sequence++) {
        const samples = Array.from({ length: 256 }, (_, index) => ({
          activeTimeMs: (sequence * 256 + index) * 100,
          x: 10,
          y: 1.7,
          z: 10,
          yaw: 0,
          pitch: 0,
          inputMode: 'touch',
        }));
        await call('append', {
          chunk: {
            sessionId: 'native-walk',
            sequence,
            samples,
            events: [],
            elapsedMs: samples.at(-1)!.activeTimeMs,
            distanceM: 0,
          },
        });
      }
      await call('save', { kind: 'session-state', sessionId: 'native-walk', state: 'paused' });
      const begun = await call('export', {
        kind: 'begin',
        native: true,
        selection: { mapHashes: [], sessionIds: ['native-walk'] },
      });
      if (begun.packet.blob !== undefined || !begun.packet.native)
        throw new Error('Native export leaked a whole Blob');
      const pieces: Uint8Array[] = [];
      let maxCharacters = 0,
        bytes = 0;
      for (let sequence = 0; ; sequence++) {
        const chunk = await call('export', { kind: 'chunk', exportId: begun.exportId, sequence });
        maxCharacters = Math.max(maxCharacters, chunk.base64.length);
        const decoded = Uint8Array.from(atob(chunk.base64), (c: string) => c.charCodeAt(0));
        if (decoded.length !== chunk.bytes) throw new Error('Chunk size mismatch');
        pieces.push(decoded);
        bytes += decoded.length;
        if (chunk.last) break;
      }
      const all = new Uint8Array(bytes);
      let offset = 0;
      for (const piece of pieces) {
        all.set(piece, offset);
        offset += piece.length;
      }
      const parsed = parsePackage(new TextDecoder().decode(all));
      const finished = await call('export', {
        kind: 'part-complete',
        exportId: begun.exportId,
        number: begun.packet.number,
      });
      return {
        maxCharacters,
        parts: pieces.length,
        bytes,
        expected: begun.packet.bytes,
        counts: parsed.counts,
        hash: parsed.package.maps[0].revisionHash,
        expectedHash: hash,
        done: finished.done,
      };
    } finally {
      jobs.dispose();
    }
  });
  expect(result.parts).toBeGreaterThan(1);
  expect(result.maxCharacters).toBeLessThanOrEqual(256 * 1024);
  expect(result.bytes).toBe(result.expected);
  expect(result.counts.samples).toBe(4096);
  expect(result.hash).toBe(result.expectedHash);
  expect(result.done).toBe(true);
});
