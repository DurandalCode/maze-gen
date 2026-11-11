import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem, platform, release } from 'node:os';
import { canonicalDocument, compareId, hashValue } from '../src/domain';
import type { Document } from '../src/domain';
import { fixtures } from '../tests/fixtures/factory';
async function sourceDigest(): Promise<string> {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
  }
  for (const directory of ['src', 'scripts', 'tests', 'public']) await visit(directory);
  files.push(
    'package.json',
    'bun.lock',
    'tsconfig.json',
    'tsconfig.core.json',
    'vite.config.ts',
    'playwright.config.ts',
  );
  files.sort(compareId);
  const digests = [];
  for (const file of files)
    digests.push([
      file,
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    ]);
  return hashValue(digests);
}
async function run(id: string, document: Document): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./fixture-worker.ts', import.meta.url).href, {
      type: 'module',
    });
    let stage = 'startup',
      done = false;
    const finish = (result: Record<string, unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ id, status: 'timeout', stage, timeoutMs: 60_000 }),
      60_000,
    );
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.kind === 'stage') {
        stage = message.stage;
        if (id.startsWith('M-')) console.log(JSON.stringify({ id, stage }));
      } else if (message.kind === 'result') finish(message.result);
    };
    worker.onerror = (event) => finish({ id, status: 'fail', stage, error: event.message });
    worker.postMessage({ id, document });
  });
}
const filter = process.argv.slice(2),
  all = fixtures();
for (const id of filter) if (!(id in all)) throw new Error(`Unknown fixture ${id}`);
const sourceHash = await sourceDigest(),
  generatedAt = new Date().toISOString();
await mkdir('reports/fixtures', { recursive: true });
const report: Record<string, unknown>[] = [];
const device = {
  os: platform(),
  release: release(),
  cpu: cpus()[0]?.model,
  ramBytes: totalmem(),
  runtime: Bun.version,
};
for (const [id, document] of Object.entries(all)) {
  if (filter.length && !filter.includes(id)) continue;
  await writeFile(`reports/fixtures/${id}.document.json`, canonicalDocument(document) + '\n');
  const result = await run(id, document);
  report.push(result);
  console.log(
    JSON.stringify({
      id,
      status: result.status,
      compileMs: result.compileMs,
      navMs: result.navMs,
      diagnostics: result.diagnostics ?? result.navigationDiagnostics ?? result.error,
      stage: result.stage,
    }),
  );
  await writeFile(
    'reports/fixtures/results.json',
    JSON.stringify({ generatedAt, sourceHash, device, fixtures: report }, null, 2) + '\n',
  );
  if (result.status !== 'pass') process.exitCode = 1;
}
const unchanged = sourceHash === (await sourceDigest());
await writeFile(
  'reports/fixtures/results.json',
  JSON.stringify(
    { generatedAt, sourceHash, sourceUnchangedDuringRun: unchanged, device, fixtures: report },
    null,
    2,
  ) + '\n',
);
if (!unchanged) {
  console.error('Source changed while fixtures were running');
  process.exitCode = 1;
}
