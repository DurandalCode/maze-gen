import { generatePrototype, PROTOTYPE_VERSION } from './prototype';
import { Random, variantSeed, emptyDocument, documentHashes, DomainError } from '../domain';
import type { Definition, Diagnostic, Document, Instance, Point } from '../domain';
import { expandDefinition } from '../catalog/catalog';
import { kernel } from '../geometry/kernel/boolean';
import {
  contourPolygon,
  multiArea,
  polygonArea,
  segmentPoint,
  sampleSegment,
  pointInPolygon,
} from '../geometry/kernel/contour';
import type { MultiPolygon, Polygon } from '../geometry/kernel/contour';
import { bounds, distance, signedArea } from '../geometry/predicates';
import { buildSpatialIndex, querySpatialIndex } from '../geometry/spatial-index';
import { connectionFacing } from '../geometry/compile/openings';
import { compileGeometry } from '../geometry/compile/compile';
import { buildNavigation, route } from '../navigation/navmesh';
import { roomPath } from '../navigation/room-path';
import { normalizeRequest, requestHash } from './request';
import type { GenerationRequest } from './request';
import { localSlots, transformed } from './slots';
import type { Slot } from './slots';
import { diversityHash, generationMetrics, graphDistances } from './metrics';
import type {
  GenerationProgress,
  GenerationResult,
  GenerationVariant,
  WorkCounters,
} from './types';

const plus = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, z: a.z + b.z * k });
const angle = (p: Point) => Math.atan2(p.z, p.x);
const diagnostic = (
  code: string,
  message: string,
  actual?: number,
  limit?: number,
): Diagnostic => ({
  code,
  path: 'generation',
  message,
  ...(actual === undefined ? {} : { actual }),
  ...(limit === undefined ? {} : { limit }),
});
interface Placed {
  instance: Instance;
  floor: Polygon;
  padded: MultiPolygon;
  slots: Slot[];
}
const fatal = (diagnostics: Diagnostic[]) =>
  diagnostics.some((d) => d.code === 'INTERNAL_ERROR' || d.code === 'GEOMETRY_LIBRARY_ERROR');
const pathLength = (p: Point[]) => p.slice(1).reduce((n, q, i) => n + distance(p[i]!, q), 0);
function corridor(a: Slot, b: Slot): Polygon {
  const aa = a.physical,
    bb = b.physical;
  // Same winding rule as compiler; the two ends can be rotated independently.
  const direct = distance(aa.center, bb.center) < 1e-6;
  if (direct) return [];
  const ring = [aa.start, aa.end, bb.start, bb.end];
  return [signedArea(ring) > 0 ? ring : [...ring].reverse()];
}
function available(placed: Placed[], used: Set<string>): Slot[] {
  return placed
    .flatMap((p) => p.slots)
    .filter((s) => !used.has(s.key))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}
