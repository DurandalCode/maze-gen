import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { documentHashes, VERSIONS } from '../../src/domain';
import { mixedFixture, m50, m100 } from '../fixtures/factory';

test('PERF-03: 1000 editor pointer previews stay below 100 ms on three fixed sizes while compute is busy', async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.MAZE_LARGE_PERF !== '1',
    'Large M-50/M-100 acceptance is deferred in the web prototype scope; opt in with MAZE_LARGE_PERF=1.',
  );
  test.setTimeout(120_000);
  const fixtures = [
    { id: 'F-02', document: mixedFixture() },
    { id: 'M-50', document: m50() },
    { id: 'M-100', document: m100() },
  ];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.evaluate(async (fixtures) => {
    const repoUrl = '/src/repository/repository.ts',
      domainUrl = '/src/domain/index.ts';
    const [{ MazeRepository }, { documentHashes, VERSIONS }] = await Promise.all([
      import(/* @vite-ignore */ repoUrl),
      import(/* @vite-ignore */ domainUrl),
    ]);
    const repo = await MazeRepository.open();
    try {
      for (const fixture of fixtures) {
        fixture.document.metadata.title = fixture.id;
        await repo.saveMap(
          {
            document: fixture.document,
            revisionHash: documentHashes(fixture.document).revisionHash,
            versions: VERSIONS,
            validationSummary: { ready: true, diagnostics: [] },
          },
          `perf-${fixture.id}`,
          fixture.id,
        );
      }
    } finally {
      repo.close();
    }
  }, fixtures);
  const rows = [];
  for (const fixture of fixtures) {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Библиотека лабиринтов' })).toBeVisible();
    await page.evaluate(async (document) => {
      const serviceUrl = '/src/ui/services.ts',
        rendererUrl = '/src/renderer/editor-plan.ts';
      const [{ compute }, { observeEditorPaint }] = await Promise.all([
        import(/* @vite-ignore */ serviceUrl),
        import(/* @vite-ignore */ rendererUrl),
      ]);
      const harness = {
        latencies: [] as number[],
        unsubscribe: () => {},
        job: compute.submit('perf-busy', document.revision, 'compile', { document }),
      };
      harness.unsubscribe = observeEditorPaint((input: number, paint: number) =>
        harness.latencies.push(paint - input),
      );
      (window as unknown as { editorPerf: typeof harness }).editorPerf = harness;
    }, fixtures[2]!.document);
    const hash = documentHashes(fixture.document).revisionHash;
    const row = page
      .getByRole('region', { name: 'Список карт' })
      .getByRole('article')
      .filter({ hasText: hash.slice(0, 8) });
    await row.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const canvas = page.getByLabel('План редактора', { exact: true });
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const selected =
      fixture.document.instances.find(
        (i) => i.parameterValues.width === 2 && i.parameterValues.depth === 2,
      ) ?? fixture.document.instances[0]!;
    const center = await page.evaluate(async (point) => {
      const url = '/src/renderer/editor-plan.ts';
      const { getEditorPlan } = await import(/* @vite-ignore */ url),
        view = getEditorPlan(document.querySelector('[aria-label="План редактора"]'));
      if (!view) throw new Error('Editor plan missing');
      view.focusPoint(point, 50);
      for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
      return view.clientPoint(point);
    }, selected.position);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    const measured = await page.evaluate(async (center) => {
      const harness = (
        window as unknown as { editorPerf: { latencies: number[]; job: { state: () => string } } }
      ).editorPerf;
      const canvas = document.querySelector('[aria-label="План редактора"]')!;
      const busyBefore = harness.job.state();
      for (let batch = 0; batch < 250; batch++) {
        await new Promise(requestAnimationFrame);
        for (let item = 0; item < 4; item++) {
          const i = batch * 4 + item;
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              pointerId: 1,
              pointerType: 'mouse',
              buttons: 1,
              clientX: center.x + Math.sin(i * 0.017) * 20,
              clientY: center.y + Math.cos(i * 0.013) * 12,
            }),
          );
        }
      }
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return {
        busyBefore,
        busyAfter: harness.job.state(),
        latencies: [...harness.latencies],
        dpr: devicePixelRatio,
      };
    }, center);
    await page.mouse.up();
    const cleanup = await page.evaluate(async () => {
      const url = '/src/renderer/editor-plan.ts';
      const { getEditorPlan } = await import(/* @vite-ignore */ url);
      const view = getEditorPlan(document.querySelector('[aria-label="План редактора"]'));
      const harness = (
        window as unknown as {
          editorPerf: { unsubscribe: () => void; job: { cancel: () => void } };
        }
      ).editorPerf;
      harness.unsubscribe();
      harness.job.cancel();
      return view.store.historyStats();
    });
    const sorted = [...measured.latencies].sort((a, b) => a - b),
      p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!,
      median = sorted[Math.floor(sorted.length / 2)]!;
    rows.push({
      id: fixture.id,
      revisionHash: hash,
      layoutHash: documentHashes(fixture.document).layoutHash,
      instances: fixture.document.instances.length,
      connections: fixture.document.connections.length,
      syntheticPointerMoves: 1000,
      eventsPerAnimationFrame: 4,
      method:
        'real canvas pointerdown/up + 1000 paced DOM PointerEvents; event.timeStamp to canvas submission in requestAnimationFrame',
      ...measured,
      p95Ms: p95,
      medianMs: median,
      maxMs: Math.max(...sorted),
      history: cleanup,
    });
    expect(measured.busyBefore).toBe('running');
    expect(measured.busyAfter).toBe('running');
    expect(measured.latencies.length).toBeGreaterThanOrEqual(1000);
    expect(p95).toBeLessThanOrEqual(100);
    expect(cleanup.undo).toBe(1);
    await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Библиотека лабиринтов' })).toBeVisible();
  }
  await mkdir('reports/performance', { recursive: true });
  await writeFile(
    'reports/performance/editor-pointer.json',
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        browser: browser.version(),
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model,
        viewport: [1440, 1000],
        versions: VERSIONS,
        criterion: 'PERF-03 p95 <=100 ms',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
});
