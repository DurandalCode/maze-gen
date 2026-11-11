import { test, expect } from '@playwright/test';
test('map details is a full page with parameters, history, permalink and one-click start', async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?route=first-route');
  const card = page.getByRole('main', { name: 'Карточка лабиринта' });
  await expect(card.getByRole('heading', { name: 'Первый маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('План лабиринта', { exact: true })).toBeVisible();
  for (const name of ['Из чего состоит лабиринт', 'Материалы', 'Как создана карта', 'Прохождения'])
    await expect(card.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(card.getByText('first-walk-2026-11-11', { exact: true })).toBeVisible();
  expect(page.url()).toMatch(/\?map=[a-f0-9]{64}/);
  const read = async () =>
    page.evaluate(async () => {
      const url = '/src/repository/repository.ts';
      const { MazeRepository } = await import(/* @vite-ignore */ url),
        repo = await MazeRepository.open();
      try {
        return (await repo.listWalks()).items;
      } finally {
        repo.close();
      }
    });
  expect(await read()).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('map-details-desktop.png'), fullPage: true });
  await page.reload();
  await expect(card.getByRole('heading', { name: 'Первый маршрут', exact: true })).toBeVisible();
  expect(await read()).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('map-details-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.getByRole('button', { name: 'Начать прохождение →', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Управление прохождением' })).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Карточка лабиринта' })).toHaveCount(0);
  await expect(page.getByRole('banner').getByText('Прохождение', { exact: true })).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Сохранено');
  const walks = await read();
  expect(walks).toHaveLength(1);
  expect(walks[0].distanceM).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть карточку', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'История прохождений' })
      .getByRole('button', { name: 'Продолжить', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'История прохождений' })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  await expect(page.getByRole('banner').getByText('Прохождение', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Сохранено');
  expect(await read()).toHaveLength(1);
});