function diagnosticFrom(error: unknown): Diagnostic {
  return error instanceof DomainError
    ? error.diagnostic
    : diagnostic(
        'INTERNAL_ERROR',
        'Внутренняя ошибка поиска; это не доказательство невозможности карты',
      );
}
/** Pure deterministic search. The host owns time, yielding and termination. No DOM, random global or clock. */
export function* generate(
  value: unknown,
  startVariantIndex = 0,
): Generator<GenerationProgress, GenerationResult> {
  let request: GenerationRequest;
  try {
    request = normalizeRequest(value);
  } catch (e) {
    return {
      status: 'invalid-request',
      requestHash: '',
      variants: [],
      diagnostics: [diagnosticFrom(e)],
      nextVariantIndex: startVariantIndex,
    };
  }
  if (request.generatorVersion === PROTOTYPE_VERSION)
    return yield* generatePrototype(request, startVariantIndex);
  const hash = requestHash(request),
    variants: GenerationVariant[] = [],
    diagnostics: Diagnostic[] = [];
  if (
    !Number.isSafeInteger(startVariantIndex) ||
    startVariantIndex < 0 ||
    startVariantIndex >= request.requestedVariants
  )
    return {
      status: 'invalid-request',
      requestHash: hash,
      variants: [],
      diagnostics: [diagnostic('VARIANT_INDEX', 'Неверный индекс продолжения')],
      nextVariantIndex: startVariantIndex,
    };
  const site = contourPolygon(request.site.boundaryLoops),
    siteArea = polygonArea(site),
    sitePrepared = kernel.prepare([site]),
    local = new Map(
      request.catalogSnapshots.map((e) => {
        const floor = contourPolygon(expandDefinition(e.definition));
        return [
          e.definition.contentHash,
          {
            slots: localSlots(e.definition, request.physicalProfile),
            floor,
            padded: kernel.offset([floor], 0.1),
            parameterValues: Object.fromEntries(
              e.definition.parameters.map((p) => [p.id, p.default]),
            ),
          },
        ] as const;
      }),
    );
  for (
    let variantIndex = startVariantIndex;
    variantIndex < request.requestedVariants;
    variantIndex++
  ) {
    const counters: WorkCounters = {
      placementChecks: 0,
      roots: 0,
      acceptedModules: 0,
      cycleChecks: 0,
      fullValidations: 0,
    };
    let best: GenerationVariant | null = null,
      lastDiagnostic: Diagnostic = diagnostic(
        'SEARCH_EXHAUSTED',
        'В данном бюджете допустимый вариант не найден',
      );
    for (
      let attemptIndex = 0;
      attemptIndex < request.budgets.attemptsPerVariant &&
      counters.placementChecks < request.budgets.placementChecksPerVariant;
      attemptIndex++
    ) {
      const seed = variantSeed(request.seed, request.generatorVersion, variantIndex, attemptIndex),
        random = new Random(seed),
        prefix = `v${variantIndex}-a${attemptIndex}`,
        doc: Document = {
          ...emptyDocument(`generated-${seed.slice(0, 32)}`, 'Вариант ' + (variantIndex + 1)),
          site: request.site,
          physicalProfile: request.physicalProfile,
          definitions: request.catalogSnapshots.map((e) => e.definition),
        },
        neighbors = new Map<string, string[]>(),
        placed: Placed[] = [],
        used = new Set<string>(),
        closed = new Set<string>(),
        corridors: Polygon[] = [],
        counts = new Map<string, number>();
      let index = buildSpatialIndex([]),
        stopReason: GenerationVariant['manifest']['stopReason'] = 'frontier-exhausted';
      const progress = (stage: GenerationProgress['stage']): GenerationProgress => ({
        stage,
        variantIndex,
        attemptIndex,
        workDone: counters.placementChecks,
        workLimit: request.budgets.placementChecksPerVariant,
        counters: { ...counters },
      });
      const pickDefinition = (): Definition | null => {
        const eligible = request.catalogSnapshots.filter(
          (e) =>
            (counts.get(e.definition.contentHash) ?? 0) <
              (request.allocation.caps[e.definition.contentHash] ??
                request.allocation.maxModules) &&
            local.get(e.definition.contentHash)!.slots.length > 1,
        );
        const total = eligible.reduce((n, e) => n + e.weight, 0);
        let n = random.next() * total;
        for (const e of eligible) {
          n -= e.weight;
          if (n < 0) return e.definition;
        }
        return eligible.at(-1)?.definition ?? null;
      };
      const make = (
        definition: Definition,
        id: string,
        position: Point,
        rotationRad: number,
      ): Placed => {
        const source = local.get(definition.contentHash)!,
          instance: Instance = {
            id,
            definitionHash: definition.contentHash,
            parameterValues: { ...source.parameterValues },
            position,
            rotationRad,
          },
          pose = (p: Point) => transformed(p, position, rotationRad),
          floor = source.floor.map((ring) => ring.map(pose)),
          padded = source.padded.map((polygon) => polygon.map((ring) => ring.map(pose))),
          slots = source.slots.map((s): Slot => {
            const key = id + s.key.slice('local'.length);
            return {
              key,
              opening: { ...s.opening, id: key, instanceId: id },
              physical: {
                ...s.physical,
                id: key,
                instanceId: id,
                start: pose(s.physical.start),
                end: pose(s.physical.end),
                center: pose(s.physical.center),
                normal: transformed(s.physical.normal, { x: 0, z: 0 }, rotationRad),
              },
            };
          });
        return { instance, floor, padded, slots };
      };
      const fits = (
        candidate: Placed,
        connector: Polygon | null,
        parent: string | null,
      ): boolean => {
        if (multiArea(kernel.boolean('difference', candidate.padded, sitePrepared)) > 1e-8)
          return false;
        for (const id of querySpatialIndex(index, bounds(candidate.padded.flat(2))))
          if (
            multiArea(kernel.boolean('intersection', candidate.padded, [placed[id]!.floor])) > 1e-8
          )
            return false;
        for (const c of corridors)
          if (multiArea(kernel.boolean('intersection', candidate.padded, [c])) > 1e-8) return false;
        if (connector?.length) {
          if (multiArea(kernel.boolean('difference', [connector], sitePrepared)) > 1e-8)
            return false;
          for (const id of querySpatialIndex(index, bounds(connector[0]!))) {
            if (placed[id]!.instance.id === parent) continue;
            if (multiArea(kernel.boolean('intersection', [connector], [placed[id]!.floor])) > 1e-8)
              return false;
          }
          for (const c of corridors)
            if (multiArea(kernel.boolean('intersection', [connector], [c])) > 1e-8) return false;
        }
        return true;
      };
      const add = (candidate: Placed) => {
        placed.push(candidate);
        doc.instances.push(candidate.instance);
        counts.set(
          candidate.instance.definitionHash,
          (counts.get(candidate.instance.definitionHash) ?? 0) + 1,
        );
        counters.acceptedModules++;
        index = buildSpatialIndex(placed.map((p) => bounds(p.floor.flat())));
      };
      const connect = (a: Slot, b: Slot) => {
        for (const [from, to] of [
          [a.opening.instanceId, b.opening.instanceId],
          [b.opening.instanceId, a.opening.instanceId],
        ])
          neighbors.set(from!, [...(neighbors.get(from!) ?? []), to!]);
        doc.openings.push(a.opening, b.opening);
        used.add(a.key);
        used.add(b.key);
        doc.connections.push({
          id: `${prefix}/connection-${doc.connections.length}`,
          openingA: a.key,
          openingB: b.key,
        });
        const c = corridor(a, b);
        if (c.length) corridors.push(c);
      };
      const base = request.placement.baseRotationRad ?? random.next() * Math.PI * 2;
      try {
        yield progress('root');
        const outer = request.site.boundaryLoops.find((l) => l.role === 'outer')!;
        let entrance: Slot | null = null;
        for (
          let probe = 0;
          probe < 256 && counters.placementChecks < request.budgets.placementChecksPerVariant;
          probe++
        ) {
          counters.roots++;
          counters.placementChecks++;
          const definition = pickDefinition();
          if (!definition) break;
          const slots = local.get(definition.contentHash)!.slots,
            slot = slots[Math.floor(random.next() * slots.length)]!,
            edge = outer.segments[Math.floor(random.next() * outer.segments.length)]!,
            u = 0.1 + random.next() * 0.8,
            p = segmentPoint(edge, u),
            before = segmentPoint(edge, Math.max(0, u - 0.0001)),
            after = segmentPoint(edge, Math.min(1, u + 0.0001)),
            tangent = plus(after, before, -1),
            len = Math.hypot(tangent.x, tangent.z),
            orientation = signedArea(site[0]!) > 0 ? 1 : -1,
            normal = { x: (orientation * tangent.z) / len, z: (-orientation * tangent.x) / len },
            target = request.terminals.mode === 'fixed' ? request.terminals.entrance : p;
          let rotation = angle(normal) - angle(slot.physical.normal);
          if (request.placement.mode === 'free') rotation += (random.next() - 0.5) * 0.06;
          if (request.placement.mode === 'orthogonal')
            rotation = base + (Math.round((rotation - base) / (Math.PI / 2)) * Math.PI) / 2;
          const rotated = make(definition, `${prefix}/module-0`, { x: 0, z: 0 }, rotation),
            actual = rotated.slots.find(
              (s) =>
                s.opening.regionId === slot.opening.regionId &&
                Math.abs(s.opening.uCenter - slot.opening.uCenter) < 1e-8,
            )!;
          if (actual.physical.normal.x * normal.x + actual.physical.normal.z * normal.z < 0.6)
            continue;
          const center = plus(target, normal, -0.3),
            position = plus(center, actual.physical.center, -1),
            candidate = make(definition, `${prefix}/module-0`, position, rotation);
          if (!fits(candidate, null, null)) continue;
          entrance = candidate.slots.find((s) => s.key.endsWith(slot.key.slice('local'.length)))!;
          if (
            request.terminals.mode === 'fixed' &&
            distance(entrance.physical.center, request.terminals.entrance) > 1
          )
            continue;
          add(candidate);
          used.add(entrance.key);
          doc.openings.push({ ...entrance.opening, role: 'entrance' });
          break;
        }
        if (!entrance) {
          lastDiagnostic = diagnostic(
            'NO_ROOT_PLACEMENT',
            'Не найден допустимый корень за фиксированные пробы',
          );
          continue;
        }
        while (
          doc.instances.length < request.allocation.maxModules &&
          counters.placementChecks < request.budgets.placementChecksPerVariant
        ) {
          const frontier = available(placed, used).filter((s) => !closed.has(s.key));
          if (!frontier.length) break;
          // Prefer adding a choice to long degree-two chains before surrounding rooms close their frontier.
          // This is a placement heuristic only; the final oracle still measures actual physical paths.
          const rootId = placed[0]!.instance.id,
            degree = (id: string) => (neighbors.get(id)?.length ?? 0) + (id === rootId ? 1 : 0),
            span = new Map(
              placed.map((p) => {
                const box = bounds(p.floor[0]!);
                return [
                  p.instance.id,
                  Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) + 0.5,
                ] as const;
              }),
            ),
            priorities = new Map<string, number>();
          if (request.constraints.maxForcedM !== null)
            for (const p of placed) {
              const id = p.instance.id;
              if (degree(id) !== 2) continue;
              let n = span.get(id)!;
              const seen = new Set([id]);
              for (const first of neighbors.get(id) ?? []) {
                let at = first,
                  previous = id;
                while (!seen.has(at) && degree(at) === 2) {
                  seen.add(at);
                  n += span.get(at)!;
                  const next = (neighbors.get(at) ?? []).find((v) => v !== previous);
                  if (!next) break;
                  previous = at;
                  at = next;
                }
              }
              if (n > request.constraints.maxForcedM * 0.55) priorities.set(id, n);
            }
          const preferred = frontier.filter((s) => priorities.has(s.opening.instanceId)),
            directed =
              request.terminals.mode === 'fixed'
                ? [...frontier]
                    .sort(
                      (a, b) =>
                        distance(a.physical.center, (request.terminals as { exit: Point }).exit) -
                        distance(b.physical.center, (request.terminals as { exit: Point }).exit),
                    )
                    .slice(0, 3)
                : frontier,
            pool =
              preferred.length && random.next() < 0.85
                ? preferred
                : request.terminals.mode === 'fixed' && random.next() < 0.8
                  ? directed
                  : frontier,
            a = pool[Math.floor(random.next() * pool.length)]!;
          let accepted = false;
          for (
            let pose = 0;
            pose < 32 && counters.placementChecks < request.budgets.placementChecksPerVariant;
            pose++
          ) {
            counters.placementChecks++;
            const definition = pickDefinition();
            if (!definition) break;
            const slots = local.get(definition.contentHash)!.slots,
              slot = slots[Math.floor(random.next() * slots.length)]!;
            let rotation = angle(a.physical.normal) + Math.PI - angle(slot.physical.normal);
            if (request.placement.mode === 'orthogonal')
              rotation = base + (Math.round((rotation - base) / (Math.PI / 2)) * Math.PI) / 2;
            else rotation += (random.next() - 0.5) * (pose % 4 === 0 ? 0 : 0.3);
            const id = `${prefix}/module-${doc.instances.length}`,
              zero = make(definition, id, { x: 0, z: 0 }, rotation),
              incoming = zero.slots.find(
                (s) =>
                  s.opening.regionId === slot.opening.regionId &&
                  Math.abs(s.opening.uCenter - slot.opening.uCenter) < 1e-8,
              )!,
              gap = pose % 4 === 0 ? 0.18 : 0.18 + random.next() * 0.15,
              position = plus(
                plus(a.physical.center, a.physical.normal, gap),
                incoming.physical.center,
                -1,
              ),
              initial = make(definition, id, position, rotation);
            let candidate = initial;
            if (request.terminals.mode === 'fixed') {
              const goal = request.terminals.exit,
                nearest = initial.slots
                  .filter((s) => s.key !== incoming.key)
                  .sort(
                    (a, b) => distance(a.physical.center, goal) - distance(b.physical.center, goal),
                  )[0];
              if (nearest && distance(nearest.physical.center, goal) < 2) {
                const delta = plus(
                    plus(goal, nearest.physical.normal, -0.3),
                    nearest.physical.center,
                    -1,
                  ),
                  shift = delta.x * a.physical.normal.x + delta.z * a.physical.normal.z;
                if (shift > 0 && shift < 1.25)
                  candidate = make(
                    definition,
                    id,
                    plus(position, a.physical.normal, shift),
                    rotation,
                  );
              }
            }
            const b = candidate.slots.find((s) => s.key === incoming.key)!;
            if (!connectionFacing(a.physical, b.physical)) continue;
            if (request.constraints.maxForcedM !== null && degree(a.opening.instanceId) === 1) {
              const box = bounds(candidate.floor[0]!);
              let upper =
                  Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) +
                  0.5 +
                  distance(a.physical.center, b.physical.center),
                at = a.opening.instanceId,
                previous = '',
                seen = new Set<string>();
              while (!seen.has(at)) {
                seen.add(at);
                upper += span.get(at)!;
                const next = (neighbors.get(at) ?? []).find((id) => id !== previous);
                if (!next || degree(next) !== 2) break;
                previous = at;
                at = next;
              }
              if (upper > request.constraints.maxForcedM * 0.85) continue;
            }
            let c: Polygon;
            try {
              c = corridor(a, b);
              if (c.length)
                c = contourPolygon([
                  {
                    id: 'corridor',
                    role: 'outer',
                    segments: c[0]!.map((from, i) => ({
                      id: `c${i}`,
                      kind: 'line',
                      from,
                      to: c[0]![(i + 1) % 4]!,
                    })),
                  },
                ]);
            } catch {
              continue;
            }
            if (!fits(candidate, c, a.opening.instanceId)) continue;
            add(candidate);
            connect(a, b);
            accepted = true;
            break;
          }
          if (!accepted) closed.add(a.key);
          yield progress('growth');
        }
        if (doc.instances.length === request.allocation.maxModules) stopReason = 'module-limit';
        else if (counters.placementChecks >= request.budgets.placementChecksPerVariant)
          stopReason = 'work-limit';
        if (doc.instances.length < request.allocation.minModules) {
          lastDiagnostic = diagnostic(
            'MIN_MODULES',
            'Не достигнут обязательный минимум модулей',
            doc.instances.length,
            request.allocation.minModules,
          );
          continue;
        }
        const exitCandidates = available(placed, used).filter(
          (s) =>
            request.terminals.mode === 'auto' ||
            distance(s.physical.center, request.terminals.exit) <= 1,
        );
        if (!exitCandidates.length) {
          lastDiagnostic = diagnostic('NO_EXIT', 'Не найден допустимый выход в заданном допуске');
          continue;
        }
        // A provisional terminal permits navigation; all other candidates remain closed until selected.
        let exit = exitCandidates[0]!;
        doc.openings.push({ ...exit.opening, role: 'exit' });
        yield progress('validation');
        counters.fullValidations++;
        let compiled = compileGeometry(doc);
        if (!compiled.ok) {
          if (fatal(compiled.diagnostics))
            return {
              status: 'failed',
              requestHash: hash,
              variants,
              diagnostics: compiled.diagnostics,
              nextVariantIndex: variantIndex,
            };
          lastDiagnostic = compiled.diagnostics[0]!;
          continue;
        }
        let navigation = buildNavigation(compiled.snapshot);
        if (!navigation.ok) {
          if (fatal(navigation.diagnostics))
            return {
              status: 'failed',
              requestHash: hash,
              variants,
              diagnostics: navigation.diagnostics,
              nextVariantIndex: variantIndex,
            };
          lastDiagnostic = navigation.diagnostics[0]!;
          continue;
        }
        let longest = -1;
        const distances = graphDistances(navigation.snapshot);
        for (const candidate of exitCandidates) {
          const inside = plus(
            candidate.physical.center,
            candidate.physical.normal,
            -(request.physicalProfile.playerRadiusM + 0.2),
          );
          const node = navigation.snapshot.semantic.nodes.find(
            (n) => n.roomId === candidate.opening.instanceId && pointInPolygon(inside, n.region),
          );
          if (!node || !distances.has(node.id)) continue;
          const path = roomPath(navigation.snapshot, node.region, node.position, inside),
            len = distances.get(node.id)! + pathLength(path);
          if (path.length && len > longest + 1e-8) {
            longest = len;
            exit = candidate;
          }
        }
        if (longest < 0) {
          lastDiagnostic = diagnostic('NO_EXIT', 'Нет физически достижимого внешнего выхода');
          continue;
        }
        doc.openings[doc.openings.length - 1] = { ...exit.opening, role: 'exit' };
        used.add(exit.key);
        yield progress('cycles');
        const cyclesNeeded =
          request.topology.extraConnections - navigation.snapshot.semantic.cycles;
        if (cyclesNeeded < 0) {
          lastDiagnostic = diagnostic(
            'CYCLES_EXCESS',
            'Каталог уже создаёт больше физических циклов, чем запрошено',
            navigation.snapshot.semantic.cycles,
            request.topology.extraConnections,
          );
          continue;
        }
        if (request.topology.mode === 'cyclic' && cyclesNeeded > 0) {
          const free = available(placed, used),
            pairs: { a: Slot; b: Slot; distance: number }[] = [];
          const slotIndex = buildSpatialIndex(free.map((s) => bounds([s.physical.center])));
          for (let i = 0; i < free.length; i++) {
            const a = free[i]!,
              p = a.physical.center,
              r = request.physicalProfile.maxConnectionSpanM;
            for (const j of querySpatialIndex(slotIndex, {
              minX: p.x - r,
              maxX: p.x + r,
              minZ: p.z - r,
              maxZ: p.z + r,
            })) {
              if (j <= i) continue;
              const b = free[j]!,
                d = distance(p, b.physical.center);
              if (
                a.opening.instanceId !== b.opening.instanceId &&
                d <= r &&
                connectionFacing(a.physical, b.physical)
              )
                pairs.push({ a, b, distance: d });
            }
          }
          pairs.sort(
            (a, b) =>
              a.distance - b.distance ||
              (a.a.key < b.a.key ? -1 : a.a.key > b.a.key ? 1 : a.b.key < b.b.key ? -1 : 1),
          );
          let added = 0;
          for (const { a, b } of pairs) {
            if (added === cyclesNeeded) break;
            if (used.has(a.key) || used.has(b.key)) continue;
            counters.cycleChecks++;
            if (request.constraints.maxForcedM !== null) {
              const degree = (id: string) =>
                  (neighbors.get(id)?.length ?? 0) +
                  (id === entrance.opening.instanceId ? 1 : 0) +
                  (id === exit.opening.instanceId ? 1 : 0),
                tail = (id: string) => {
                  if (degree(id) !== 1) return 0;
                  let sum = 0,
                    at = id,
                    previous = '';
                  const seen = new Set<string>();
                  while (!seen.has(at)) {
                    seen.add(at);
                    const box = bounds(placed.find((p) => p.instance.id === at)!.floor[0]!);
                    sum += Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) + 0.5;
                    const next = (neighbors.get(at) ?? []).find((n) => n !== previous);
                    if (!next || degree(next) !== 2) break;
                    previous = at;
                    at = next;
                  }
                  return sum;
                };
              // Joining two leaves merges their forced chains even though it adds a cycle.
              if (
                tail(a.opening.instanceId) +
                  tail(b.opening.instanceId) +
                  distance(a.physical.center, b.physical.center) >
                request.constraints.maxForcedM * 0.85
              )
                continue;
            }
            const c = corridor(a, b);
            let valid = true;
            try {
              if (!c.length || multiArea(kernel.boolean('difference', [c], sitePrepared)) > 1e-8)
                continue;
              for (const p of placed)
                if (
                  ![a.opening.instanceId, b.opening.instanceId].includes(p.instance.id) &&
                  multiArea(kernel.boolean('intersection', [c], [p.floor])) > 1e-8
                ) {
                  valid = false;
                  break;
                }
              if (
                !valid ||
                corridors.some((p) => multiArea(kernel.boolean('intersection', [c], [p])) > 1e-8)
              )
                continue;
            } catch {
              continue;
            }
            doc.openings.push(a.opening, b.opening);
            doc.connections.push({
              id: `${prefix}/cycle-${added}`,
              openingA: a.key,
              openingB: b.key,
            });
            counters.fullValidations++;
            const proof = compileGeometry(doc);
            if (!proof.ok) {
              doc.openings.splice(-2);
              doc.connections.pop();
              continue;
            }
            used.add(a.key);
            used.add(b.key);
            corridors.push(c);
            for (const [from, to] of [
              [a.opening.instanceId, b.opening.instanceId],
              [b.opening.instanceId, a.opening.instanceId],
            ])
              neighbors.set(from!, [...(neighbors.get(from!) ?? []), to!]);
            added++;
            yield progress('cycles');
          }
          if (added !== cyclesNeeded) {
            lastDiagnostic = diagnostic(
              'CYCLES_NOT_MET',
              'Недостаточно физических пар для точного числа циклов',
              added,
              request.topology.extraConnections,
            );
            continue;
          }
        }
        yield progress('validation');
        counters.fullValidations++;
        compiled = compileGeometry(doc);
        if (!compiled.ok) {
          if (fatal(compiled.diagnostics))
            return {
              status: 'failed',
              requestHash: hash,
              variants,
              diagnostics: compiled.diagnostics,
              nextVariantIndex: variantIndex,
            };
          lastDiagnostic = compiled.diagnostics[0]!;
          continue;
        }
        navigation = buildNavigation(compiled.snapshot);
        if (!navigation.ok) {
          if (fatal(navigation.diagnostics))
            return {
              status: 'failed',
              requestHash: hash,
              variants,
              diagnostics: navigation.diagnostics,
              nextVariantIndex: variantIndex,
            };
          lastDiagnostic = navigation.diagnostics[0]!;
          continue;
        }
        if (navigation.snapshot.semantic.cycles !== request.topology.extraConnections) {
          lastDiagnostic = diagnostic(
            'CYCLE_RANK',
            'Физический семантический граф имеет другое число циклов',
            navigation.snapshot.semantic.cycles,
            request.topology.extraConnections,
          );
          continue;
        }
        const metrics = generationMetrics(compiled.snapshot, navigation.snapshot, siteArea);
        if (
          request.constraints.maxStraightM !== null &&
          metrics.maxStraightM > request.constraints.maxStraightM + 1e-6
        ) {
          lastDiagnostic = diagnostic(
            'STRAIGHT_LIMIT',
            'Превышен предел прямого хода, м',
            metrics.maxStraightM,
            request.constraints.maxStraightM,
          );
          continue;
        }
        if (
          request.constraints.maxForcedM !== null &&
          metrics.maxForcedM > request.constraints.maxForcedM + 1e-6
        ) {
          lastDiagnostic = diagnostic(
            'FORCED_LIMIT',
            'Превышен предел хода без выбора, м',
            metrics.maxForcedM,
            request.constraints.maxForcedM,
          );
          continue;
        }
        const targetMet =
          request.allocation.mode === 'module-budget' ||
          metrics.coverage + 1e-9 >= request.constraints.coverageTarget;
        if (!targetMet && request.constraints.hardCoverage) {
          lastDiagnostic = diagnostic(
            'COVERAGE_LIMIT',
            'Не достигнута обязательная доля покрытия',
            metrics.coverage,
            request.constraints.coverageTarget,
          );
          continue;
        }
        const unusedModules: Record<string, number> = {};
        for (const [h, cap] of Object.entries(request.allocation.caps))
          unusedModules[h] = Math.max(0, cap - (counts.get(h) ?? 0));
        const candidate: GenerationVariant = {
          status: targetMet ? 'ready' : 'target-not-met',
          document: compiled.snapshot.document,
          revisionHash: documentHashes(compiled.snapshot.document).revisionHash,
          worldHash: compiled.snapshot.worldHash,
          navHash: navigation.snapshot.navHash,
          diversityHash: diversityHash(compiled.snapshot),
          metrics,
          manifest: {
            requestHash: hash,
            request,
            variantIndex,
            attemptIndex,
            variantSeed: seed,
            counters: { ...counters },
            unusedModules,
            stopReason,
          },
        };
        if (
          !best ||
          candidate.status === 'ready' ||
          candidate.metrics.coverage > best.metrics.coverage ||
          (candidate.metrics.coverage === best.metrics.coverage &&
            (candidate.metrics.routeLengthM > best.metrics.routeLengthM ||
              (candidate.metrics.routeLengthM === best.metrics.routeLengthM &&
                candidate.revisionHash < best.revisionHash)))
        )
          best = candidate;
        if (candidate.status === 'ready') break;
      } catch (e) {
        const d = diagnosticFrom(e);
        if (d.code === 'INTERNAL_ERROR' || d.code === 'GEOMETRY_LIBRARY_ERROR')
          return {
            status: 'failed',
            requestHash: hash,
            variants,
            diagnostics: [d],
            nextVariantIndex: variantIndex,
          };
        lastDiagnostic = d;
      }
    }
    if (best) {
      if (variants.some((v) => v.diversityHash === best!.diversityHash))
        diagnostics.push(
          diagnostic(
            'DUPLICATE_VARIANT',
            `Вариант ${variantIndex + 1} повторяет уже найденное размещение`,
          ),
        );
      else {
        variants.push(best);
        yield {
          stage: 'variant',
          variantIndex,
          attemptIndex: best.manifest.attemptIndex,
          workDone: counters.placementChecks,
          workLimit: request.budgets.placementChecksPerVariant,
          counters: { ...counters },
          variant: best,
        };
      }
    } else diagnostics.push({ ...lastDiagnostic, path: `generation.variant[${variantIndex}]` });
  }
  return {
    status:
      variants.length === request.requestedVariants - startVariantIndex &&
      variants.every((v) => v.status === 'ready')
        ? 'complete'
        : 'exhausted',
    requestHash: hash,
    variants,
    diagnostics,
    nextVariantIndex: request.requestedVariants,
  };
}
export function generateSync(request: unknown, startVariantIndex = 0): GenerationResult {
  const search = generate(request, startVariantIndex);
  let step = search.next();
  while (!step.done) step = search.next();
  return step.value;
}
