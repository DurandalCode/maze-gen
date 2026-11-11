import { expect, test } from '@playwright/test';
async function templateEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать две комнаты' }).click();
  await page.getByRole('button', { name: 'Подготовить попытку' }).waitFor();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(page.getByLabel('План редактора', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить карту', exact: true })).toBeEnabled();
}
async function planPoint(page: import('@playwright/test').Page, point: { x: number; z: number }) {
  await page.getByLabel('План редактора', { exact: true }).scrollIntoViewIfNeeded();
  return page.evaluate(async (point) => {
    const url = '/src/renderer/editor-plan.ts';
    const { getEditorPlan } = await import(/* @vite-ignore */ url);
    const canvas = document.querySelector('[aria-label="План редактора"]') as HTMLCanvasElement;
    const view = getEditorPlan(canvas);
    if (!view) throw new Error('Editor plan is not mounted');
    return view.clientPoint(point);
  }, point);
}
test('editor keeps metadata/visual jobs separate, rejects stale physical readiness and undoes one drag in one command', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const target = window as unknown as { editorJobs: string[] };
    target.editorJobs = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      data: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      const message = data as { operation?: string };
      if (message?.operation) target.editorJobs.push(message.operation);
      return Reflect.apply(post, this, [data, options]);
    };
  });
  await templateEditor(page);
  const before = await page.evaluate(
    () =>
      (window as unknown as { editorJobs: string[] }).editorJobs.filter((s) => s === 'compile')
        .length,
  );
  const title = page.getByLabel('Название проекта', { exact: true });
  await title.fill('Редактор тест');
  await title.press('Tab');
  await page.getByRole('button', { name: 'Окружение', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Крыша', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Сохранить карту', exact: true })).toBeEnabled();
  const ops = await page.evaluate(() => (window as unknown as { editorJobs: string[] }).editorJobs);
  expect(ops.filter((s) => s === 'compile')).toHaveLength(before);
  expect(ops).toContain('identity');
  const center = await planPoint(page, { x: 10, z: 10 });
  await page.mouse.click(center.x, center.y);
  const x = page.getByLabel('Положение X, м', { exact: true });
  await expect(x).toHaveValue('10');
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 30, center.y, { steps: 20 });
  await page.mouse.up();
  await expect(x).not.toHaveValue('10');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(x).toHaveValue('10');
  await x.fill('20');
  await x.press('Tab');
  await expect(page.getByRole('region', { name: 'Ошибки карты' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пройти', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(x).toHaveValue('10');
  await expect(page.getByRole('button', { name: 'Сохранить карту', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Сохранить карту', exact: true }).click();
  await expect(page.getByText('Проверенная карта сохранена в библиотеке.')).toBeVisible();
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Библиотека лабиринтов' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('invalid draft survives reload and a circular map becomes playable after adding explicit terminals', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await page.getByRole('button', { name: 'circle-2', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ошибки карты' })).toBeVisible();
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Черновики' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(page.getByText('Восстановлен сохранённый черновик.')).toBeVisible();
  const center = await planPoint(page, { x: 25, z: 25 });
  await page.mouse.click(center.x, center.y);
  await page.getByRole('button', { name: 'Добавить проём', exact: true }).click();
  const east = await planPoint(page, { x: 27, z: 25 });
  await page.mouse.click(east.x, east.y);
  await page.getByRole('combobox', { name: 'Назначение', exact: true }).selectOption('entrance');
  await page.getByRole('button', { name: 'Добавить проём', exact: true }).click();
  const west = await planPoint(page, { x: 23, z: 25 });
  await page.mouse.click(west.x, west.y);
  await page.getByRole('combobox', { name: 'Назначение', exact: true }).selectOption('exit');
  await expect(page.getByRole('button', { name: 'Пройти', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Проверить 3D', exact: true }).click();
  await expect(page.getByLabel('Трёхмерный лабиринт', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Пройти', exact: true }).click();
  await page.getByRole('button', { name: 'Подготовить попытку' }).click();
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeEnabled();
  await expect(page.getByText('Карта ранее просмотрена на этом устройстве.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('draft backup restores in a new project and an invalid backup preserves the current document', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await page.getByRole('button', { name: 'triangle-4', exact: true }).click();
  const title = page.getByLabel('Название проекта', { exact: true });
  await title.fill('Резервный черновик');
  await title.press('Tab');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать черновик', exact: true }).click();
  const download = await downloaded,
    path = await download.path();
  expect(path).not.toBeNull();
  await page.getByLabel('Открыть черновик JSON', { exact: true }).setInputFiles(path!);
  await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue(
    'Резервный черновик',
  );
  await expect(page.getByLabel('План редактора', { exact: true })).toBeVisible();
  const before = await page.evaluate(async () => {
    const url = '/src/renderer/editor-plan.ts';
    const { getEditorPlan } = await import(/* @vite-ignore */ url);
    return JSON.stringify(
      getEditorPlan(document.querySelector('[aria-label="План редактора"]')).store.getSnapshot()
        .document,
    );
  });
  await page.getByLabel('Открыть черновик JSON', { exact: true }).setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"kind":"old-format"}'),
  });
  await expect(page.getByRole('alert')).toContainText('Нужен файл maze-reboot-draft');
  const after = await page.evaluate(async () => {
    const url = '/src/renderer/editor-plan.ts';
    const { getEditorPlan } = await import(/* @vite-ignore */ url);
    return JSON.stringify(
      getEditorPlan(document.querySelector('[aria-label="План редактора"]')).store.getSnapshot()
        .document,
    );
  });
  expect(after).toBe(before);
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Черновики' }).getByRole('article')).toHaveCount(2);
});
test('quota failure keeps an invalid draft editable and its emergency download needs no successful IDB write', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.context().route('**/src/repository/storage-worker.ts*', async (route) => {
    const response = await route.fetch(),
      source = await response.text();
    await route.fulfill({
      response,
      body: `const realPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('draft quota injected','QuotaExceededError');return realPut.apply(this,args);};\n${source}`,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await page.getByRole('button', { name: 'circle-2', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('draft quota injected');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать черновик', exact: true }).first().click();
  const download = await event;
  expect(await download.failure()).toBeNull();
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Несохранённый черновик' })).toBeVisible();
  await page.getByRole('button', { name: 'Остаться в редакторе' }).click();
  await expect(page.getByLabel('План редактора', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пройти', exact: true })).toBeDisabled();
});
