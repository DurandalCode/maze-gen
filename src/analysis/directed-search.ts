import { LearnedGraph, type LearnedRoute } from './learned-graph';
import {visibleDeadEnd} from './visible-deadends';
import { decisionModel, decisionScore, DECISION_WEIGHTS } from './decision-model';
import { explorationMeter, type ExplorationForecast } from './exploration-meter';
import { DEFAULT_BEHAVIOR, boundaryBelief, type NavigationBehavior, type BehaviorSummary } from './navigation-behavior';
import { spatialPerception, perimeterPerception } from './spatial-perception';
import { viewCorridor, type CorridorView } from './corridor-view';
import type { LandmarkVisibility } from './visibility';
import { edgeLength, type NavigationContext, type NavigationProfile } from './navigation';
import type { Maze, Point } from '../core/maze';
import { random, shuffle } from '../core/random';
interface Frontier {
  cell: number;
  priority: number;
}
export interface DirectedSearchResult {
  explorationForecast?: ExplorationForecast;
  behavior: BehaviorSummary;
  probability: Float64Array;
  visits: Float64Array;
  expectedLength: number;
  samples: number;
}
/**
 * Online goal-directed exploration. Only exits of visited cells enter the frontier.
 * A less promising continuation can lose to an earlier, still untried exit. Travel
 * between these exits uses the observed graph, never hidden passages. Trees retain
 * the LCA/path-difference fast path until an observed cross-connection is learned.
 */
