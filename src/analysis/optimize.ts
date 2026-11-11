import {optimizeFree,type FreeProfileQuality} from '../free/optimize';
import {optimizeTwoStorey} from './two-storey-optimize';
import {optimizeCorridor} from './corridor-optimize';
import {optimizeLiving} from '../generators/living';
import { optimizePotential } from './potential-optimize';
import type { PotentialDifficulty } from './potential-difficulty';
import { domainOf } from '../core/domain';
import { componentCount } from '../core/graph';
import { metrics } from '../core/metrics';
import { shortestPath } from '../core/pathfinding';
import { transferPortals } from '../core/portals';
import { random } from '../core/random';
import type { Maze } from '../core/maze';
import { generateBase } from '../generators/generate';
import {analyzePotential} from './potential-difficulty';
import {criticalWalls} from './critical-walls';
import { analyzeColdspots, validateAnalysisOptions, type AnalysisOptions } from './coldspots';
import { prepareNavigation, type NavigationContext, type NavigationProfile } from './navigation';
export type OptimizationObjective = 'coldspots' | 'exploration';
export type OptimizationMethod = 'seeds' | 'walls';
export interface OptimizationResult {
  freeQuality?:{before:FreeProfileQuality[];after:FreeProfileQuality[]};
  objective?: OptimizationObjective;
  beforePotential?: PotentialDifficulty;
  afterPotential?: PotentialDifficulty;
  maze: Maze;
  changed: boolean;
  attempted: number;
  accepted: number;
  before: number;
  after: number;
}
const profiles: NavigationProfile[] = ['explorer', 'compass', 'outline'];
function evaluate(maze: Maze, options: AnalysisOptions, context: NavigationContext) {
  const area = domainOf(maze).area;
  const results = profiles.map(profile => analyzeColdspots(maze, { ...options, profile }, context));
  const scores = results.map(result => {
    let unused = 0;
    for (const a of context.cells) {
      const r = domainOf(maze).rectangles[a]!;
      unused += (1 - result.probability[a]!) * (r.x2 - r.x1) * (r.z2 - r.z1);
    }
    return result.coldAreaRatio + 0.5 * result.largestColdArea / area + 0.25 * unused / area;
  });
  return { score: 0.5 * Math.max(...scores) + 0.5 * scores.reduce((a, b) => a + b, 0) / scores.length,
    search: results.reduce((sum, result) => sum + result.searchRatio, 0) / results.length };
}
/** Conservatively retain the baseline unless a candidate improves the ensemble objective. */
export function optimizeColdspots(base: Maze, options: AnalysisOptions, method: OptimizationMethod, attempts = 32, progress?: (done: number, total: number) => void, objective: OptimizationObjective = 'coldspots'): OptimizationResult {
  validateAnalysisOptions(options);
  if (!['seeds', 'walls'].includes(method) || !Number.isInteger(attempts) || attempts < 1 || attempts > 128)
    throw new Error('Некорректные параметры оптимизации.');
  if (!['coldspots', 'exploration'].includes(objective))
    throw new Error('Неизвестная цель подбора.');
  if(base.free){const r=optimizeFree(base,attempts,options.samples,progress);return {maze:r.maze,changed:r.improved,attempted:r.attempted,accepted:r.accepted,before:Math.max(...r.before.map(p=>p.coldRatio)),after:Math.max(...r.after.map(p=>p.coldRatio)),freeQuality:{before:r.before,after:r.after},objective:'coldspots'};}
  if(base.storeys)return optimizeTwoStorey(base,options,method,attempts,progress,objective);
  if(base.parameters.generationType==='corridor')return optimizeCorridor(base,options,attempts,progress,objective);
  if(base.parameters.generationType==='living')return optimizeLiving(base,options,method,attempts,progress,objective);
  if (objective === 'exploration')
    return optimizePotential(base, options, method, attempts, progress);
  if (componentCount(base) !== 1)
    throw new Error('Для оптимизации все клетки должны быть соединены.');
  const context = prepareNavigation(base), initial = metrics(base);
  const protectedWalls=base.parameters.design||((base.parameters.routeTrapCount??0)>0||(base.parameters.loopTrapCount??0)>0)?criticalWalls(base):[];
  const sampled = initial.cycles > 0 || options.beta > 0 || (options.corridorPreference ?? 1) > 0 || (options.boundaryPreference ?? 1.5) > 0;
  const budget = Math.min(attempts, Math.max(2, Math.floor(2000000 / (context.cells.length * (sampled ? 64 : 1)))));
  const rankingOptions = { ...options, samples: Math.min(options.samples, 64) };
  const baseline = evaluate(base, rankingOptions, context);
  const rng = random(`${base.parameters.seed}|coldspots-walls-v1`);
  const pairs: [
    number,
    number
  ][] = [];
  for (const a of context.cells)
    for (const b of context.adjacent[a]!)
      if (b > a)
        pairs.push([a, b]);
  let best = base, bestScore = baseline.score, accepted = 0;
  for (let i = 0; i < budget; i++) {
    let candidate: Maze | null = null;
    if (method === 'seeds') {
      const generated = transferPortals(base, generateBase({ ...base.parameters, seed: `${base.parameters.seed.slice(0, 210)}|coldspots-${i + 1}` }));
      candidate = { ...base, parameters: generated.parameters, passages: generated.passages };
    }
    else {
      const closed = pairs.filter(([a, b]) => !best.passages[a]!.includes(b));
      if (closed.length) {
        const [a, b] = closed[Math.floor(rng() * closed.length)]!, path = shortestPath(best, a, b);
        const cut = Math.floor(rng() * (path.length - 1)), c = path[cut]!, d = path[cut + 1]!;
        const passages = [...best.passages];
        for (const cell of new Set([a, b, c, d]))
          passages[cell] = [...passages[cell]!];
        passages[a]!.push(b);
        passages[b]!.push(a);
        passages[c] = passages[c]!.filter(v => v !== d);
        passages[d] = passages[d]!.filter(v => v !== c);
        for (const cell of new Set([a, b, c, d]))
          passages[cell]!.sort((a, b) => a - b);
        candidate = { ...best, passages };
      }
    }
    if (candidate) {
      const shape = metrics(candidate);
      if (protectedWalls.every(w=>!candidate!.passages[w.a]!.includes(w.b)) && (!(base.parameters.design||((base.parameters.routeTrapCount??0)>0||(base.parameters.loopTrapCount??0)>0))||analyzePotential(candidate,rankingOptions,undefined,false).eligible) && shape.cycles === initial.cycles && shape.junctions >= Math.ceil(initial.junctions * 0.8) && shape.deadEnds >= Math.ceil(initial.deadEnds * 0.8) &&
        shape.optimalLength >= initial.optimalLength * 0.8 && shape.optimalLength <= initial.optimalLength * 1.5) {
        const value = evaluate(candidate, rankingOptions, context);
        if (value.score < bestScore - 1e-9 && value.search >= baseline.search * 0.9) {
          best = candidate;
          bestScore = value.score;
          accepted++;
        }
      }
    }
    progress?.(i + 1, budget);
  }
  // Recheck sampled cyclic candidates at the full requested precision, using common random seeds.
  const before = evaluate(base, options, context), after = evaluate(best, options, context);
  if (base.parameters.design&&!analyzePotential(best,{...options,samples:2048},undefined,false).eligible || after.score >= before.score - 1e-9 || after.search < before.search * 0.9)
    return { maze: base, changed: false, attempted: budget, accepted: 0, before: before.score, after: before.score };
  return { maze: best, changed: true, attempted: budget, accepted, before: before.score, after: after.score };
}
