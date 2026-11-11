import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { visualFixture } from '../fixtures/factory';
import scenes from '../../reports/visual/scenes.json' with { type: 'json' };

test('eight fixed visual scenes capture the complete construction profile', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  const results = [];
  await mkdir('test-results/visual-current', { recursive: true });
  for (const scene of scenes.scenes) {
    const document = visualFixture();
    document.environment = {
      wallColor: scene.wallColor,
      roof: scene.roof,
      translucentFabric: scene.translucentFabric,
      sun: scene.sun,
      forest: { ...scene.forest, side: scene.forest.side as 'north' | 'east' | 'south' | 'west' },
    };
    const result = await page.evaluate(
      async ({ document, camera, warmup }) => {
        const compilerUrl = '/src/geometry/compile/compile.ts',
          artifactUrl = '/src/jobs/render-artifacts.ts',
          sceneUrl = '/src/renderer/scene.ts';
        const [{ compileGeometry }, { renderArtifacts }, { WorldScene }] = await Promise.all([
          import(/* @vite-ignore */ compilerUrl),
          import(/* @vite-ignore */ artifactUrl),
          import(/* @vite-ignore */ sceneUrl),
        ]);
        const holder = window as unknown as { captureView?: InstanceType<typeof WorldScene> };
        holder.captureView?.dispose();
        const canvas = window.document.createElement('canvas');
        canvas.style.cssText = 'width:1280px;height:720px;display:block';
        window.document.body.replaceChildren(canvas);
        const compiled = compileGeometry(document);
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
        const view = new WorldScene(canvas);
        holder.captureView = view;
        view.setWorld({ physical: compiled.snapshot, ...renderArtifacts(compiled.snapshot) });
        view.setPreview(camera.position, camera.target);
        for (let i = 0; i < warmup; i++) {
          view.render();
          await new Promise(requestAnimationFrame);
        }
        const gl = view.renderer.getContext(),
          debug = gl.getExtension('WEBGL_debug_renderer_info');
        const material = view.scene.getObjectByName('fabric-panels')?.material;
        return {
          worldHash: compiled.snapshot.worldHash,
          layoutHash: compiled.snapshot.layoutHash,
          physicalSegments: compiled.snapshot.segmentCount,
          solids: compiled.snapshot.solids.length,
          dpr: devicePixelRatio,
          canvas: [canvas.width, canvas.height],
          backend: gl.getParameter(gl.VERSION),
          gpu: debug
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          material: { transparent: material?.transparent, depthWrite: material?.depthWrite },
          calls: view.renderer.info.render.calls,
          triangles: view.renderer.info.render.triangles,
          geometries: view.renderer.info.memory.geometries,
          textures: view.renderer.info.memory.textures,
        };
      },
      { document, camera: scene.camera, warmup: scenes.capture.warmupFrames },
    );
    expect(result.material.transparent).toBe(scene.translucentFabric);
    expect(result.material.depthWrite).toBe(!scene.translucentFabric);
    expect(result.calls).toBeLessThan(40);
    await page.screenshot({ path: `test-results/visual-current/${scene.id}.png` });
    results.push({ id: scene.id, camera: scene.camera, checks: scene.checks, ...result });
  }
  await page.evaluate(() => {
    const w = window as unknown as { captureView?: { dispose: () => void } };
    w.captureView?.dispose();
    delete w.captureView;
  });
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/visual-current/manifest.json',
    JSON.stringify(
      {
        profile: scenes.profile,
        capturedAt: new Date().toISOString(),
        browser: browser.version(),
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model,
        viewport: [1280, 720],
        baseline: 'first-candidate-not-automatically-approved',
        results,
        errors,
      },
      null,
      2,
    ),
  );
});

test('twenty real WebGL open-close cycles release resources and restore lost context', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const cdp = await page.context().newCDPSession(page);
  const rows = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const result = await page.evaluate(
      async ({ document, cycle }) => {
        const compilerUrl = '/src/geometry/compile/compile.ts',
          artifactUrl = '/src/jobs/render-artifacts.ts',
          sceneUrl = '/src/renderer/scene.ts';
        const [{ compileGeometry }, { renderArtifacts }, { WorldScene }] = await Promise.all([
          import(/* @vite-ignore */ compilerUrl),
          import(/* @vite-ignore */ artifactUrl),
          import(/* @vite-ignore */ sceneUrl),
        ]);
        const canvas = window.document.createElement('canvas');
        canvas.style.cssText = 'width:640px;height:360px';
        window.document.body.replaceChildren(canvas);
        const compiled = compileGeometry(document);
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
        const contexts: string[] = [];
        const waitEvent = (name: string) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Cycle ${cycle}: timeout waiting ${name}; events=${contexts.join(',')}`,
                  ),
                ),
              4000,
            );
            canvas.addEventListener(
              name,
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        const view = new WorldScene(canvas, (state: string) => contexts.push(state));
        view.setWorld({ physical: compiled.snapshot, ...renderArtifacts(compiled.snapshot) });
        view.start();
        await new Promise(requestAnimationFrame);
        view.stop();
        if (cycle === 0) {
          const extension = view.renderer.getContext().getExtension('WEBGL_lose_context');
          if (!extension) throw new Error('Context loss extension unavailable');
          const lost = waitEvent('webglcontextlost');
          extension.loseContext();
          await lost;
          await new Promise((resolve) => setTimeout(resolve, 100));
          const restored = waitEvent('webglcontextrestored');
          view.restore();
          await restored;
          canvas.style.width = '320px';
          canvas.style.height = '640px';
          view.resize();
          view.render();
          if (view.camera.aspect !== 0.5) throw new Error('Resize aspect mismatch');
        }
        const used = { ...view.renderer.info.memory };
        view.dispose();
        const disposed = { ...view.renderer.info.memory };
        canvas.remove();
        return { used, disposed, contexts };
      },
      { document: visualFixture(), cycle },
    );
    expect(result.used.geometries).toBeGreaterThan(0);
    expect(result.disposed).toEqual({ geometries: 0, textures: 0 });
    if (cycle === 0) expect(result.contexts).toEqual(['lost', 'restored']);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    rows.push({ cycle, ...result, heapBytes: heap.usedSize });
  }
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const first = median(rows.slice(0, 5).map((r) => r.heapBytes)),
    last = median(rows.slice(-5).map((r) => r.heapBytes));
  expect(last).toBeLessThanOrEqual(first * 1.1);
  await writeFile(
    'test-results/webgl-lifecycle.json',
    JSON.stringify(
      { firstMedianBytes: first, lastMedianBytes: last, ratio: last / first, rows },
      null,
      2,
    ),
  );
});
