import {validFloorChanges} from '../core/two-storey';
import {sideDistricts,type SideDistricts} from './side-districts';
import {corridorNavigation} from '../core/corridor-navigation';
import {compassProbe,type CompassProbe} from './compass-probe';
import {networkStructure,coldNearExit,type NetworkStructure} from './network-structure';
import {effectiveLimits} from '../core/design-limits';
import {contourQuality,type ContourQuality} from '../generators/contours';
import type { Maze,DesignLimits } from '../core/maze';
import {routeAlternatives,type RouteAlternatives} from './route-alternatives';
import {obviousForkDeadEnds,recognitionAdjustedColdspots} from './visible-deadends';
import {loopTraps,type LoopTraps} from './loop-traps';
import {routeTraps,type RouteTraps} from './route-traps';
import { metrics } from '../core/metrics';
import { decisionDifficulty, type DecisionDifficulty } from './decision-difficulty';
import { mazePortalPrivacy } from './portal-privacy';
import { expectedExploration } from './expected-exploration';
import { corridorQuality, type CorridorQuality } from './corridor-quality';
import { analyzeColdspots, validateAnalysisOptions, type AnalysisOptions, type ColdspotAnalysis } from './coldspots';
export interface PotentialScenario {
  finishColdArea:number;
  coldSideArea:number;largestColdSideArea:number;
  strategy: string;
  optionalCoverage: number;
  uniqueExplorationLength: number;
  uniqueExplorationRatio: number;
  /** Raw visited heat; terminal recognition does not change these values. */
  coldArea: number;
  effectiveColdArea:number;
  effectiveLargestColdArea:number;
  recognizedTerminalArea:number;
  largestColdArea: number;
  firstDetourRate: number;
  deepBranches: number;
  typicalDepth: number;
}
export interface PotentialDifficulty {
  sideDistricts:SideDistricts;
  compass:CompassProbe;
  corridorType?:boolean;
  network:NetworkStructure;
  finishColdArea:number; finishArea:number;
  design?:DesignLimits;
  contours?:ContourQuality;
  appliedLimits:ReturnType<typeof effectiveLimits>;
  alternatives:RouteAlternatives;
  obviousDeadEnds:{count:number;area:number;ratio:number};
  /** Effective quality bounds; raw heat remains in each scenario and these raw maxima. */
  worstColdRatio:number; worstColdRegion:number;
  rawWorstColdRatio:number; rawWorstColdRegion:number;
  traps:RouteTraps;
  loops:LoopTraps; requestedLoopTraps:number;
  requestedRouteTraps:number;
  treeForecast:boolean; cycles:number;
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
  if(maze.version===4&&!maze.navigation){const value=analyzePotential(corridorNavigation(maze),options,undefined,findWitness);return {...value,corridorType:true,traps:routeTraps(maze),loops:loopTraps(maze)};}
  validateAnalysisOptions(options);
  const appliedLimits=effectiveLimits(maze.parameters),living=maze.parameters.generationType==='living';
  const m = metrics(maze), privacy = mazePortalPrivacy(maze, findWitness), corridors = corridorQuality(maze, Math.min(40,maze.parameters.design||living?(appliedLimits.maxForcedStraight===Infinity?12:appliedLimits.maxForcedStraight):options.maxForcedStraight??12));
  const blind=obviousForkDeadEnds(maze);
  const result: PotentialDifficulty = {sideDistricts:sideDistricts(maze), compass:compassProbe(maze),network:networkStructure(maze),finishColdArea:0,finishArea:0,appliedLimits,...(living?{contours:contourQuality(maze)}:{}),alternatives:routeAlternatives(maze), obviousDeadEnds:{count:blind.branches.length,area:blind.area,ratio:blind.ratio}, treeForecast:m.cycles===0&&maze.version!==4,cycles:m.cycles,design:maze.parameters.design,worstColdRatio:0,worstColdRegion:0,rawWorstColdRatio:0,rawWorstColdRegion:0,traps:routeTraps(maze), loops:loopTraps(maze), requestedLoopTraps:maze.parameters.loopTrapCount??0, requestedRouteTraps:maze.parameters.routeTrapCount??0, supported: false, eligible: false, score: null, issues: [], privacy, corridors, forcedRunLimit: maze.parameters.design||living?appliedLimits.maxForcedRun:options.maxForcedRun??20, mandatoryAreaRatio: 0, minMandatoryRatio: .35, maxMandatoryRatio: .55, scenarios: [], minOptionalCoverage: 0, maxOptionalCoverage: 0, minUniqueExplorationRatio: 0, maxUniqueExplorationRatio: 0, minFirstDetourRate: 0, maxFirstDetourRate: 0, minDeepBranches: 0, maxDeepBranches: 0, minTypicalDepth: 0, maxTypicalDepth: 0 };
  if (m.components !== 1) {
    result.reason = 'Прогноз боковой разведки пока доступен для связного дерева проходов.';
    return result;
  }
  const decisions = m.cycles===0&&maze.version!==4?decisionDifficulty(maze):undefined;
  result.decisions = decisions;
  result.supported = true;
  if(maze.version===4)result.reason='Прогноз по реальным пространствам и проёмам. Модель коридорного типа требует проверки прохождениями.';
  result.mandatoryAreaRatio = decisions?decisions.mandatoryArea / m.area:0;
  if(m.cycles)result.reason="Для колец доступны тепло, геометрия и реальные тупиковые ловушки. Прогноз уникальной боковой разведки и обязательная доля дерева здесь не применяются.";
  const forecastOptions=maze.parameters.design?{...options,profile:'outline' as const}:options;
  const strategies = forecastOptions.profile === 'outline' ? ['adaptive', 'follow', 'avoid'] as const : [forecastOptions.boundaryStrategy ?? 'adaptive'] as const;
  result.scenarios = strategies.map(boundaryStrategy => {
    const reuse = primary?.explorationForecast && primary.options.samples===forecastOptions.samples && options.profile===forecastOptions.profile && (options.boundaryStrategy ?? 'adaptive') === boundaryStrategy;
    const analysis = reuse ? primary : analyzeColdspots(maze, { ...forecastOptions, boundaryStrategy, routeMemory: 1 });
    const e = m.cycles===0&&maze.version!==4?expectedExploration(maze, analysis.probability):null;
    const forecast = analysis.explorationForecast;
    const effective=recognitionAdjustedColdspots(maze,analysis.probability,analysis.options.threshold);
    const district=sideDistricts(maze,analysis.probability,analysis.options.threshold);if(!result.sideDistricts.assessed||district.largestProblemArea>result.sideDistricts.largestProblemArea)result.sideDistricts=district;
    const finish=coldNearExit(maze,analysis.probability,analysis.options.threshold);result.finishArea=finish.area;
    return { coldSideArea:district.problemArea,largestColdSideArea:district.largestProblemArea,finishColdArea:finish.coldArea,strategy: forecastOptions.profile === 'outline' ? boundaryStrategy : forecastOptions.profile, optionalCoverage: e?.visitedRatio ?? 0, uniqueExplorationLength: e?.uniqueLength ?? 0, uniqueExplorationRatio: e?.uniqueRatio ?? 0, effectiveColdArea:effective.coldArea,effectiveLargestColdArea:effective.largestColdArea,recognizedTerminalArea:effective.recognizedTerminalArea,coldArea: analysis.coldArea, largestColdArea: analysis.largestColdArea, firstDetourRate: forecast?.firstDetourRate ?? 0, deepBranches: forecast?.expectedDeepBranches ?? 0, typicalDepth: forecast?.medianBranchDepth ?? 0 };
  });
  result.finishColdArea=Math.max(...result.scenarios.map(s=>s.finishColdArea));
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
  if (!privacy.certified&&(maze.version!==4||maze.parameters.design)&&(!living||maze.parameters.design||(maze.parameters.routeTrapCount??0)>0||(maze.parameters.loopTrapCount??0)>0))
    result.issues.push('Скрытность входа и выхода не доказана.');
  if (!living && result.treeForecast && (result.mandatoryAreaRatio < result.minMandatoryRatio || result.mandatoryAreaRatio > result.maxMandatoryRatio))
    result.issues.push('Обязательный маршрут вне диапазона 35–55% площади.');
  if ((maze.version!==4||maze.parameters.design)&&corridors.longestForcedStraight > (maze.parameters.design||living?appliedLimits.maxForcedStraight:options.maxForcedStraight??12))
    result.issues.push(`Прямая без выбора ${corridors.longestForcedStraight.toFixed(1)} м превышает предел ${corridors.straightLimit} м.`);
  if ((maze.version!==4||maze.parameters.design)&&corridors.longestForcedRun > result.forcedRunLimit)
    result.issues.push(`Участок без развилок ${corridors.longestForcedRun.toFixed(1)} м превышает предел ${result.forcedRunLimit} м.`);
  if(result.traps.qualifiedCount < result.requestedRouteTraps)
    result.issues.push(`Ловушек на маршруте: ${result.traps.qualifiedCount}, требуется не менее ${result.requestedRouteTraps}.`);
  if(result.loops.qualifiedCount<result.requestedLoopTraps)result.issues.push(`Кольцевых ловушек: ${result.loops.qualifiedCount}, требуется не менее ${result.requestedLoopTraps}.`);
  result.rawWorstColdRatio=Math.max(...result.scenarios.map(s=>s.coldArea/m.area));
  result.rawWorstColdRegion=Math.max(...result.scenarios.map(s=>s.largestColdArea));
  result.worstColdRatio=Math.max(...result.scenarios.map(s=>s.effectiveColdArea/m.area));
  result.worstColdRegion=Math.max(...result.scenarios.map(s=>s.effectiveLargestColdArea));
  if(result.design){
    if(corridors.longestVisibleStraight>appliedLimits.maxVisibleStraight)result.issues.push('Слишком длинная видимая прямая, включая развилки.');
    if(result.sideDistricts.largestProblemArea/m.area>appliedLimits.maxColdSideRatio+1e-9)result.issues.push('Слишком крупный холодный район со слабо разнесёнными подходами к маршруту.');
    if(result.worstColdRatio>appliedLimits.maxColdRatio+1e-9)result.issues.push('Превышена допустимая холодная доля площади.');
    if(result.worstColdRegion>appliedLimits.maxColdRegion+1e-9)result.issues.push('Слишком крупный связный колдспот.');
  }
  if(result.design?.maxUnavoidableRouteRatio!==undefined&&maze.parameters.extraConnections>0&&result.alternatives.unavoidableRatio>appliedLimits.maxUnavoidableRouteRatio+1e-9)result.issues.push('Слишком большая доля основного маршрута не имеет альтернативного обхода.');
  if(result.contours&&!result.contours.certified)result.issues.push('Нарушен контурный рисунок: нужно сохранить минимум 80% контурных связей и межслойных стен.');
  if(!validFloorChanges(maze))result.issues.push('Нарушен минимум обязательных смен этажей.');
  if(maze.storeys)result.reason='Двухэтажная модель v11 учитывает лестницы, перекрытия и наблюдаемые соединения. Требует проверки прохождениями.';
  result.eligible = result.issues.length === 0;
  result.score = result.minUniqueExplorationRatio + .5 * result.minOptionalCoverage + .025 * Math.min(8, decisions?.credibleDecoys ?? 0) - .002 * Math.max(...result.scenarios.map(s => s.effectiveLargestColdArea));
  if(!result.treeForecast)result.score=1-result.worstColdRatio-.5*result.worstColdRegion/m.area;
  if(result.requestedRouteTraps>0 && result.traps.best?.qualifies)result.score! += .2 * result.traps.best.score;
  if(maze.version===4)result.score! -= 1.5*result.sideDistricts.largestProblemArea/m.area+.5*result.sideDistricts.problemArea/m.area;
  result.score! -= blind.ratio;
  if(!result.treeForecast)result.score! += .35*result.alternatives.alternativeRatio;
  if(result.cycles)result.score! += .08*Math.min(3,Math.max(0,result.network.interlinkedCycles-1))+.015*Math.min(8,result.network.junctions);
  if(result.compass.bestRatio!==null)result.score! -= .5*Math.max(0,2-result.compass.bestRatio);
  result.score! -= .4*(result.finishArea?result.finishColdArea/result.finishArea:0);
  return result;
}
