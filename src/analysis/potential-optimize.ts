import type { Maze } from '../core/maze';
import { metrics } from '../core/metrics';
import { shortestPath } from '../core/pathfinding';
import { random } from '../core/random';
import { guardedMaze, edgeKey } from '../generators/guarded';
import {routeTrapCandidates} from '../generators/route-trap-candidates';
import {pRouteTrapMaze} from '../generators/p-route-trap';
import { analyzePotential } from './potential-difficulty';
import type { AnalysisOptions } from './coldspots';
import type { OptimizationMethod, OptimizationResult } from './optimize';
export function optimizePotential(base: Maze, options: AnalysisOptions, method: OptimizationMethod, attempts: number, progress?: (done: number, total: number) => void): OptimizationResult {
  const initial = metrics(base);
  if (initial.cycles !== 0 || initial.components !== 1)
    throw new Error('Прогноз сложности и скрытые проёмы пока поддерживают связные деревья проходов.');
  const finalOptions=base.parameters.design?{...options,samples:2048}:options;
  const before = analyzePotential(base, finalOptions, undefined, false), prepared = guardedMaze(base, base.parameters.seed + '|privacy', true);
  const budget = Math.min(attempts, Math.max(2, Math.floor(2000000 / (initial.cells * 64 * 3))));
  const ranking = { ...options, samples: Math.min(64, options.samples) }, rng = random(base.parameters.seed + '|potential-v1');
  const acceptable = (maze: Maze) => { const m = metrics(maze); return m.components === 1 && m.cycles === 0; };
  let best: Maze | undefined, bestScore = -Infinity, accepted = 0;
  const consider = (maze: Maze) => { if (!acceptable(maze))
    return; const value = analyzePotential(maze, ranking, undefined, false); if (value.eligible && value.score! > bestScore) {
    best = maze;
    bestScore = value.score!;
    accepted++;
  } };
  consider(prepared.maze);
  if((base.parameters.routeTrapCount??0)>0)
    for(const maze of routeTrapCandidates(prepared.maze,prepared.constraints,options.maxForcedStraight??12,options.maxForcedRun??20,Math.min(12,budget)))consider(maze);
  for (let i = 0; i < budget; i++) {
    if((base.parameters.routeTrapCount??0)>0){
      const constructed=pRouteTrapMaze(base,`${base.parameters.seed.slice(0,160)}|P-trap-${i+1}`);
      if(constructed)consider(constructed);
    }
    if (method === 'seeds')
      consider(guardedMaze(base, `${base.parameters.seed.slice(0, 200)}|potential-${i + 1}`).maze);
    else {
      const current = best ?? prepared.maze, guard = prepared.constraints, closed = guard.allowed.filter(([a, b]) => !current.passages[a]!.includes(b));
      if (closed.length) {
        const [a, b] = closed[Math.floor(rng() * closed.length)]!, path = shortestPath(current, a, b), cuts = path.slice(1).map((d, j) => [path[j]!, d] as [
          number,
          number
        ]).filter(([c, d]) => !guard.locked.has(edgeKey(c, d)));
        if (cuts.length) {
          const [c, d] = cuts[Math.floor(rng() * cuts.length)]!, passages = [...current.passages];
          for (const cell of new Set([a, b, c, d]))
            passages[cell] = [...passages[cell]!];
          passages[a]!.push(b);
          passages[b]!.push(a);
          passages[c] = passages[c]!.filter(n => n !== d);
          passages[d] = passages[d]!.filter(n => n !== c);
          for (const cell of new Set([a, b, c, d]))
            passages[cell]!.sort((x, y) => x - y);
          consider({ ...current, passages });
        }
      }
    }
    progress?.(i + 1, budget);
  }
  if (!best)
    return { maze: base, changed: false, attempted: budget, accepted: 0, before: before.score ?? 0, after: before.score ?? 0, objective: 'exploration', beforePotential: before, afterPotential: before };
  const after = analyzePotential(best, finalOptions, undefined, false);
  const differs = JSON.stringify(base.passages.map(ns => [...ns].sort((a, b) => a - b))) !== JSON.stringify(best.passages);
  if (!after.eligible || before.eligible && after.score! <= before.score! + 1e-9 || !differs)
    return { maze: base, changed: false, attempted: budget, accepted: 0, before: before.score ?? 0, after: before.score ?? 0, objective: 'exploration', beforePotential: before, afterPotential: before };
  return { maze: best, changed: true, attempted: budget, accepted, before: before.score ?? 0, after: after.score!, objective: 'exploration', beforePotential: before, afterPotential: after };
}
