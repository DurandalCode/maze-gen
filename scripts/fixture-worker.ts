import { documentHashes, hashValue, VERSIONS } from '../src/domain';
import type { Document } from '../src/domain';
import { compileGeometry } from '../src/geometry/compile/compile';
import { buildNavigation } from '../src/navigation/navmesh';
export function verifyFixture(
  id: string,
  document: Document,
  stage: (name: string) => void = () => {},
) {
  stage('compile');
  const start = performance.now(),
    compiled = compileGeometry(document),
    compileMs = performance.now() - start;
  stage('navigation');
  const navStart = performance.now(),
    navigation = compiled.ok ? buildNavigation(compiled.snapshot) : null,
    navMs = performance.now() - navStart;
  const expectedError =
    id === 'F-04-width-099' ? 'WIDTH' : id === 'F-03-corner-touch' ? 'UNREACHABLE' : null;
  const expectedCycles =
    id === 'F-05-ring' || id === 'F-03-hole' || id === 'F-03-island'
      ? 1
      : id === 'F-05-two-cycles'
        ? 2
        : 0;
  const pass = expectedError
    ? (!compiled.ok
        ? compiled.diagnostics[0]?.code
        : navigation && !navigation.ok
          ? navigation.diagnostics[0]?.code
          : null) === expectedError
    : compiled.ok && navigation?.ok && navigation.snapshot.semantic.cycles === expectedCycles;
  const entry = {
    id,
    status: pass ? 'pass' : 'fail',
    expectedError,
    expectedCycles,
    hashes: documentHashes(document),
    versions: VERSIONS,
    instances: document.instances.length,
    definitions: document.definitions.map((d) => ({
      id: d.id,
      count: document.instances.filter((i) => i.definitionHash === d.contentHash).length,
    })),
    compileMs,
    navMs,
    ...(compiled.ok
      ? {
          physicalSegments: compiled.snapshot.segmentCount,
          solids: compiled.snapshot.solids.length,
          quantities: compiled.snapshot.quantities,
        }
      : { diagnostics: compiled.diagnostics }),
    ...(navigation?.ok
      ? {
          navHash: navigation.snapshot.navHash,
          triangles: navigation.snapshot.triangles.length,
          cycles: navigation.snapshot.semantic.cycles,
          route: navigation.snapshot.referenceRoute,
          routeHash: hashValue(navigation.snapshot.referenceRoute),
          routeLengthM: navigation.snapshot.referenceLengthM,
        }
      : navigation
        ? { navigationDiagnostics: navigation.diagnostics }
        : {}),
  };
  return entry;
}
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: string; document: Document }>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = (event) => {
  try {
    const result = verifyFixture(event.data.id, event.data.document, (stage) =>
      scope.postMessage({ kind: 'stage', stage }),
    );
    scope.postMessage({ kind: 'result', result });
  } catch (error) {
    scope.postMessage({
      kind: 'result',
      result: {
        id: event.data.id,
        status: 'fail',
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
