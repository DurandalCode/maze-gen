import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  canonical,
  canonicalDocument,
  documentHashes,
  DomainError,
  emptyDocument,
  hashValue,
  LIMITS,
  normalizeDocument,
  Random,
  sha256,
  variantSeed,
} from '../../src/domain';
import {
  controlCatalog,
  instantiate,
  validateCatalogDefinition,
  withCatalog,
} from '../../src/catalog/catalog';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const reference = (value: string) => createHash('sha256').update(value).digest('hex');
function errorCode(run: () => unknown): string {
  try {
    run();
    throw new Error('Expected rejection');
  } catch (error) {
    if (error instanceof DomainError) return error.diagnostic.code;
    throw error;
  }
}
function map() {
  const d = withCatalog(emptyDocument('test'));
  d.instances = [instantiate(d.definitions.find((x) => x.id === 'square-2x2')!, 'room')];
  return d;
}

describe('canonical identity and independent digest vectors', () => {
  test.each(['', 'abc', 'a'.repeat(1000), 'ёж 🧭\ud800'])('SHA-256 matches Node crypto', (value) =>
    expect(sha256(value)).toBe(reference(value)),
  );
  test('published SHA-256 abc vector', () =>
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
  test('key ordering is not locale dependent; array order remains significant', () => {
    expect(canonical({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
    expect(() => canonical({ invalid: undefined })).toThrow();
    expect(() => canonical(NaN)).toThrow();
  });
  test('canonical round-trip and independent object ordering', () => {
    const d = map();
    const a = canonicalDocument(d);
    expect(canonicalDocument(JSON.parse(a))).toBe(a);
    d.definitions.reverse();
    expect(canonicalDocument(d)).toBe(a);
  });
  test('metadata, IDs of documents, and command revision do not change hashes', () => {
    const d = map(),
      before = documentHashes(d);
    d.metadata.title = 'Другое имя';
    d.documentId = 'another';
    d.revision = Number.MAX_SAFE_INTEGER;
    d.metadata.updatedAt = '2026-11-11T00:00:00Z';
    expect(documentHashes(d)).toEqual(before);
  });
  test('visual change invalidates revision only; physical change invalidates layout', () => {
    const d = map(),
      before = documentHashes(d);
    d.environment.wallColor = '#abcdef';
    expect(documentHashes(d).layoutHash).toBe(before.layoutHash);
    expect(documentHashes(d).revisionHash).not.toBe(before.revisionHash);
    d.instances[0]!.position.x = 1;
    expect(documentHashes(d).layoutHash).not.toBe(before.layoutHash);
  });
  test('quantization, negative zero, and immutable input', () => {
    const d = map();
    d.instances[0]!.position = { x: -0, z: 1.12345649 };
    d.instances[0]!.rotationRad = 1.1234567894;
    const before = JSON.stringify(d),
      normalized = normalizeDocument(d);
    expect(Object.is(normalized.instances[0]!.position.x, -0)).toBe(false);
    expect(normalized.instances[0]!.position.z).toBe(1.123456);
    expect(normalized.instances[0]!.rotationRad).toBe(1.123456789);
    expect(JSON.stringify(d)).toBe(before);
    expect(Object.is(d.instances[0]!.position.x, -0)).toBe(true);
  });
});
describe('untrusted document validation', () => {
  test.each([NaN, Infinity, -Infinity])('non-finite number %s', (n) => {
    const d = map();
    d.instances[0]!.position.x = n;
    expect(errorCode(() => normalizeDocument(d))).toBe('NON_FINITE');
  });
  test('duplicate instance IDs rejected before use', () => {
    const d = map();
    d.instances.push(clone(d.instances[0]!));
    expect(errorCode(() => normalizeDocument(d))).toBe('DUPLICATE_ID');
  });
  test('missing references and unknown fields rejected', () => {
    const d = map();
    d.instances[0]!.definitionHash = 'f'.repeat(64);
    expect(errorCode(() => normalizeDocument(d))).toBe('MISSING_REFERENCE');
    expect(errorCode(() => normalizeDocument({ ...map(), code: 'eval' }))).toBe('UNKNOWN_FIELD');
  });
  test('unknown primitive fails explicitly', () => {
    const d = map();
    (d.site.boundaryLoops[0]!.segments[0] as unknown as { kind: string }).kind = 'bezier';
    expect(errorCode(() => normalizeDocument(d))).toBe('UNSUPPORTED_PRIMITIVE');
  });
  test('definition corruption is rejected rather than silently rehashed', () => {
    const d = map();
    d.definitions[0]!.constructionProfile.maxSpanM = 2;
    expect(errorCode(() => normalizeDocument(d))).toBe('HASH_MISMATCH');
  });
  test('no geometry migration and no unknown profiles', () => {
    const d = map();
    expect(errorCode(() => normalizeDocument({ ...d, schemaVersion: 5 }))).toBe(
      'UNSUPPORTED_SCHEMA',
    );
    expect(
      errorCode(() =>
        normalizeDocument({ ...d, physicalProfile: { ...d.physicalProfile, id: 'legacy' } }),
      ),
    ).toBe('UNSUPPORTED_PROFILE');
  });
  test('array limit is checked before parsing entries', () => {
    const d = map();
    expect(
      errorCode(() =>
        normalizeDocument({ ...d, instances: Array(LIMITS.instances + 1).fill(null) }),
      ),
    ).toBe('RESOURCE_LIMIT');
  });
  test('invalid parameter names and out-of-range values fail', () => {
    const d = map();
    d.instances[0]!.parameterValues.bad = 10;
    expect(errorCode(() => normalizeDocument(d))).toBe('UNKNOWN_PARAMETER');
    delete d.instances[0]!.parameterValues.bad;
    d.instances[0]!.parameterValues.width = 100;
    expect(errorCode(() => normalizeDocument(d))).toBe('RANGE');
  });
  test('topological segment order is not sorted', () => {
    const d = map();
    const loop = d.site.boundaryLoops[0]!;
    loop.segments = [...loop.segments.slice(1), loop.segments[0]!];
    expect(normalizeDocument(d).site.boundaryLoops[0]!.segments[0]!.id).toBe('site-1');
  });
});
describe('versioned random streams', () => {
  test('xoshiro128** fixed state vectors', () => {
    const rng = new Random([1, 2, 3, 4]);
    expect(Array.from({ length: 5 }, () => rng.uint32())).toEqual([
      11520, 0, 5927040, 70819200, 2031721883,
    ]);
  });
  test('zero state replacement and resume', () => {
    const rng = new Random([0, 0, 0, 0]);
    expect(rng.snapshot()).toEqual([1, 0, 0, 0]);
    rng.next();
    const resumed = new Random(rng.snapshot());
    expect(resumed.uint32()).toBe(rng.uint32());
  });
  test('NFC seed and independently reconstructed digest seed bytes', () => {
    expect(new Random('e\u0301').snapshot()).toEqual(new Random('é').snapshot());
    const bytes = Buffer.from(reference('test'), 'hex');
    expect(new Random('test').snapshot()).toEqual([0, 4, 8, 12].map((i) => bytes.readUInt32LE(i)));
  });
  test('variant streams do not depend on variant count', () => {
    expect(variantSeed('abc', 'v1', 2, 0)).toBe(reference('["abc","v1",2,0]'));
    expect(variantSeed('abc', 'v1', 2, 0)).not.toBe(variantSeed('abc', 'v1', 2, 1));
  });
});
