import { expect, test } from '@playwright/test';

test('blind attempt records physical movement and resumes committed state after reload', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать две комнаты' }).click();
  const dialog = page.getByRole('main', { name: 'Карточка лабиринта' });
  await expect(dialog.getByText('План и название скрыты.', { exact: false })).toBeVisible();
  await expect(dialog.locator('canvas')).toHaveCount(0);
  await expect(dialog.getByText('Две комнаты', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Подготовить попытку' }).click();
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeEnabled();
  await expect(page.getByText('Попытка без предварительного просмотра.')).toBeVisible();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Управление прохождением' })).toHaveCount(0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2400);
  await page.keyboard.up('KeyW');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveText('Сохранено');
  const before = await page.evaluate(async () => {
    const url = '/src/repository/repository.ts';
    const { MazeRepository } = await import(/* @vite-ignore */ url);
    const repo = await MazeRepository.open();
    try {
      const page = await repo.listWalks();
      return repo.sessions.get(page.items[0].sessionId);
    } finally {
      repo.close();
    }
  });
  expect(before.distanceM).toBeGreaterThan(0.2);
  expect(before.elapsedMs).toBeGreaterThan(500);
  expect(before.lastCommittedSequence).toBeGreaterThanOrEqual(0);
  expect(before.condition.previewed).toBe(false);
  expect(before.condition.inputMode).toBe('keyboard');
  await page.reload();
  await page.getByRole('button', { name: 'Прохождения', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(
    page.getByText('Восстановлена последняя подтверждённая запись.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Завершить попытку', exact: true }).click();
  await page.getByRole('button', { name: 'Остановить и сохранить' }).click();
  await expect(page.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.getByRole('button', { name: 'Прохождения', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Результат', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Остановлено', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('explicit preview persists knowledge and touch uses the same recorder', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать две комнаты' }).click();
  await page.getByRole('button', { name: 'Подготовить попытку' }).waitFor();
  await page.getByRole('button', { name: '← Библиотека', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть карточку', exact: true }).click();
  await expect(
    page
      .getByRole('main', { name: 'Карточка лабиринта' })
      .getByRole('heading', { name: 'Две комнаты', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('План лабиринта', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сцена 3D' }).click();
  await expect(page.getByLabel('Трёхмерный лабиринт', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Библиотека', exact: true }).click();
  await page.getByRole('button', { name: 'Пройти вслепую', exact: true }).click();
  await expect(page.getByText('Карта уже просмотрена.', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'Управление', exact: true }).selectOption('touch');
  await page.getByRole('button', { name: 'Подготовить попытку' }).click();
  await expect(page.getByText('Карта ранее просмотрена на этом устройстве.')).toBeVisible();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  const forward = page.getByRole('button', { name: 'Вперёд', exact: true });
  const box = (await forward.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('context loss and background pause recording without creating a new attempt', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать две комнаты' }).click();
  await page.getByRole('button', { name: 'Подготовить попытку' }).click();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Управление прохождением' })).toHaveCount(0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const extension = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('No context loss extension');
    extension.loseContext();
  });
  await expect(page.getByRole('heading', { name: 'Сцена приостановлена' })).toBeVisible();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Восстановить сцену' }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Управление прохождением' })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'В библиотеку' }).click();
  await page.getByRole('button', { name: 'Прохождения', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Список прохождений' }).getByRole('article'),
  ).toHaveCount(1);
});
