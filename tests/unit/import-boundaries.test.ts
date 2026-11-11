import { describe, expect, test } from 'bun:test';
import { checkSource } from '../../scripts/check-imports';

describe('architecture boundaries', () => {
  test('domain can depend on domain contracts', () => {
    expect(
      checkSource('src/domain/document.ts', "export type { Shape } from '../catalog/shape';"),
    ).toEqual([]);
  });
  test.each([
    'react',
    'three',
    '../ui/App',
    '../platform/browser',
    '../core/maze',
    '../../dist/old',
  ])('rejects core dependency %s', (dependency) => {
    expect(checkSource('src/domain/document.ts', `import '${dependency}';`).length).toBeGreaterThan(
      0,
    );
  });
  test('checks dynamic imports, re-exports, and type imports', () => {
    for (const source of [
      "import('three')",
      "export * from 'react'",
      "type T = import('three').Vector3",
      'import(name)',
    ]) {
      expect(checkSource('src/domain/document.ts', source).length).toBeGreaterThan(0);
    }
  });
  test('geometry libraries stay behind the kernel adapter', () => {
    expect(checkSource('src/geometry/kernel/boolean.ts', "import 'clipper2-ts';")).toEqual([]);
    expect(checkSource('src/domain/document.ts', "import 'clipper2-ts';").length).toBeGreaterThan(
      0,
    );
  });
  test('UI may use React but cannot import saved artifacts', () => {
    expect(checkSource('src/ui/main.tsx', "import 'react';")).toEqual([]);
    expect(checkSource('src/ui/main.tsx', "import '../../.tools/legacy';").length).toBeGreaterThan(
      0,
    );
  });
});
