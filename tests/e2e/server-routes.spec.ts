import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parsePackage, makePackage, storedRevision } from '../../src/exchange/package';
import { documentHashes, VERSIONS } from '../../src/domain';
import { twoRooms } from '../helpers/maps';
const original = parsePackage(await readFile('public/routes/first-route.json', 'utf8'))
  .revisions[0]!;
async function stored(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const url = '/src/repository/repository.ts';
    const { MazeRepository } = await import(/* @vite-ignore */ url),
      repo = await MazeRepository.open();
    try {
      return { maps: (await repo.listMaps()).items, walks: (await repo.listWalks()).items };
    } finally {
      repo.close();
    }
  });
}
test('server JSON opens the same saved route in independent browsers without manual import and preserves local names', async ({
  page,
  browser,
}) => {
  test.setTimeout(30_000);
  await page.goto('/');
  const catalog = page.getByRole('region', { name: 'Маршруты сервера' });
  await expect(catalog.getByText('Первый маршрут · 12 комнат', { exact: true })).toBeVisible();
  await catalog.getByRole('link', { name: 'Открыть маршрут', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Карточка лабиринта' })).toBeVisible();
  await page.getByRole('button', { name: 'Подготовить попытку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeEnabled();
  await expect(page.getByLabel('План редактора', { exact: true })).toHaveCount(0);
  let data = await stored(page);
  expect(data.maps).toHaveLength(1);
  expect(data.maps[0]!.revisionHash).toBe(original.revisionHash);
  expect(data.walks).toHaveLength(1);
  expect(data.walks[0]!.status).toBe('prepared');
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.getByRole('button', { name: 'Переименовать', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Переименование проекта' })
    .getByRole('textbox')
    .fill('Местное имя');
  await page.getByRole('button', { name: 'Сохранить название', exact: true }).click();
  await page.goto('/?route=first-route');
  await expect(page.getByRole('main', { name: 'Карточка лабиринта' })).toBeVisible();
  await page.getByRole('button', { name: 'Подготовить попытку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeEnabled();
  data = await stored(page);
  expect(data.maps).toHaveLength(1);
  expect(data.maps[0]!.title).toBe('Местное имя');
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto('/?route=first-route');
    await expect(other.getByRole('main', { name: 'Карточка лабиринта' })).toBeVisible();
    await other.getByRole('button', { name: 'Подготовить попытку', exact: true }).click();
    await expect(other.getByRole('button', { name: 'Начать', exact: true })).toBeEnabled();
    const independent = await stored(other);
    expect(independent.maps).toHaveLength(1);
    expect(independent.maps[0]!.revisionHash).toBe(original.revisionHash);
    expect(independent.maps[0]!.title).toBe('Первый маршрут');
  } finally {
    await context.close();
  }
});
test('missing or geometrically invalid server JSON never saves an unverified map or creates an attempt', async ({
  page,
}) => {
  await page.goto('/?route=missing-route');
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await stored(page)).maps).toHaveLength(0);
  const doc = twoRooms();
  doc.connections = [];
  const packet = makePackage(
    {
      definitions: doc.definitions,
      maps: [
        storedRevision({
          document: doc,
          revisionHash: documentHashes(doc).revisionHash,
          versions: VERSIONS,
          validationSummary: { ready: true, diagnostics: [] },
        }),
      ],
      projects: [],
      sessions: [],
      chunks: [],
    },
    '2026-11-11T00:00:00.000Z',
  );
  await page.route('**/routes/first-route.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(packet) }),
  );
  await page.goto('/?route=first-route');
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await stored(page)).maps).toHaveLength(0);
  expect((await stored(page)).walks).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(0);
});
