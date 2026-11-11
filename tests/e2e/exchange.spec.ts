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
      target.getByRole('heading', { name: 'Смешанные формы', exact: true }),
    ).toBeVisible();
    await expect(target.getByLabel('План лабиринта', { exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
});
