import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const core = new Set([
  'domain',
  'catalog',
  'geometry',
  'navigation',
  'generation',
  'observation',
  'analysis',
  'session',
  'editor',
]);
const kernelPackages = new Set(['clipper2-ts', 'earcut']);

export function checkSource(path: string, source: string): string[] {
  const errors: string[] = [];
  const isCore = core.has(path.split('/')[1] ?? '');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  function check(specifier: string) {
    const target = specifier.startsWith('.')
      ? relative(process.cwd(), resolve(dirname(path), specifier)).replaceAll('\\', '/')
      : specifier;
    if (/(^|\/)(core|legacy|\.tools|dist|work|android)(\/|$)/.test(target)) {
      errors.push(`${path}: forbidden legacy/artifact import ${specifier}`);
    }
    if (isCore) {
      const layer = target.split('/')[1] ?? '';
      const localCore = target.startsWith('src/') && core.has(layer) && !target.endsWith('.tsx');
      const kernel = path.startsWith('src/geometry/kernel/') && kernelPackages.has(specifier);
      if (!localCore && !kernel) errors.push(`${path}: core dependency forbidden: ${specifier}`);
    }
  }
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      check(node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node)) errors.push(`${path}: import-equals is unsupported`);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) check(argument.text);
      else errors.push(`${path}: computed import is unsupported`);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      check(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return errors;
}

async function scan(directory: string): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) errors.push(...(await scan(path)));
    else if (/\.tsx?$/.test(path)) errors.push(...checkSource(path, await readFile(path, 'utf8')));
  }
  return errors;
}

if (import.meta.main) {
  const errors = await scan('src');
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Import boundaries passed');
}
