import { expect, test } from '@playwright/test';
import { prototypeRequest } from '../../src/generation/prototype';
import { generateSync } from '../../src/generation/generate';

test('web prototype: generate → edit geometry → play → save attempt → reload and JSON load', async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await page.getByLabel('Название проекта', { exact: true }).fill('Исходный черновик');
  await page.getByLabel('Название проекта', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Создать лабиринт', exact: true }).click();
  await page.getByLabel('Seed', { exact: true }).fill('prototype-e2e');
  await page.getByRole('button', { name: 'Сгенерировать', exact: true }).click();
  await expect(page.getByText('Карта готова', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Посмотреть карту', exact: true }).click();
  await expect(page.getByLabel('План лабиринта', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть в редакторе', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Пройти', exact: true })).toBeEnabled();
  const canvas = page.getByLabel('План редактора', { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const point = await page.evaluate(async () => {
    const url = '/src/renderer/editor-plan.ts';
    const { getEditorPlan } = await import(/* @vite-ignore */ url);
    return getEditorPlan(document.querySelector('[aria-label="План редактора"]')).clientPoint({
      x: 6.4,
      z: 7.6,
    });
  });
  await page.mouse.click(point.x, point.y);
  const x = page.getByLabel('Положение X, м', { exact: true });
  await expect(x).toHaveValue('6.4');
  await x.fill('6.43');
  await x.press('Tab');
  await expect(page.getByRole('button', { name: 'Пройти', exact: true })).toBeEnabled();
  await page.getByLabel('Название проекта', { exact: true }).fill('Мой первый лабиринт');
  await page.getByLabel('Название проекта', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Пройти', exact: true }).click();
  await page.getByRole('button', { name: 'Подготовить попытку', exact: true }).click();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1400);
  await page.keyboard.up('KeyW');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить попытку', exact: true }).click();
  await page.getByRole('button', { name: 'Остановить и сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Сохранено');
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Мой первый лабиринт', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Черновики' }).getByText('Исходный черновик', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue(
    'Мой первый лабиринт',
  );
  const recovered = await page.evaluate(async () => {
    const url = '/src/renderer/editor-plan.ts';
    const { getEditorPlan } = await import(/* @vite-ignore */ url);
    return getEditorPlan(document.querySelector('[aria-label="План редактора"]'))
      .store.getSnapshot()
      .document.instances.find((i: { id: string }) => i.id.endsWith('/room-0')).position.x;
  });
  expect(recovered).toBe(6.43);
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.getByRole('button', { name: 'Прохождения', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Экспорт попытки', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Сохранить пакет 1', exact: true }).click();
  const path = await (await downloadEvent).path();
  expect(path).not.toBeNull();
  const fresh = await browser.newContext(),
    imported = await fresh.newPage();
  await imported.goto('/');
  await imported.getByText('Импорт JSON', { exact: true }).click();
  await imported.locator('input[type=file]').setInputFiles(path!);
  await imported.getByRole('button', { name: 'Применить импорт', exact: true }).click();
  await expect(
    imported.getByRole('region', { name: 'Список карт' }).getByRole('article'),
  ).toHaveCount(1);
  await imported.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(imported.getByLabel('Название проекта', { exact: true })).toHaveValue(
    'Мой первый лабиринт',
  );
  await expect(imported.getByRole('button', { name: 'Пройти', exact: true })).toBeEnabled();
  await fresh.close();
  expect(errors).toEqual([]);
});
test('prototype worker matches Bun identity; cancel preserves the original project', async ({
  page,
}) => {
  const request = prototypeRequest('cross-runtime', 'prototype-02', 30),
    expected = generateSync(request).variants[0]!;
  await page.goto('/');
  const actual = await page.evaluate(async (request) => {
    const url = '/src/jobs/clients.ts';
    const { generationJobs } = await import(/* @vite-ignore */ url),
      jobs = generationJobs();
    const result = await jobs.submit('test', null, 'generate', { request }).result;
    jobs.dispose();
    return result;
  }, request);
  expect(actual.state).toBe('completed');
  const result = actual.payload as ReturnType<typeof generateSync>;
  expect(result.status).toBe('complete');
  expect(result.variants[0]!.revisionHash).toBe(expected.revisionHash);
  expect(result.variants[0]!.navHash).toBe(expected.navHash);
  await page.getByRole('button', { name: 'Создать лабиринт', exact: true }).click();
  await page.getByRole('button', { name: 'Сгенерировать', exact: true }).click();
  await page.getByRole('button', { name: 'Отменить поиск', exact: true }).click();
  await expect(page.getByText('Генерация прервана', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Библиотека лабиринтов', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Список карт' }).getByRole('article')).toHaveCount(
    0,
  );
});
