import { assessExploration, type WalkExploration } from './walk-exploration';
import type { Maze, Point } from '../core/maze';
import { domainOf } from '../core/domain';
import { pathLength, routePoints } from '../core/pathfinding';
import { cellAtPoint, prepareNavigation } from './navigation';
import { viewCorridor } from './corridor-view';
import type { Sample } from '../simulation/recorder';
export interface WalkAssessment {
  exploration: WalkExploration | null;
  distance: number;
  optimalLength: number;
  ratio: number | null;
  coveredAreaRatio: number;
  decisionCount: number;
  comparableCorridorChoices: number;
  longestCorridorChoices: number;
  continuedStraight: number;
  interpretation: 'movement-only';
}
export function assessWalk(maze: Maze, samples: readonly Sample[], distance: number, finished = false): WalkAssessment {
  const context = prepareNavigation(maze), domain = domainOf(maze), sequence: number[] = [];
  const locate = (p: Point) => cellAtPoint(maze, { x: Math.max(1e-7, Math.min(maze.width - 1e-7, p.x)), z: Math.max(1e-7, Math.min(maze.depth - 1e-7, p.z)) });
  for (const sample of samples) {
    const cell = locate(sample);
    if (cell !== null && cell !== sequence[sequence.length - 1])
      sequence.push(cell);
  }
  const visited = new Set<number>();
  let coveredArea = 0, decisionCount = 0, comparableCorridorChoices = 0, longestCorridorChoices = 0, continuedStraight = 0;
  for (let i = 0; i < sequence.length; i++) {
    const cell = sequence[i]!;
    if (!visited.has(cell)) {
      const r = domain.rectangles[cell]!;
      coveredArea += (r.x2 - r.x1) * (r.z2 - r.z1);
    }
    visited.add(cell);
    const next = sequence[i + 1], previous = sequence[i - 1];
    if (next === undefined || visited.has(next) || !maze.passages[cell]!.includes(next))
      continue;
    const choices = maze.passages[cell]!.filter(n => n !== previous && !visited.has(n));
    if (choices.length < 2)
      continue;
    decisionCount++;
    const views = choices.map(n => ({ cell: n, view: viewCorridor(maze, context, cell, n) }));
    const chosen = views.find(v => v.cell === next)!, lengths = views.map(v => v.view.length);
    if (Math.max(...lengths) - Math.min(...lengths) >= 1) {
      comparableCorridorChoices++;
      if (chosen.view.length >= Math.max(...lengths) - .1)
        longestCorridorChoices++;
    }
    if (previous !== undefined && maze.passages[cell]!.includes(previous)) {
      const a = context.centers[previous]!, b = context.centers[cell]!, c = context.centers[next]!;
      const dot = ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z));
      if (dot > .95)
        continuedStraight++;
    }
  }
  const optimalLength = pathLength(routePoints(maze));
  return { exploration: assessExploration(maze, sequence, finished), distance, optimalLength, ratio: optimalLength ? distance / optimalLength : null, coveredAreaRatio: coveredArea / domain.area,
    decisionCount, comparableCorridorChoices, longestCorridorChoices, continuedStraight, interpretation: 'movement-only' };
}
