/** Run separately from bun test: requires Chrome/Edge and a running Vite server. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const executablePath = process.env.MAZE_BROWSER;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : { channel: 'msedge' }),
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
await mkdir('test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('heading', { name: /План лабиринта/ }).waitFor();
  assert(await page.getByLabel('Столбцы', { exact: true }).inputValue() === '5', 'Default module columns must be 5');
  assert(await page.getByLabel('Строки', { exact: true }).inputValue() === '5', 'Default module rows must be 5');
  assert(await page.getByLabel('Дополнительные соединения', { exact: true }).inputValue() === '0', 'Default extra connections must be zero');
  assert(await page.getByLabel('Высота стен', { exact: true }).inputValue() === '2.5', 'Default wall height must be 2.5m');
  assert(await page.getByLabel('Размер модуля', { exact: true }).inputValue() === '2', 'Modules must default to 2m');
  assert(await page.getByLabel('Проход между модулями', { exact: true }).inputValue() === '2', 'Outside lanes must default to 2m');
  assert(await page.getByLabel('Цвет стен', { exact: true }).inputValue() === '#000000', 'Walls must default to black');
  await page.getByLabel('Просвечивающая ткань', { exact: true }).check();
  assert(await page.getByRole('slider').count() === 0, 'Fabric must be a checkbox instead of a transparency slider');
  await page.getByLabel('Высота стен', { exact: true }).fill('3.4');
  await page.getByLabel('Цвет стен', { exact: true }).fill('#3478ab');
  await page.getByLabel('Крыша над лабиринтом', { exact: true }).check();
  await page.screenshot({ path: 'test-results/map.png', fullPage: true });
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const download = await originalDownload;
  await download.saveAs(join('test-results', 'roundtrip.json'));
  const saved = JSON.parse(await Bun.file('test-results/roundtrip.json').text());
  assert(saved.passages.length === 81 && saved.parameters.moduleSize === 2, 'Default modular layout must include module interiors and connecting lanes without an outside ring');
  assert(saved.wallHeight === 3.4 && saved.wallColor === '#3478ab' && saved.roof === true, 'Construction settings must save immediately without regeneration');
  assert(saved.translucentFabric === true && !('wallOpacity' in saved), 'Fabric checkbox must be saved as a boolean');
  await page.getByLabel('Кратчайший путь', { exact: true }).check();
  await page.locator('.map-canvas').hover();
  await page.mouse.wheel(0, -300);
  await page.getByRole('button', { name: 'Вписать в экран' }).click();
  await page.getByLabel('Алгоритм', { exact: true }).selectOption('prim');
  await page.getByLabel('Столбцы', { exact: true }).fill('1');
  await page.getByLabel('Строки', { exact: true }).fill('1');
  await page.getByLabel('Дополнительные соединения', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Сгенерировать', exact: true }).click();
  assert(await page.locator('.workspace-header h2').innerText() === 'План лабиринта 1 × 1', 'Generation must update dimensions');
  await page.getByRole('button', { name: /Пройти от первого лица/ }).click();
  await page.getByRole('button', { name: 'Начать прохождение' }).waitFor();
  assert((await page.locator('.walk-footer').innerText()).includes('3,4 м'), 'Generation must preserve custom wall height');
  assert((await page.locator('.walk-footer').innerText()).includes('С КРЫШЕЙ'), 'Walk must show configured roof');
  // Wait until lazy-loaded Three.js has actually rendered a frame.
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.walk-canvas');
    return canvas && canvas.width > 300;
  });
  await page.screenshot({ path: 'test-results/walk-paused.png', fullPage: true });
  await page.getByRole('button', { name: 'Начать прохождение' }).click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.locator('.walk-overlay').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/walk.png', fullPage: true });
  await page.keyboard.down('KeyW');
  await page.getByText('ВЫХОД НАЙДЕН', { exact: true }).waitFor({ timeout: 15000 });
  await page.keyboard.up('KeyW');
  assert(await page.getByRole('region', { name: 'Результаты прохождения' }).isVisible(), 'Results must be shown at exit');
  await page.screenshot({ path: 'test-results/result.png', fullPage: true });
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await (await fileChooser).setFiles('test-results/roundtrip.json');
  await page.getByRole('heading', { name: /План лабиринта 5 × 5/ }).waitFor();
  const reDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await (await reDownload).saveAs('test-results/restored.json');
  assert(isDeepStrictEqual(JSON.parse(await Bun.file('test-results/restored.json').text()), saved), 'Load/save must preserve every topology field');
  await page.getByLabel('Столбцы', { exact: true }).fill('100');
  await page.getByLabel('Строки', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Сгенерировать', exact: true }).click();
  await page.getByRole('heading', { name: /План лабиринта 100 × 100/ }).waitFor();
  await page.screenshot({ path: 'test-results/large-map.png', fullPage: true });
  await page.getByRole('button', { name: /Пройти от первого лица/ }).click();
  await page.getByRole('button', { name: 'Начать прохождение' }).waitFor();
  await page.waitForFunction(() => (document.querySelector<HTMLCanvasElement>('.walk-canvas')?.width ?? 0) > 300);
  await page.screenshot({ path: 'test-results/large-walk.png' });
  await page.getByRole('button', { name: /Вернуться к карте/ }).click();
  await page.getByRole('heading', { name: /План лабиринта/ }).waitFor();
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.screenshot({ path: 'test-results/narrow.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Narrow layout must not overflow horizontally');
  assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  console.log('PASS: map, parameters, zoom, 3D, pointer lock, traversal, results, JSON round trip, 100×100, narrow layout.');
} finally {
  // Bun on Windows can retain the browser transport after Chromium has exited.
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
}
process.exit(0);
