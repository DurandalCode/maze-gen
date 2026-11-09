import type { Maze,DesignLimits } from '../core/maze';
import {routeTraps,type RouteTraps} from './route-traps';
import { metrics } from '../core/metrics';
import { decisionDifficulty, type DecisionDifficulty } from './decision-difficulty';
import { mazePortalPrivacy } from './portal-privacy';
import { expectedExploration } from './expected-exploration';
import { corridorQuality, type CorridorQuality } from './corridor-quality';
import { analyzeColdspots, validateAnalysisOptions, type AnalysisOptions, type ColdspotAnalysis } from './coldspots';
export interface PotentialScenario {
  strategy: string;
  optionalCoverage: number;
  uniqueExplorationLength: number;
  uniqueExplorationRatio: number;
  coldArea: number;
  largestColdArea: number;
  firstDetourRate: number;
  deepBranches: number;
  typicalDepth: number;
}
export interface PotentialDifficulty {
  design?:DesignLimits;
  worstColdRatio:number; worstColdRegion:number;
  traps:RouteTraps;
  requestedRouteTraps:number;
  supported: boolean;
  reason?: string;
  eligible: boolean;
  score: number | null;
  issues: string[];
  privacy: ReturnType<typeof mazePortalPrivacy>;
  corridors: CorridorQuality;
  forcedRunLimit: number;
  mandatoryAreaRatio: number;
  minMandatoryRatio: number;
  maxMandatoryRatio: number;
  decisions?: DecisionDifficulty;
  scenarios: PotentialScenario[];
  minOptionalCoverage: number;
  maxOptionalCoverage: number;
  minUniqueExplorationRatio: number;
  maxUniqueExplorationRatio: number;
  minFirstDetourRate: number;
  maxFirstDetourRate: number;
  minDeepBranches: number;
  maxDeepBranches: number;
  minTypicalDepth: number;
  maxTypicalDepth: number;
}
/** Shared by the interactive assessment and optimizer. A comparative forecast, not a calibrated human grade. */
export function analyzePotential(maze: Maze, options: AnalysisOptions, primary?: ColdspotAnalysis, findWitness = true): PotentialDifficulty {
  validateAnalysisOptions(options);
  const m = metrics(maze), privacy = mazePortalPrivacy(maze, findWitness), corridors = corridorQuality(maze, maze.parameters.design?.maxForcedStraight ?? options.maxForcedStraight ?? 12);
  const result: PotentialDifficulty = { design:maze.parameters.design,worstColdRatio:0,worstColdRegion:0,traps:routeTraps(maze), requestedRouteTraps:maze.parameters.routeTrapCount??0, supported: false, eligible: false, score: null, issues: [], privacy, corridors, forcedRunLimit: maze.parameters.design?.maxForcedRun ?? options.maxForcedRun ?? 20, mandatoryAreaRatio: 0, minMandatoryRatio: .35, maxMandatoryRatio: .55, scenarios: [], minOptionalCoverage: 0, maxOptionalCoverage: 0, minUniqueExplorationRatio: 0, maxUniqueExplorationRatio: 0, minFirstDetourRate: 0, maxFirstDetourRate: 0, minDeepBranches: 0, maxDeepBranches: 0, minTypicalDepth: 0, maxTypicalDepth: 0 };
  if (m.components !== 1 || m.cycles !== 0) {
    result.reason = 'Прогноз боковой разведки пока доступен для связного дерева проходов.';
    return result;
  }
  const decisions = decisionDifficulty(maze);
  result.decisions = decisions;
  result.supported = true;
  result.mandatoryAreaRatio = decisions.mandatoryArea / m.area;
  const forecastOptions=maze.parameters.design?{...options,profile:'outline' as const}:options;
  const strategies = forecastOptions.profile === 'outline' ? ['adaptive', 'follow', 'avoid'] as const : [forecastOptions.boundaryStrategy ?? 'adaptive'] as const;
  result.scenarios = strategies.map(boundaryStrategy => {
    const reuse = primary?.explorationForecast && primary.options.samples===forecastOptions.samples && options.profile===forecastOptions.profile && (options.boundaryStrategy ?? 'adaptive') === boundaryStrategy;
    const analysis = reuse ? primary : analyzeColdspots(maze, { ...forecastOptions, boundaryStrategy, routeMemory: 1 });
    const e = expectedExploration(maze, analysis.probability);
    const forecast = analysis.explorationForecast!;
    return { strategy: forecastOptions.profile === 'outline' ? boundaryStrategy : forecastOptions.profile, optionalCoverage: e.visitedRatio, uniqueExplorationLength: e.uniqueLength, uniqueExplorationRatio: e.uniqueRatio, coldArea: analysis.coldArea, largestColdArea: analysis.largestColdArea, firstDetourRate: forecast.firstDetourRate, deepBranches: forecast.expectedDeepBranches, typicalDepth: forecast.medianBranchDepth };
  });
  result.minOptionalCoverage = Math.min(...result.scenarios.map(s => s.optionalCoverage));
  result.maxOptionalCoverage = Math.max(...result.scenarios.map(s => s.optionalCoverage));
  result.minUniqueExplorationRatio = Math.min(...result.scenarios.map(s => s.uniqueExplorationRatio));
  result.maxUniqueExplorationRatio = Math.max(...result.scenarios.map(s => s.uniqueExplorationRatio));
  result.minFirstDetourRate = Math.min(...result.scenarios.map(s => s.firstDetourRate));
  result.maxFirstDetourRate = Math.max(...result.scenarios.map(s => s.firstDetourRate));
  result.minDeepBranches = Math.min(...result.scenarios.map(s => s.deepBranches));
  result.maxDeepBranches = Math.max(...result.scenarios.map(s => s.deepBranches));
  result.minTypicalDepth = Math.min(...result.scenarios.map(s => s.typicalDepth));
  result.maxTypicalDepth = Math.max(...result.scenarios.map(s => s.typicalDepth));
  if (!privacy.certified)
    result.issues.push('Скрытность входа и выхода не доказана.');
  if (result.mandatoryAreaRatio < result.minMandatoryRatio || result.mandatoryAreaRatio > result.maxMandatoryRatio)
    result.issues.push('Обязательный маршрут вне диапазона 35–55% площади.');
  if (corridors.longestForcedStraight > corridors.straightLimit)
    result.issues.push(`Прямая без выбора ${corridors.longestForcedStraight.toFixed(1)} м превышает предел ${corridors.straightLimit} м.`);
  if (corridors.longestForcedRun > result.forcedRunLimit)
    result.issues.push(`Участок без развилок ${corridors.longestForcedRun.toFixed(1)} м превышает предел ${result.forcedRunLimit} м.`);
  if(result.traps.qualifiedCount < result.requestedRouteTraps)
    result.issues.push(`Ловушек на маршруте: ${result.traps.qualifiedCount}, требуется не менее ${result.requestedRouteTraps}.`);
  result.worstColdRatio=Math.max(...result.scenarios.map(s=>s.coldArea/m.area));
  result.worstColdRegion=Math.max(...result.scenarios.map(s=>s.largestColdArea));
  if(result.design){
    if(corridors.longestVisibleStraight>result.design.maxVisibleStraight)result.issues.push('Слишком длинная видимая прямая, включая развилки.');
    if(result.worstColdRatio>result.design.maxColdRatio+1e-9)result.issues.push('Превышена допустимая холодная доля площади.');
    if(result.worstColdRegion>result.design.maxColdRegion+1e-9)result.issues.push('Слишком крупный связный колдспот.');
  }
  result.eligible = result.issues.length === 0;
  result.score = result.minUniqueExplorationRatio + .5 * result.minOptionalCoverage + .025 * Math.min(8, decisions.credibleDecoys) - .002 * Math.max(...result.scenarios.map(s => s.largestColdArea));
  if(result.requestedRouteTraps>0 && result.traps.best?.qualifies)result.score! += .2 * result.traps.best.score;
  return result;
}
