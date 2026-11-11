import { expect, test } from '@playwright/test';
import { visualFixture } from '../fixtures/factory';
const screenshot = process.env.MAZE_SCREENSHOT ?? 'test-results/visual-preview.png';
test('physical world renders fabric, frame, roof, landmarks and releases GPU resources', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  const result = await page.evaluate(async (document) => {
    const compilerUrl = '/src/geometry/compile/compile.ts',
      artifactsUrl = '/src/jobs/render-artifacts.ts',
      sceneUrl = '/src/renderer/scene.ts';
    const [{ compileGeometry }, { renderArtifacts }, { WorldScene }] = await Promise.all([
      import(/* @vite-ignore */ compilerUrl),
      import(/* @vite-ignore */ artifactsUrl),
      import(/* @vite-ignore */ sceneUrl),
    ]);
    const compiled = compileGeometry(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const canvas = window.document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:720px;display:block';
    window.document.body.replaceChildren(canvas);
    const view = new WorldScene(canvas);
    view.setWorld({ physical: compiled.snapshot, ...renderArtifacts(compiled.snapshot) });
    view.setPreview([11, 8, 11], [0, 1.2, 1]);
    for (let i = 0; i < 10; i++) {
      view.render();
      await new Promise(requestAnimationFrame);
    }
    const names: string[] = [];
    view.scene.traverse((object: { name: string }) => {
      if (object.name) names.push(object.name);
    });
    (window as unknown as { testView: unknown }).testView = view;
    return {
      names,
      info: {
        geometries: view.renderer.info.memory.geometries,
        textures: view.renderer.info.memory.textures,
        calls: view.renderer.info.render.calls,
      },
    };
  }, visualFixture());
  await page.screenshot({ path: screenshot });
  expect(result.names).toEqual(
    expect.arrayContaining([
      'fabric-panels',
      'timber-boards',
      'frame-fasteners',
      'physical-roof',
      'forest-landmark',
      'sun-disc',
    ]),
  );
  expect(result.info.geometries).toBeGreaterThan(0);
  expect(result.info.textures).toBeGreaterThan(0);
  expect(result.info.calls).toBeLessThan(40);
  expect(errors).toEqual([]);
  const disposed = await page.evaluate(() => {
    const view = (
      window as unknown as {
        testView: {
          dispose: () => void;
          renderer: { info: { memory: { geometries: number; textures: number } } };
        };
      }
    ).testView;
    view.dispose();
    return view.renderer.info.memory;
  });
  expect(disposed.geometries).toBe(0);
  expect(disposed.textures).toBe(0);
});
