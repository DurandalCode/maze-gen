import type {SideDistricts} from './side-districts';
import {corridorSearch} from './corridor-search';
import type { PotentialDifficulty } from './potential-difficulty';
import { unguidedExplorationForecast, type ExplorationForecast } from './exploration-meter';
import type { PortalPrivacy } from './portal-privacy';
import type { expectedExploration } from './expected-exploration';
import type { DecisionDifficulty } from './decision-difficulty';
import { DEFAULT_BEHAVIOR, type NavigationBehavior, type BehaviorSummary } from './navigation-behavior';
import { measureLandmarks, type LandmarkVisibility } from './visibility';
import { sampleDirectedSearch, endpointTravel } from './directed-search';
import { domainOf } from '../core/domain';
import { componentCount } from '../core/graph';
import { routePoints, pathLength, shortestPath } from '../core/pathfinding';
import { portalPoint, type Maze } from '../core/maze';
import { random } from '../core/random';
import { directionScore, edgeLength, prepareNavigation, prepareOutline, type NavigationContext, type NavigationProfile } from './navigation';
export interface AnalysisOptions extends Partial<NavigationBehavior> {
  maxForcedStraight?: number;
  maxForcedRun?: number;
  profile: NavigationProfile;
  beta: number;
  threshold: number;
  samples: number;
  corridorPreference?: number;
  boundaryPreference?: number;
  diagonalVision?: boolean;
  decisionMode?: 'local' | 'frontier';
}
export const DEFAULT_ANALYSIS: AnalysisOptions = { profile: 'outline', beta: 3, threshold: 0.2, samples: 256, corridorPreference: 1, boundaryPreference: 1.5, diagonalVision: true, decisionMode: 'local', ...DEFAULT_BEHAVIOR };
export interface ColdRegion {
  cells: number[];
  area: number;
}
export interface ColdspotAnalysis {
  modelVersion?:number;
  sideDistricts?:SideDistricts;
  options: AnalysisOptions;
  behavior?: BehaviorSummary;
  decisions?: DecisionDifficulty;
  potential?: PotentialDifficulty;
  explorationForecast?: ExplorationForecast;
  privacy?: {
    certified: boolean;
    entrance: PortalPrivacy;
    exit: PortalPrivacy;
  };
  sideExploration?: ReturnType<typeof expectedExploration>;
  landmarks?: LandmarkVisibility;
  probability: Float64Array;
  visits: Float64Array;
  regions: ColdRegion[];
  coldArea: number;
  coldAreaRatio: number;
  largestColdArea: number;
  explorerExpectedLength?: number;
  expectedLength: number;
  optimalLength: number;
  searchRatio: number;
  method: 'exact-tree' | 'sampled';
  samples: number;
}
export function validateAnalysisOptions(options: AnalysisOptions): void {
  if (options.maxForcedStraight !== undefined && (!Number.isFinite(options.maxForcedStraight) || options.maxForcedStraight < 2 || options.maxForcedStraight > 40))
    throw new Error('Предел прямого прохода должен быть от 2 до 40 м.');
  if (options.maxForcedRun !== undefined && (!Number.isFinite(options.maxForcedRun) || options.maxForcedRun < 2 || options.maxForcedRun > 100))
    throw new Error('Предел прохода без выбора должен быть от 2 до 100 м.');
  if (!['explorer', 'compass', 'outline'].includes(options.profile) || !Number.isFinite(options.beta) || options.beta < 0 || options.beta > 5 ||
    !Number.isFinite(options.threshold) || options.threshold <= 0 || options.threshold > 1 || !Number.isInteger(options.samples) || options.samples < 16 || options.samples > 2048)
    throw new Error('Некорректные параметры анализа колдспотов.');
  if (options.decisionMode !== undefined && !['local', 'frontier'].includes(options.decisionMode))
    throw new Error('Неизвестный способ оценки развилок.');
  for (const key of ['internalOrientation', 'routeMemory'] as const)
    if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key]! < 0 || options[key]! > 1))
      throw new Error('Надёжность направления и памяти должна быть от 0 до 1.');
  if (options.boundaryStrategy !== undefined && !['follow', 'avoid', 'adaptive'].includes(options.boundaryStrategy))
    throw new Error('Неизвестная стратегия отношения к границе.');
  if (options.boundaryPreference !== undefined && (!Number.isFinite(options.boundaryPreference) || options.boundaryPreference < 0 || options.boundaryPreference > 3))
    throw new Error('Тяга к границе должна быть от 0 до 3.');
  if (options.diagonalVision !== undefined && typeof options.diagonalVision !== 'boolean')
    throw new Error('Диагональная видимость должна быть логическим значением.');
  if (options.corridorPreference !== undefined && (!Number.isFinite(options.corridorPreference) || options.corridorPreference < 0 || options.corridorPreference > 3))
    throw new Error('Тяга к коридорам должна быть от 0 до 3.');
}
/** Explorers use DFS; oriented navigators reconsider all observed, still untried exits after every discovery. */
export function analyzeColdspots(maze: Maze, options: AnalysisOptions = DEFAULT_ANALYSIS, prepared?: NavigationContext, forceSampling = false): ColdspotAnalysis {
  validateAnalysisOptions(options);
  if(maze.version===4)return corridorSearch(maze,options);
  const context = prepared ?? prepareNavigation(maze), domain = domainOf(maze);
  const route = shortestPath(maze);
  if (!route.length)
    throw new Error('Выход недостижим: анализ поиска невозможен.');
  if (options.profile === 'outline')
    prepareOutline(maze, context);
  const size = maze.passages.length;
  let probability: Float64Array = new Float64Array(size), visits: Float64Array = new Float64Array(size);
  let samples = options.samples;
  const directed = options.profile !== 'explorer' && (options.beta > 0 || (options.corridorPreference ?? 1) > 0 || (options.profile === 'outline' && (options.boundaryPreference ?? 1.5) > 0));
  const edgeCount = maze.passages.reduce((sum, list) => sum + list.length, 0) / 2;
  const exact = !directed && !forceSampling && componentCount(maze) === 1 && edgeCount === context.cells.length - 1;
  const optimalLength = pathLength(routePoints(maze));
  let expectedLength = 0;
  let behavior: BehaviorSummary | undefined;
  let explorationForecast: ExplorationForecast | undefined;
  const landmarks = directed ? measureLandmarks(maze, context) : undefined;
  const beta = options.profile === 'explorer' ? 0 : options.beta;
  if (exact) {
    const onRoute = new Uint8Array(size);
    for (const a of route) {
      onRoute[a] = 1;
      probability[a] = 1;
      visits[a] = 1;
    }
    expectedLength = optimalLength;
    for (let i = 0; i < route.length; i++) {
      const a = route[i]!;
      for (const b of maze.passages[a]!) {
        if (onRoute[b])
          continue;
        const p = a === maze.exit.cell ? 0 : 1 / (1 + Math.exp(beta * (directionScore(context, a, route[i + 1]!, options.profile) - directionScore(context, a, b, options.profile))));
        const stack: [
          number,
          number
        ][] = [[a, b]];
        while (stack.length) {
          const [parent, cell] = stack.pop()!;
          probability[cell] = p;
          visits[parent] = visits[parent]! + p;
          visits[cell] = visits[cell]! + p;
          expectedLength += 2 * p * edgeLength(context, parent, cell);
          for (const next of maze.passages[cell]!)
            if (next !== parent)
              stack.push([cell, next]);
        }
      }
    }
  }
  else if (directed) {
    const value = sampleDirectedSearch(maze, context, options.profile, options.beta, options.samples, endpointTravel(portalPoint(maze, maze.entrance), context.centers[maze.entrance.cell]!, portalPoint(maze, maze.exit), context.centers[maze.exit.cell]!), landmarks!, options.corridorPreference ?? 1, options.profile === 'outline' ? (options.boundaryPreference ?? 1.5) : 0, options.diagonalVision ?? true, { ...DEFAULT_BEHAVIOR, internalOrientation: options.internalOrientation ?? DEFAULT_BEHAVIOR.internalOrientation, boundaryStrategy: options.boundaryStrategy ?? DEFAULT_BEHAVIOR.boundaryStrategy, routeMemory: options.routeMemory ?? DEFAULT_BEHAVIOR.routeMemory }, options.decisionMode ?? 'local');
    behavior = value.behavior;
    explorationForecast = value.explorationForecast;
    probability = value.probability;
    visits = value.visits;
    expectedLength = value.expectedLength;
    samples = value.samples;
  }
  else {
    const rng = random('coldspots-model-v1'), seen = new Uint32Array(size);
    const entrance = portalPoint(maze, maze.entrance), exit = portalPoint(maze, maze.exit);
    const startCenter = context.centers[maze.entrance.cell]!, endCenter = context.centers[maze.exit.cell]!;
    const endpointLength = Math.hypot(entrance.x - startCenter.x, entrance.z - startCenter.z) + Math.hypot(exit.x - endCenter.x, exit.z - endCenter.z);
    for (let run = 1; run <= options.samples; run++) {
      const stack = [maze.entrance.cell], visited = [maze.entrance.cell];
      seen[maze.entrance.cell] = run;
      visits[maze.entrance.cell] = visits[maze.entrance.cell]! + 1;
      let distance = endpointLength;
      while (stack[stack.length - 1] !== maze.exit.cell) {
        const a = stack[stack.length - 1]!, choices = maze.passages[a]!.filter(b => seen[b] !== run);
        let b: number;
        if (choices.length) {
          const weights = choices.map(b => Math.exp(beta * directionScore(context, a, b, options.profile)));
          let pick = rng() * weights.reduce((a, b) => a + b, 0);
          b = choices[choices.length - 1]!;
          for (let i = 0; i < choices.length; i++) {
            pick -= weights[i]!;
            if (pick < 0) {
              b = choices[i]!;
              break;
            }
          }
          seen[b] = run;
          visited.push(b);
          stack.push(b);
        }
        else {
          stack.pop();
          if (!stack.length)
            throw new Error('Поиск не достиг выхода.');
          b = stack[stack.length - 1]!;
        }
        visits[b] = visits[b]! + 1;
        distance += edgeLength(context, a, b);
      }
      for (const a of visited)
        probability[a] = probability[a]! + 1;
      expectedLength += distance / options.samples;
    }
    for (const a of context.cells) {
      probability[a] = probability[a]! / options.samples;
      visits[a] = visits[a]! / options.samples;
    }
  }
  let coldArea = 0;
  const regions: ColdRegion[] = [], seen = new Uint8Array(size);
  for (const a of context.cells) {
    if (seen[a] || probability[a]! >= options.threshold)
      continue;
    const cells = [a];
    seen[a] = 1;
    let area = 0;
    for (let head = 0; head < cells.length; head++) {
      const cell = cells[head]!, rect = domain.rectangles[cell]!;
      area += (rect.x2 - rect.x1) * (rect.z2 - rect.z1);
      for (const b of maze.passages[cell]!)
        if (!seen[b] && probability[b]! < options.threshold) {
          seen[b] = 1;
          cells.push(b);
        }
    }
    regions.push({ cells, area });
    coldArea += area;
  }
  regions.sort((a, b) => b.area - a.area || a.cells[0]! - b.cells[0]!);
  explorationForecast ??= unguidedExplorationForecast(maze, probability);
  return { modelVersion:maze.storeys?11:9,explorationForecast, options: { ...options }, landmarks, probability, visits, regions, coldArea, coldAreaRatio: coldArea / domain.area, largestColdArea: regions[0]?.area ?? 0,
    ...(behavior ? { behavior } : {}), expectedLength, optimalLength, searchRatio: optimalLength ? expectedLength / optimalLength : 1, method: exact ? 'exact-tree' : 'sampled', samples: exact ? 0 : samples };
}
