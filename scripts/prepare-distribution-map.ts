import {mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {deepStrictEqual} from 'node:assert';
import {generate} from '../src/generators/generate';
import {generateCorridor} from '../src/generators/corridor';
import {domainOf} from '../src/core/domain';
import {metrics} from '../src/core/metrics';
import {type Parameters} from '../src/core/maze';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';
import {contourQuality} from '../src/generators/contours';
import {serialize, deserialize} from '../src/persistence/maze-json';

const [kind, seed, columns, rows, file, ...flags] = Bun.argv.slice(2);
if (!['classical', 'living', 'corridor'].includes(kind ?? '') || !seed || !columns || !rows || !file)
  throw Error('Usage: bun scripts/prepare-distribution-map.ts classical|living|corridor SEED COLUMNS ROWS OUTPUT.json');
if (!file.toLowerCase().endsWith('.json')) throw Error('Output filename must end in .json.');
const options = new Map(flags.map(flag => {
  const match = /^--(route-traps|loop-traps|cycles|min-modules|max-modules|cutout|shape-file)=(.+)$/.exec(flag);
  if (!match) throw Error(`Unknown option: ${flag}`);
  return [match[1]!, match[2]!] as const;
}));
const routeMinimum = Number(options.get('route-traps') ?? 2);
const loopMinimum = Number(options.get('loop-traps') ?? 2);
const minModules = Number(options.get('min-modules') ?? 70);
const maxModules = Number(options.get('max-modules') ?? 75);
if (![minModules, maxModules].every(Number.isInteger) || minModules < 1 || maxModules < minModules)
  throw Error('Invalid module count range.');
const parameters: Parameters = {
  generationType: kind as Parameters['generationType'], placementMode: 'grid',
  columns: Number(columns), rows: Number(rows), moduleSize: 2, corridorWidth: 2,
  algorithm: 'backtracker', seed,
  extraConnections: Number(options.get('cycles') ?? process.env.MAZE_CYCLES ?? Math.max(2, loopMinimum)),
  routeTrapCount: routeMinimum, loopTrapCount: loopMinimum,
};
if (options.has('cutout')) {
  const match = /^(\d+)x(\d+)$/.exec(options.get('cutout')!);
  if (!match || kind === 'corridor') throw Error('Cutout must be WxH modules for a grid type.');
  const width = Number(match[1]), height = Number(match[2]);
  parameters.shape = {kind: 'grid-rectangles', rectangles: [
    {x: 0, z: 0, width: parameters.columns, height: parameters.rows, operation: 'add'},
    {x: parameters.columns - width, z: 0, width, height, operation: 'subtract'},
  ]};
}
if (options.has('shape-file')) {
  if (options.has('cutout')) throw Error('Choose either --cutout or --shape-file.');
  parameters.shape = await Bun.file(options.get('shape-file')!).json();
}
let lastProgress = 0;
const progress = (message: string) => {
  if (performance.now() - lastProgress > 4000) { console.log(message); lastProgress = performance.now(); }
};
const maze = kind === 'corridor'
  ? generateCorridor(parameters, undefined, progress, Date.now() + 60000)
  : generate(parameters, undefined, progress);
maze.roof = true;
// The reader normalizes legacy defaults and parameter key order before export.
const raw = serialize(deserialize(serialize(maze))), restored = deserialize(raw);
const modules = restored.layout?.modules.length ?? domainOf(restored).modules.reduce((a, b) => a + b, 0);
const structure = metrics(restored), route = routeTraps(restored), loop = loopTraps(restored);
const privacy = mazePortalPrivacy(restored, false);
const contours = kind === 'living' ? contourQuality(restored) : undefined;
const report = {
  kind, parameters: restored.parameters, modules,
  squareModules: restored.layout?.modules.filter(m => m.type === '2x2').length ?? modules,
  longModules: restored.layout?.modules.filter(m => m.type === '2x6').length ?? 0,
  width: restored.width, depth: restored.depth, roof: restored.roof,
  area: structure.area, components: structure.components, cycles: structure.cycles,
  routeTraps: route.qualifiedCount, loopTraps: loop.qualifiedCount,
  entranceSide: restored.entrance.side, exitSide: restored.exit.side,
  portalPrivacy: privacy.certified, ...(contours ? {contours} : {}),
  sha256: createHash('sha256').update(raw).digest('hex'),
};
console.log(JSON.stringify(report, null, 2));
if (modules < minModules || modules > maxModules) throw Error(`Expected ${minModules}–${maxModules} physical modules, got ${modules}.`);
if (structure.components !== 1 || !structure.reachable || structure.cycles !== parameters.extraConnections)
  throw Error('Connectivity or cycle count failed.');
if (route.qualifiedCount < routeMinimum || loop.qualifiedCount < loopMinimum) throw Error('Requested trap counts must qualify after JSON import.');
if (contours && !contours.certified) throw Error('Living contour style failed.');
if (restored.entrance.side !== 'west' || restored.exit.side !== 'east') throw Error('Expected opposite external portals.');
deepStrictEqual(deserialize(serialize(restored)), restored, 'JSON round trip changed the map.');
const target = resolve(file);
await mkdir(dirname(target), {recursive: true});
await Bun.write(target, raw);
await Bun.write(target.replace(/\.json$/i, '.validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Saved ${target}`);
