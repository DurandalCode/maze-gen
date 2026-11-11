import { expect, test } from '@playwright/test';
import { documentHashes, VERSIONS } from '../../src/domain';
import { twoRooms } from '../helpers/maps';
test('storage worker persists map across terminate/reopen and list uses summaries', async ({
  page,
}) => {
  await page.goto('/');
  const document = twoRooms(),
    revision = {
      document,
      revisionHash: documentHashes(document).revisionHash,
      versions: VERSIONS,
      validationSummary: { ready: true, diagnostics: [] },
    };
  const result = await page.evaluate(async (revision) => {
    const url = '/src/jobs/clients.ts',
      { storageJobs } = await import(/* @vite-ignore */ url);
    let jobs = storageJobs();
    const saved = await jobs.submit('save', revision.document.revision, 'save', {
      revision,
      projectId: 'browser-project',
      title: 'Тестовая карта',
    }).result;
    jobs.dispose();
    jobs = storageJobs();
    const listed = await jobs.submit('list', null, 'list', { kind: 'maps' }).result,
      loaded = await jobs.submit('get', null, 'get', { kind: 'map', hash: revision.revisionHash })
        .result;
    jobs.dispose();
    return {
      saved: saved.state,
      list: listed.payload,
      loaded: loaded.payload.revisionHash,
      loadState: loaded.state,
    };
  }, revision);
  expect(result.saved).toBe('completed');
  expect(result.list.items).toHaveLength(1);
  expect(result.list.items[0].title).toBe('Тестовая карта');
  expect(result.loaded).toBe(revision.revisionHash);
  expect(result.loadState).toBe('completed');
});
