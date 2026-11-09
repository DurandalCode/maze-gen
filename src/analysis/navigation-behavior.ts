export type BoundaryStrategy = 'follow' | 'avoid' | 'adaptive';
export interface NavigationBehavior {
  /** Confidence retained by internal heading estimation when all external cues disappear. */
  internalOrientation: number;
  boundaryStrategy: BoundaryStrategy;
  /** Reliability of recognizing a previously explored route, not knowledge of hidden passages. */
  routeMemory: number;
}
export const DEFAULT_BEHAVIOR: Readonly<NavigationBehavior> = {
  internalOrientation: 1, boundaryStrategy: 'adaptive', routeMemory: .9,
};
export interface BehaviorSummary {
  meanStrategyChanges: number;
  meanRechecks: number;
  meanRecheckDistance: number;
}
/** A persistent hypothesis, revised only after observed lack of progress and a retreat. */
export function boundaryBelief(strategy: BoundaryStrategy, initialDraw: number, scale: number) {
  let sign = strategy === 'avoid' || strategy === 'adaptive' && initialDraw < .5 ? -1 : 1;
  let best = Infinity, stalled = 0, cooldown = 0, changes = 0;
  return {
    get sign() { return sign; },
    get changes() { return changes; },
    observe(estimatedRemaining: number, travelled: number, retreat: boolean) {
      cooldown = Math.max(0, cooldown - travelled);
      if (estimatedRemaining < best - scale * .25) {
        best = estimatedRemaining;
        stalled = 0;
      }
      else
        stalled += travelled;
      if (strategy !== 'adaptive' || !retreat || stalled < Math.max(12, 6 * scale) || cooldown > 0 || changes >= 2)
        return false;
      sign *= -1;
      changes++;
      best = estimatedRemaining;
      stalled = 0;
      cooldown = Math.max(24, 12 * scale);
      return true;
    },
  };
}
