import { canonical, hashValue } from './hash';
import { defaultEnvironment, PHYSICAL_V1, VERSIONS } from './profile';
import { normalizeDocument } from './validate';
import type { Document, Versions } from './types';

export function emptyDocument(id: string, title = 'Новая карта'): Document {
  const points = [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 50, z: 50 },
    { x: 0, z: 50 },
  ];
  return normalizeDocument({
    schemaVersion: 1,
    documentId: id,
    revision: 0,
    site: {
      boundaryLoops: [
        {
          id: 'site',
          role: 'outer',
          segments: points.map((from, i) => ({
            id: `site-${i}`,
            kind: 'line',
            from,
            to: points[(i + 1) % 4],
          })),
        },
      ],
    },
    definitions: [],
    instances: [],
    openings: [],
    connections: [],
    freeWalls: [],
    physicalProfile: { ...PHYSICAL_V1 },
    environment: defaultEnvironment(),
    metadata: {
      title,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    },
  });
}
export function documentHashes(
  value: unknown,
  versions: Versions = VERSIONS,
): { revisionHash: string; layoutHash: string } {
  const d = normalizeDocument(value);
  const physical = {
    schemaVersion: d.schemaVersion,
    site: d.site,
    definitions: d.definitions,
    instances: d.instances,
    openings: d.openings,
    connections: d.connections,
    freeWalls: d.freeWalls,
    physicalProfile: d.physicalProfile,
  };
  return {
    layoutHash: hashValue(physical),
    revisionHash: hashValue({ physical, environment: d.environment, versions }),
  };
}
export function canonicalDocument(value: unknown): string {
  return canonical(normalizeDocument(value));
}
export function worldHash(layoutHash: string, versions: Versions = VERSIONS): string {
  return hashValue([layoutHash, versions.geometry, versions.approximation]);
}
export function navHash(worldHash: string, radius: number, version = VERSIONS.navigation): string {
  return hashValue([worldHash, radius, version]);
}

export function conditionHash(
  environment: Document['environment'],
  settings: {
    speedMps: number;
    inputMode: 'keyboard' | 'touch';
    goalDirectionKnown: boolean;
    siteKnown: boolean;
    previewed: boolean;
    observationProfile: string;
  },
): string {
  return hashValue({ environment, ...settings });
}