export function sampleDirectedSearch(maze: Maze, context: NavigationContext, profile: NavigationProfile, beta: number, requestedSamples: number, endpointLength: number, visibility: LandmarkVisibility, corridorPreference = 0, boundaryPreference = 0, diagonalVision = true, behavior: NavigationBehavior = DEFAULT_BEHAVIOR, decisionMode: 'local' | 'frontier' = 'local'): DirectedSearchResult {
  const size = maze.passages.length, samples = Math.min(requestedSamples, Math.max(16, Math.floor(2000000 / context.cells.length)));
  const probability = new Float64Array(size), visits = new Float64Array(size);
  const visitedStamp = new Uint32Array(size);
  const discovered = new Uint32Array(size), parent = new Int32Array(size), depth = new Int32Array(size), distance = new Float64Array(size);
  // Path difference counts accumulate revisits without replaying potentially long remembered walks.
  const upward = new Float64Array(size), downward = new Float64Array(size);
  const levels = Math.max(1, Math.ceil(Math.log2(size + 1))), ancestors = Array.from({ length: levels }, () => new Int32Array(size));
  const upMemory = Array.from({ length: levels }, () => new Float64Array(size));
  const downMemory = Array.from({ length: levels }, () => new Float64Array(size));
  const cues = new Float64Array(size), heuristic = new Float64Array(size);
  const priorities = new Float64Array(size), visualPriorities = new Float64Array(size), edgeAppeal = new Float64Array(size), localPriorities = new Float64Array(size);
  const memoryDecay = (distance: number) => Math.exp(-distance / 12);
  let totalEdgeLength = 0, totalEdges = 0;
  for (const a of context.cells) {
    cues[a] = Math.max(visibility.sun[a]!, visibility.forest[a]!, profile === 'outline' ? visibility.boundary[a]! : 0);
    heuristic[a] = profile === 'outline' ? context.outlineDistances![a]! : Math.hypot(context.centers[a]!.x - context.goal.x, context.centers[a]!.z - context.goal.z);
    for (const b of context.adjacent[a]!)
      if (b > a) {
        totalEdgeLength += edgeLength(context, a, b);
        totalEdges++;
      }
  }
  const scale = totalEdges ? totalEdgeLength / totalEdges : 1;
  const cognitive = behavior.internalOrientation > 0 || behavior.boundaryStrategy !== 'follow' || behavior.routeMemory < 1;
  // v9: remembered returns use all observed connections, including cycle shortcuts.
  const rng = random('coldspots-observed-graph-v9-' + decisionMode);
  const choices = decisionMode === 'local' ? decisionModel(maze, context, diagonalVision, boundaryPreference > 0) : null;
  const spatial = !choices && corridorPreference > 0 && diagonalVision ? spatialPerception(maze, context) : null;
  const perimeter = !choices && boundaryPreference > 0 ? perimeterPerception(maze, context) : null;
  const locality = .75 * corridorPreference + 1.5 * boundaryPreference;
  const corridorCache = new Map<string, CorridorView>();
  const corridor = (from: number, to: number) => {
    const key = `${from}:${to}`;
    let view = corridorCache.get(key);
    if (!view) {
      view = viewCorridor(maze, context, from, to);
      corridorCache.set(key, view);
    }
    return view;
  };
  const lca = (a: number, b: number) => {
    if (depth[a]! < depth[b]!)
      [a, b] = [b, a];
    let difference = depth[a]! - depth[b]!;
    for (let level = 0; difference; level++, difference >>= 1)
      if (difference & 1)
        a = ancestors[level]![a]!;
    if (a === b)
      return a;
    for (let level = levels - 1; level >= 0; level--)
      if (ancestors[level]![a] !== ancestors[level]![b]) {
        a = ancestors[level]![a]!;
        b = ancestors[level]![b]!;
      }
    return parent[a]!;
  };
  const rememberTravel = (from: number, to: number, ancestor: number, confidence: number) => {
    let at = from, difference = depth[from]! - depth[ancestor]!;
    for (let level = 0; difference; level++, difference >>= 1)
      if (difference & 1) {
        const next = ancestors[level]![at]!;
        confidence = Math.max(confidence * memoryDecay(distance[at]! - distance[next]!), upMemory[level]![at]!);
        at = next;
      }
    const segments: {
      cell: number;
      level: number;
    }[] = [];
    at = to;
    difference = depth[to]! - depth[ancestor]!;
    for (let level = 0; difference; level++, difference >>= 1)
      if (difference & 1) {
        segments.push({ cell: at, level });
        at = ancestors[level]![at]!;
      }
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i]!, start = ancestors[segment.level]![segment.cell]!;
      confidence = Math.max(confidence * memoryDecay(distance[segment.cell]! - distance[start]!), downMemory[segment.level]![segment.cell]!);
    }
    return confidence;
  };
  let expectedLength = 0, strategyChanges = 0, rechecks = 0, recheckDistance = 0;
  const meter = explorationMeter(maze);
  for (let run = 1; run <= samples; run++) {
    meter?.begin();
    const root = maze.entrance.cell, visited = [root], heap: Frontier[] = [], pending: number[] = [];
    const belief = boundaryBelief(behavior.boundaryStrategy, cognitive ? rng() : 1, scale), recognizedLeaves: number[] = [];
    let recheckPending = false, runRechecks = 0;
    const learned = new LearnedGraph(size, context.cells, (a, b) => edgeLength(context, a, b));
    visitedStamp[root] = run;
    discovered[root] = run;
    parent[root] = root;
    depth[root] = 0;
    distance[root] = 0;
    upward[root] = 0;
    downward[root] = 0;
    for (let level = 0; level < levels; level++) {
      ancestors[level]![root] = root;
      upMemory[level]![root] = cues[root]!;
      downMemory[level]![root] = cues[root]!;
    }
    visits[root] = visits[root]! + 1;
    const push = (entry: Frontier) => {
      let i = heap.length;
      heap.push(entry);
      while (i > 0) {
        const previous = (i - 1) >> 1;
        if (heap[previous]!.priority <= entry.priority)
          break;
        heap[i] = heap[previous]!;
        i = previous;
      }
      heap[i] = entry;
    };
    const pop = () => {
      const first = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1]!.priority < heap[child]!.priority)
            child++;
          if (heap[child]!.priority >= last.priority)
            break;
          heap[i] = heap[child]!;
          i = child;
        }
        heap[i] = last;
      }
      return first.cell;
    };
    const observe = (cell: number) => {
      learned.observe(cell, maze.passages[cell]!);
      const local = [...learned.neighbors(cell)];
      shuffle(local, rng);
      for (const next of local)
        if (discovered[next] !== run) {
          // Observing a complete blind branch is not physical exploration. Do not queue
          // it for a later visit just because the goal is still hidden elsewhere.
          if(visibleDeadEnd(maze,cell,next,context))continue;
          discovered[next] = run;
          parent[next] = cell;
          depth[next] = depth[cell]! + 1;
          distance[next] = distance[cell]! + edgeLength(context, cell, next);
          ancestors[0]![next] = cell;
          for (let level = 1; level < levels; level++)
            ancestors[level]![next] = ancestors[level - 1]![ancestors[level - 1]![next]!]!;
          upMemory[0]![next] = cues[cell]!;
          downMemory[0]![next] = cues[next]!;
          for (let level = 1; level < levels; level++) {
            const mid = ancestors[level - 1]![next]!, top = ancestors[level - 1]![mid]!;
            upMemory[level]![next] = Math.max(upMemory[level - 1]![next]! * memoryDecay(distance[mid]! - distance[top]!), upMemory[level - 1]![mid]!);
            downMemory[level]![next] = Math.max(downMemory[level - 1]![mid]! * memoryDecay(distance[next]! - distance[mid]!), downMemory[level - 1]![next]!);
          }
          upward[next] = 0;
          downward[next] = 0;
          pending.push(next);
          // Persistent Gumbel priorities model uncertainty without repeatedly retrying an abandoned exit.
          const uncertainty = Math.log(-Math.log(Math.max(Number.MIN_VALUE, rng())));
          let visual = 0, perceivedGoal = heuristic[next]!;
          if (!choices && corridorPreference > 0) {
            const view = corridor(cell, next), a = context.centers[cell]!, b = context.centers[next]!;
            let hx: number, hz: number;
            if (cell === root) {
              hx = maze.entrance.side === 'west' ? 1 : maze.entrance.side === 'east' ? -1 : 0;
              hz = maze.entrance.side === 'north' ? 1 : maze.entrance.side === 'south' ? -1 : 0;
            }
            else {
              const p = context.centers[previousCell ?? parent[cell]!]!;
              hx = a.x - p.x;
              hz = a.z - p.z;
            }
            const straight = (hx * (b.x - a.x) + hz * (b.z - a.z)) / (Math.hypot(hx, hz) * Math.hypot(b.x - a.x, b.z - a.z) || 1);
            const sight = spatial?.view(cell, next);
            const visibleLength = sight?.length ?? view.length;
            const dead = view.end === 'dead-end' && (!sight || sight.endCell === view.endCell) ? 3 : 0;
            visual = corridorPreference * (3 * Math.log1p(visibleLength / scale) + .4 * Math.min(3, view.junctions) + .8 * straight - dead);
            perceivedGoal -= corridorPreference / (1 + corridorPreference) * Math.max(0, heuristic[next]! - heuristic[sight?.endCell ?? view.endCell]!);
          }
          edgeAppeal[next] = perimeter ? boundaryPreference * perimeter.attraction(cell, next) : 0;
          visual += belief.sign * edgeAppeal[next]!;
          priorities[next] = beta * perceivedGoal / scale + uncertainty - visual;
          visualPriorities[next] = uncertainty - visual;
          if (choices) {
            const previous = cell === root ? undefined : context.centers[previousCell ?? parent[cell]!]!;
            const features = choices.features(cell, next, previous, profile);
            edgeAppeal[next] = boundaryPreference * features.boundary;
            const score = decisionScore(features, beta, corridorPreference, boundaryPreference, belief.sign);
            localPriorities[next] = uncertainty - score;
            priorities[next] = beta * heuristic[next]! / scale + localPriorities[next]!;
            visualPriorities[next] = uncertainty - score + beta * DECISION_WEIGHTS.direction * features.direction;
          }
          push({ cell: next, priority: priorities[next]! });
        }
    };
    let current = root, walkLength = endpointLength, confidence = 1;
    let previousCell: number | undefined;
    const replay = (route: LearnedRoute) => {
      for (let i = 1; i < route.cells.length; i++) {
        const from = route.cells[i - 1]!, to = route.cells[i]!;
        confidence = Math.max(confidence * memoryDecay(edgeLength(context, from, to)), cues[to]!);
        visits[to] = visits[to]! + 1;
        // Transit/rechecks are physical visits, not a new exploration decision.
        if (visitedStamp[to] !== run) meter?.enter(from, to);
      }
      walkLength += route.length;
    };
    while (current !== maze.exit.cell) {
      observe(current);
      // A visually exhausted end is remembered at the last position actually reached,
      // not at the terminal cell inspected from a distance.
      if(current!==root&&!maze.passages[current]!.some(n=>visitedStamp[n]!==run&&!visibleDeadEnd(maze,current,n,context))&&!recognizedLeaves.includes(current))recognizedLeaves.push(current);
      while (heap.length && visitedStamp[heap[0]!.cell] === run)
        pop();
      while (pending.length && visitedStamp[pending[pending.length - 1]!] === run)
        pending.pop();
      if (!heap.length)
        throw new Error('Поиск не достиг выхода.');
      // Reconsider a known route only after a policy revision and imperfect recognition.
      // No unseen cell can serve as a shortcut between known branches.
      const routes = learned.hasCycles ? learned.routesFrom(current) : null;
      const routeTo = (target: number) => {
        const route = routes!.routeTo(target);
        if (!route) throw new Error('Frontier is unreachable in observed memory.');
        return route;
      };
      const ownerAndTravel = (target: number) => {
        if (routes) {
          const owner = routes.predecessorOf(target);
          if (owner === undefined) throw new Error('Frontier has no observed approach.');
          return { owner, travel: routes.distanceTo(owner) };
        }
        const owner = parent[target]!, ancestor = lca(current, owner);
        return { owner, travel: distance[current]! + distance[owner]! - 2 * distance[ancestor]! };
      };
      if (recheckPending) {
        recheckPending = false;
        const leaf = recognizedLeaves.at(-1);
        if (leaf !== undefined && leaf !== current && runRechecks < 2 && rng() > behavior.routeMemory) {
          const ancestor = lca(current, leaf), travel = routes ? routeTo(leaf).length : distance[current]! + distance[leaf]! - 2 * distance[ancestor]!;
          if (routes) {
            const outward = routeTo(leaf);
            replay(outward);
            replay({ cells: [...outward.cells].reverse(), length: outward.length });
          } else {
            confidence = rememberTravel(leaf, current, ancestor, rememberTravel(current, leaf, ancestor, confidence));
            upward[current] = upward[current]! + 1;
            upward[leaf] = upward[leaf]! + 1;
            upward[ancestor] = upward[ancestor]! - 2;
            downward[current] = downward[current]! + 1;
            downward[leaf] = downward[leaf]! + 1;
            downward[ancestor] = downward[ancestor]! - 2;
            walkLength += 2 * travel;
          }
          confidence = Math.max(behavior.internalOrientation, confidence);
          recheckDistance += 2 * travel;
          rechecks++;
          runRechecks++;
        }
      }
      const guided = rng() < Math.max(behavior.internalOrientation, confidence);
      let target: number;
      const local = learned.neighbors(current).filter(n => visitedStamp[n] !== run && discovered[n] === run);
      if (guided) {
        target = heap[0]!.cell;
        if (choices) {
          const shortlist: Frontier[] = [];
          let bestScore = Infinity;
          for (let i = 0; i < 8 && heap.length; i++) {
            const cell = pop();
            if (visitedStamp[cell] === run)
              continue;
            const entry = { cell, priority: priorities[cell]! };
            shortlist.push(entry);
            const { travel } = ownerAndTravel(cell);
            const score = entry.priority + .5 * travel / scale;
            if (score < bestScore) {
              bestScore = score;
              target = cell;
            }
          }
          for (const entry of shortlist)
            push(entry);
        }
        if (locality > 0 && local.length) {
          const bestLocal = local.reduce((a, b) => (choices ? localPriorities[a]! <= localPriorities[b]! : priorities[a]! <= priorities[b]!) ? a : b);
          const { owner, travel } = ownerAndTravel(target);
          if (choices && owner === current || priorities[bestLocal]! <= priorities[target]! + locality * travel / scale)
            target = bestLocal;
        }
        if (target === heap[0]!.cell)
          pop();
      }
      else if (locality > 0 && local.length)
        target = local.reduce((a, b) => visualPriorities[a]! <= visualPriorities[b]! ? a : b);
      else
        target = pending.pop()!;
      let owner: number, travelled: number, retreated: boolean;
      if (routes) {
        const route = routeTo(target);
        owner = route.cells[route.cells.length - 2]!;
        travelled = route.length;
        retreated = route.cells.length > 2;
        replay(route);
        confidence = Math.max(behavior.internalOrientation, confidence);
      } else {
        owner = parent[target]!;
        const ancestor = lca(current, owner);
        confidence = Math.max(behavior.internalOrientation, rememberTravel(current, target, ancestor, confidence));
        upward[current] = upward[current]! + 1;
        upward[ancestor] = upward[ancestor]! - 1;
        downward[owner] = downward[owner]! + 1;
        downward[ancestor] = downward[ancestor]! - 1;
        travelled = distance[current]! + distance[owner]! - 2 * distance[ancestor]! + edgeLength(context, owner, target);
        walkLength += travelled;
        visits[target] = visits[target]! + 1;
        meter?.enter(owner, target);
        retreated = ancestor !== current;
      }
      visitedStamp[target] = run;
      visited.push(target);
      if (maze.passages[target]!.length === 1)
        recognizedLeaves.push(target);
      previousCell = owner;
      current = target;
      const oldSign = belief.sign;
      if (boundaryPreference > 0 && belief.observe(heuristic[current]!, travelled, retreated)) {
        // All queued hypotheses must use the new belief, including previously deferred exits.
        const shift = oldSign - belief.sign;
        for (const cell of pending)
          if (visitedStamp[cell] !== run) {
            priorities[cell] = priorities[cell]! + shift * edgeAppeal[cell]!;
            visualPriorities[cell] = visualPriorities[cell]! + shift * edgeAppeal[cell]!;
            localPriorities[cell] = localPriorities[cell]! + shift * edgeAppeal[cell]!;
          }
        heap.length = 0;
        for (const cell of pending)
          if (visitedStamp[cell] !== run)
            push({ cell, priority: priorities[cell]! });
        recheckPending = true;
      }
    }
    for (const cell of visited)
      probability[cell] = probability[cell]! + 1;
    // Children are first visited after their parents, so reverse visit order is a postorder.
    for (let i = visited.length - 1; i > 0; i--) {
      const cell = visited[i]!, p = parent[cell]!;
      visits[p] = visits[p]! + upward[cell]!;
      visits[cell] = visits[cell]! + downward[cell]!;
      upward[p] = upward[p]! + upward[cell]!;
      downward[p] = downward[p]! + downward[cell]!;
    }
    meter?.finish();
    strategyChanges += belief.changes;
    expectedLength += walkLength / samples;
  }
  for (const cell of context.cells) {
    probability[cell] = probability[cell]! / samples;
    visits[cell] = visits[cell]! / samples;
  }
  return { probability, visits, expectedLength, samples, explorationForecast: meter?.summary(), behavior: { meanStrategyChanges: strategyChanges / samples, meanRechecks: rechecks / samples, meanRecheckDistance: recheckDistance / samples } };
}
export function endpointTravel(entrance: Point, start: Point, exit: Point, end: Point): number {
  return Math.hypot(entrance.x - start.x, entrance.z - start.z) + Math.hypot(exit.x - end.x, exit.z - end.z);
}
