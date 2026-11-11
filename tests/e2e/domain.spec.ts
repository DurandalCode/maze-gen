import { expect, test } from '@playwright/test';
import { documentHashes, hashValue, Random } from '../../src/domain';
import { circleRoom, twoRooms } from '../helpers/maps';
import { controlCatalog } from '../../src/catalog/catalog';

test('Bun and Chromium agree on normalized identity, catalog, and random streams', async ({
  page,
}) => {
  await page.goto('/');
  const documents = [circleRoom(), twoRooms(2, Math.PI / 7)];
  const expected = {
    hashes: documents.map((d) => documentHashes(d)),
    catalogHash: hashValue(controlCatalog()),
    random: Array.from({ length: 1 }, () => {
      const rng = new Random('межплатформенный 🧭');
      return Array.from({ length: 32 }, () => rng.uint32());
    })[0],
  };
  const actual = await page.evaluate(async (documents) => {
    const domainUrl = '/src/domain/index.ts',
      catalogUrl = '/src/catalog/catalog.ts';
    const domain = await import(/* @vite-ignore */ domainUrl),
      catalog = await import(/* @vite-ignore */ catalogUrl);
    const rng = new domain.Random('межплатформенный 🧭');
    return {
      hashes: documents.map((d) => domain.documentHashes(d)),
      catalogHash: domain.hashValue(catalog.controlCatalog()),
      random: Array.from({ length: 32 }, () => rng.uint32()),
    };
  }, documents);
  expect(actual).toEqual(expected);
});
