import type { Maze, Point } from '../core/maze';
import { cellSize, portalPoint } from '../core/maze';
import { directionScore, type NavigationContext, type NavigationProfile } from './navigation';
import { spatialPerception, perimeterPerception } from './spatial-perception';
import {visibleDeadEnd} from './visible-deadends';
import { viewCorridor } from './corridor-view';
export interface DecisionFeatures {
  direction: number;
  perspective: number;
  straight: number;
  deadEnd: number;
  boundary: number;
  exitVisible: number;
  exhausted?:boolean;
}
export interface DecisionWeights {
  direction: number;
  perspective: number;
  straight: number;
  deadEnd: number;
}
export const DECISION_WEIGHTS: Readonly<DecisionWeights> = { direction: .25, perspective: 2, straight: 0, deadEnd: 4 };
/** All features are visible at the current opening or follow from the known footprint. */
export function decisionModel(maze: Maze, context: NavigationContext, diagonal = true, withBoundary = true) {
  const sight = spatialPerception(maze, context), edge = withBoundary ? perimeterPerception(maze, context) : null;
  const exit = portalPoint(maze, maze.exit), exitViews = new Map<number, {
    firstCell: number | null;
    length: number;
  }>();
  const features = (from: number, to: number, previous: Point | undefined, profile: NavigationProfile): DecisionFeatures => {
    const a = context.centers[from]!, b = context.centers[to]!, size = cellSize(maze, from), scale = Math.min(size.width, size.depth);
    const axial = viewCorridor(maze, context, from, to), opening = diagonal ? sight.view(from, to) : null;
    const depth = opening?.depth ?? axial.length;
    const distance = Math.hypot(exit.x - a.x, exit.z - a.z);
    let exitView = exitViews.get(from);
    if (!exitView) {
      exitView = sight.trace(from, Math.atan2(exit.z - a.z, exit.x - a.x), Math.min(24, distance + 1e-5));
      exitViews.set(from, exitView);
    }
    const exitVisible = exitView.firstCell === to && exitView.length >= distance - 1e-7 ? 1 : 0;
    let hx: number, hz: number;
    if (previous) {
      hx = a.x - previous.x;
      hz = a.z - previous.z;
    }
    else {
      hx = maze.entrance.side === 'west' ? 1 : maze.entrance.side === 'east' ? -1 : 0;
      hz = maze.entrance.side === 'north' ? 1 : maze.entrance.side === 'south' ? -1 : 0;
    }
    const straight = (hx * (b.x - a.x) + hz * (b.z - a.z)) / (Math.hypot(hx, hz) * Math.hypot(b.x - a.x, b.z - a.z) || 1);
    return { exitVisible, exhausted:visibleDeadEnd(maze,from,to,context)!==null, direction: directionScore(context, from, to, profile), perspective: Math.log1p(depth / scale), straight,
      deadEnd: axial.end === 'dead-end' && (!opening || opening.endCell === axial.endCell) ? 1 : 0, boundary: (edge?.attraction(from, to) ?? 0) * .6 };
  };
  return { features };
}
export function decisionScore(f: DecisionFeatures, beta: number, corridor: number, boundary: number, sign: number, weights: DecisionWeights = DECISION_WEIGHTS) {
  if(f.exhausted&&!f.exitVisible)return -Infinity;
  return 12 * (f.exitVisible ?? 0) + beta * weights.direction * f.direction + corridor * (weights.perspective * f.perspective + weights.straight * f.straight - weights.deadEnd * f.deadEnd) + boundary * sign * f.boundary;
}
export function choiceProbabilities(scores: readonly number[]): number[] {
  const maximum = Math.max(...scores);
  if(maximum===-Infinity)return scores.map(()=>0);
  const values = scores.map(score => Math.exp(score - maximum)), sum = values.reduce((a, b) => a + b, 0);
  return values.map(v => v / sum);
}
