import { metrics } from '../core/metrics';
import type { Maze } from '../core/maze';
import { cellSize } from '../core/maze';
import { shortestPath } from '../core/pathfinding';
import { prepareNavigation, prepareOutline } from './navigation';
import { decisionModel, decisionScore, choiceProbabilities } from './decision-model';
export interface DecisionDifficulty {
  forks: number;
  ambiguousForks: number;
  credibleDecoys: number;
  expectedWrongChoices: number;
  decoyScore: number;
  mandatoryArea: number;
}
/** Design metric: uses the solution to grade decoys, never supplies it to the walking model. Tree mazes only. */
export function decisionDifficulty(maze: Maze): DecisionDifficulty {
  const m = metrics(maze);
  if (m.components !== 1 || m.cycles !== 0)
    throw new Error('Оценка обманок требует связного дерева проходов.');
  const ctx = prepareNavigation(maze);
  prepareOutline(maze, ctx);
  const model = decisionModel(maze, ctx), path = shortestPath(maze), route = new Set(path);
  let forks = 0, ambiguousForks = 0, credibleDecoys = 0, expectedWrongChoices = 0, decoyScore = 0, mandatoryArea = 0;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i]!, size = cellSize(maze, cell);
    mandatoryArea += size.width * size.depth;
    const next = path[i + 1];
    if (next === undefined)
      continue;
    const previous = path[i - 1], choices = maze.passages[cell]!.filter(n => n !== previous);
    if (choices.length < 2)
      continue;
    forks++;
    const features = choices.map(n => model.features(cell, n, previous === undefined ? undefined : ctx.centers[previous], 'outline'));
    const pPlus = choiceProbabilities(features.map(f => decisionScore(f, 3, 1, 1.5, 1))), pMinus = choiceProbabilities(features.map(f => decisionScore(f, 3, 1, 1.5, -1)));
    const probabilities = pPlus.map((p, j) => (p + pMinus[j]!) / 2), correct = choices.indexOf(next);
    expectedWrongChoices += 1 - probabilities[correct]!;
    let credibleHere = false;
    for (let j = 0; j < choices.length; j++) {
      const wrong = choices[j]!;
      if (wrong === next || route.has(wrong) || features[j]!.exitVisible)
        continue;
      const scale = Math.min(size.width, size.depth), depth = (Math.exp(features[j]!.perspective) - 1) * scale;
      if (depth < 4 || features[j]!.deadEnd || probabilities[j]! < .15)
        continue;
      // A tempting doorway must remain plausible after entering, rather than collapsing immediately.
      let at = wrong, from = cell, steps = 1;
      const seen = new Set([cell, wrong]);
      const alternative = ([1, -1].map(sign => decisionScore(features[correct]!, 3, 1, 1.5, sign)).reduce((a, b) => a + b, 0) / 2);
      while (steps < 6) {
        const onward = maze.passages[at]!.filter(n => !seen.has(n) && !route.has(n));
        if (!onward.length)
          break;
        const ranked = onward.map(n => { const f = model.features(at, n, ctx.centers[from], 'outline'); return { n, f, score: decisionScore(f, 3, 1, 0, 1) }; }).sort((a, b) => b.score - a.score);
        const best = ranked[0]!;
        if (best.f.deadEnd || best.score < alternative - .5 * steps)
          break;
        from = at;
        at = best.n;
        seen.add(at);
        steps++;
      }
      if (steps >= 3) {
        credibleDecoys++;
        credibleHere = true;
        decoyScore += probabilities[j]! * Math.min(6, steps);
      }
    }
    if (credibleHere && probabilities[correct]! < .75)
      ambiguousForks++;
  }
  return { forks, ambiguousForks, credibleDecoys, expectedWrongChoices, decoyScore, mandatoryArea };
}
