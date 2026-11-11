import { test, expect } from '@playwright/test';
import { rm, readFile } from 'node:fs/promises';
test.beforeAll(async () => {
  await rm('work/test-shared-library.json', { force: true });
});
test('maps and recorded attempts are shared across independent browser profiles and persisted as server JSON', async ({
  page,
  browser,
}) => {
  test.setTimeout(45000);
  await page.goto('/?route=first-route');
  await expect(page.getByRole('main', { name: 'Карточка лабиринта' })).toBeVisible();
  await page.getByRole('button', { name: 'Начать прохождение →', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Управление прохождением' })).toHaveCount(0);
  await expect(page.getByRole('banner').getByText('Прохождение', { exact: true })).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1300);
  await page.keyboard.up('KeyW');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Сохранено');
  await page.getByRole('button', { name: 'Завершить попытку', exact: true }).click();
  await page.getByRole('button', { name: 'Остановить и сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto('/');
    await expect(
      other.getByRole('region', { name: 'Список карт' }).getByRole('article'),
    ).toHaveCount(1);
    await other.getByRole('button', { name: 'Прохождения', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Результат', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
    await expect(other.getByRole('status')).toHaveText('Сохранено');
    await other.getByRole('button', { name: 'В библиотеку', exact: true }).click();
    await other.getByRole('button', { name: 'Прохождения', exact: true }).click();
    await other.getByRole('button', { name: 'Экспорт попытки', exact: true }).click();
    const download = other.waitForEvent('download');
    await other.getByRole('link', { name: 'Сохранить пакет 1', exact: true }).click();
    expect(await (await download).failure()).toBeNull();
  } finally {
    await otherContext.close();
  }
  const saved = JSON.parse(await readFile('work/test-shared-library.json', 'utf8'));
  expect(saved.kind).toBe('maze-shared-library');
  expect(saved.stores.maps).toHaveLength(1);
  expect(saved.stores.sessions).toHaveLength(1);
  expect(saved.stores.sessions[0].state).toBe('stopped');
  expect(saved.stores.sessions[0].distanceM).toBeGreaterThan(0.2);
  expect(saved.stores.walkChunks.length).toBeGreaterThan(0);
});

test('an existing browser library migrates once to shared JSON without removing local originals', async ({
  page,
}) => {
  await page.goto('/routes/index.json');
  await page.evaluate(async () => {
    const repoUrl = '/src/repository/repository.ts',
      mapsUrl = '/tests/helpers/maps.ts',
      domainUrl = '/src/domain/index.ts',
      formatUrl = '/src/session/format.ts';
    const [{ MazeRepository }, { twoRooms }, { documentHashes, VERSIONS }, { makeCondition }] =
      await Promise.all([
        import(/* @vite-ignore */ repoUrl),
        import(/* @vite-ignore */ mapsUrl),
        import(/* @vite-ignore */ domainUrl),
        import(/* @vite-ignore */ formatUrl),
      ]);
    const repo = await MazeRepository.open(),
      document = twoRooms();
    document.metadata.title = 'Локальная карта';
    const hash = documentHashes(document).revisionHash;
    try {
      await repo.saveMap(
        {
          document,
          revisionHash: hash,
          versions: VERSIONS,
          validationSummary: { ready: true, diagnostics: [] },
        },
        'legacy-project',
        'Локальная карта',
      );
      await repo.sessions.create(
        'legacy-attempt',
        hash,
        makeCondition({
          environment: document.environment,
          previewed: true,
          inputMode: 'keyboard',
          speedMps: 1.4,
          goalDirectionKnown: false,
          siteKnown: false,
          observationProfile: 'visual-v1',
        }),
      );
      await repo.sessions.transition('legacy-attempt', 'running');
      await repo.saveDraft('legacy-draft', document, null, 1);
    } finally {
      repo.close();
    }
  });
  await page.goto('/');
  await expect(
    page.getByText(
      'Общая JSON-библиотека dev-сервера: карты и прохождения доступны во всех браузерах.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Список карт' }).getByRole('article')).toHaveCount(
    2,
  );
  await expect(page.getByRole('region', { name: 'Черновики' }).getByRole('article')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Список карт' }).getByRole('article')).toHaveCount(
    2,
  );
  const originalCount = await page.evaluate(async () => {
    const url = '/src/repository/repository.ts';
    const { MazeRepository } = await import(/* @vite-ignore */ url),
      repo = await MazeRepository.open();
    try {
      return (await repo.listMaps()).items.length;
    } finally {
      repo.close();
    }
  });
  expect(originalCount).toBe(1);
  const saved = JSON.parse(await readFile('work/test-shared-library.json', 'utf8'));
  expect(saved.stores.maps).toHaveLength(2);
  expect(saved.stores.sessions).toHaveLength(2);
  expect(saved.migrations).toHaveLength(1);
  expect(
    saved.stores.sessions.find((s: { sessionId: string }) => s.sessionId === 'legacy-attempt')
      .state,
  ).toBe('interrupted');
});
