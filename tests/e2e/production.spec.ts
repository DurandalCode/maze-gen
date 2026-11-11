import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsePackage } from '../../src/exchange/package';

test('production assets run offline at the embedded HTTPS origin with CSP, workers and chunked native export', async ({
  page,
}) => {
  test.skip(!existsSync('dist/index.html'), 'Run bun run build before the production-assets check');
  test.setTimeout(30_000);
  const errors: string[] = [],
    outside: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const origin = 'https://appassets.androidplatform.net';
  const dist = resolve('dist');
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || !url.pathname.startsWith('/assets/')) {
      outside.push(url.toString());
      await route.abort();
      return;
    }
    const file = resolve(dist, decodeURIComponent(url.pathname.slice('/assets/'.length)));
    if (!file.startsWith(dist + '/')) {
      await route.abort();
      return;
    }
    const contentType = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.svg')
          ? 'image/svg+xml'
          : 'text/html';
    await route.fulfill({
      body: await readFile(file),
      contentType,
      headers: {
        'Content-Security-Policy':
          "default-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  await page.addInitScript(() => {
    const target = window as unknown as {
      RebootNative: unknown;
      nativeTest: { chunks: string[]; expected: number; finished: boolean; maxChars: number };
    };
    target.nativeTest = { chunks: [], expected: 0, finished: false, maxChars: 0 };
    const receipt = (requestId: string, result: unknown) =>
      queueMicrotask(() =>
        window.dispatchEvent(
          new CustomEvent('maze-native-receipt', { detail: { requestId, ok: true, result } }),
        ),
      );
    target.RebootNative = {
      begin: (requestId: string, _id: string, _name: string, bytes: number) => {
        target.nativeTest.expected = bytes;
        receipt(requestId, { sequence: 0 });
      },
      append: (requestId: string, _id: string, sequence: number, base64: string) => {
        target.nativeTest.chunks.push(base64);
        target.nativeTest.maxChars = Math.max(target.nativeTest.maxChars, base64.length);
        receipt(requestId, { sequence });
      },
      finish: (requestId: string) => {
        target.nativeTest.finished = true;
        receipt(requestId, { prepared: true, bytes: target.nativeTest.expected });
      },
      abort: (requestId: string) => receipt(requestId, { aborted: true }),
    };
  });
  await page.goto(`${origin}/assets/index.html`);
  await expect(page.getByRole('heading', { name: 'Библиотека лабиринтов' })).toBeVisible();
  await page.getByRole('button', { name: 'Создать две комнаты' }).click();
  await page.getByRole('button', { name: 'Подготовить попытку' }).waitFor();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Посмотреть', exact: true }).click();
  await page.getByRole('button', { name: 'Сцена 3D' }).click();
  await expect(page.getByLabel('Трёхмерный лабиринт', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Экспорт карты' }).click();
  await page.getByRole('button', { name: 'Поделиться пакетом 1' }).click();
  await expect(page.getByText('Все пакеты записаны и переданы в меню отправки.')).toBeVisible();
  const exported = await page.evaluate(() => {
    const state = (
      window as unknown as {
        nativeTest: { chunks: string[]; expected: number; finished: boolean; maxChars: number };
      }
    ).nativeTest;
    const pieces = state.chunks.map((part) => Uint8Array.from(atob(part), (c) => c.charCodeAt(0)));
    const all = new Uint8Array(pieces.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of pieces) {
      all.set(part, offset);
      offset += part.length;
    }
    return { ...state, source: new TextDecoder().decode(all), bytes: all.length };
  });
  expect(exported.bytes).toBe(exported.expected);
  expect(exported.finished).toBe(true);
  expect(exported.maxChars).toBeLessThanOrEqual(256 * 1024);
  const parsed = parsePackage(exported.source);
  expect(parsed.counts.maps).toBe(1);
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});
