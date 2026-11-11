import { instanceBoundary, validateCatalogDefinition } from '../../catalog/catalog';
import { documentHashes, DomainError, LIMITS, normalizeDocument, worldHash } from '../../domain';
import type { BoundaryLoop, Diagnostic, Document, Point, Segment } from '../../domain';
import { fail } from '../../domain/validate';
import { buildSpatialIndex, querySpatialIndex } from '../spatial-index';
import { kernel } from '../kernel/boolean';
import {
  contourPolygon,
  multiArea,
  polygonArea,
  sampleSegment,
  segmentLength,
  segmentPoint,
  validatePolygon,
} from '../kernel/contour';
import type { MultiPolygon, Polygon } from '../kernel/contour';
import {
  bounds,
  boundsOverlap,
  distance,
  lerp,
  pointSegmentDistance,
  ringEdges,
} from '../predicates';
import { beamEnvelope } from './beam';
import { connectionFacing, openingCut, samePoint } from './openings';
import type { OpeningCut } from './openings';
import type {
  CompileResult,
  Fastener,
  PhysicalConnection,
  PhysicalOpening,
  PhysicalSnapshot,
  Room,
  Solid,
} from './types';

export function strip(a: Point, b: Point, width: number): Polygon {
  const length = distance(a, b);
  if (length < 1e-9) fail('DEGENERATE', 'solid', 'Zero-length strip');
  const n = { x: ((-(b.z - a.z) / length) * width) / 2, z: (((b.x - a.x) / length) * width) / 2 };
  return [
    [
      { x: a.x + n.x, z: a.z + n.z },
      { x: b.x + n.x, z: b.z + n.z },
      { x: b.x - n.x, z: b.z - n.z },
      { x: a.x - n.x, z: a.z - n.z },
    ],
  ];
}
const pointKey = (p: Point) => `${Math.round(p.x * 1e6)},${Math.round(p.z * 1e6)}`;
function physicalBoundary(
  loops: BoundaryLoop[],
  cuts: OpeningCut[],
  maxSpan: number,
): { floor: Polygon; walls: [Point, Point][]; supports: Set<string> } {
  const walls: [Point, Point][] = [],
    rings: Point[][] = [],
    supports = new Set<string>();
  for (const loop of [
    ...loops.filter((l) => l.role === 'outer'),
    ...loops.filter((l) => l.role === 'hole'),
  ]) {
    const ring: Point[] = [];
    for (const segment of loop.segments) {
      const own = cuts.filter((c) => c.segment.id === segment.id);
      const basic = sampleSegment(segment),
        us = new Set(Array.from({ length: basic.length }, (_, i) => i / (basic.length - 1)));
      for (const c of own)
        for (const [a, b] of c.intervals) {
          us.add(a);
          us.add(b);
        }
      const inCut = (u: number) =>
        own.some((c) => c.intervals.some(([a, b]) => u > a + 1e-10 && u < b - 1e-10));
      const boundaries = [...new Set([0, 1, ...own.flatMap((c) => c.intervals.flat())])].sort(
        (a, b) => a - b,
      );
      for (let i = 0; i + 1 < boundaries.length; i++) {
        const lo = boundaries[i]!,
          hi = boundaries[i + 1]!;
        if (inCut((lo + hi) / 2)) continue;
        const spans = Math.max(
          1,
          Math.ceil((segmentLength(segment) * (hi - lo)) / (maxSpan + 1e-6)),
        );
        for (let j = 0; j <= spans; j++) {
          const u = lo + ((hi - lo) * j) / spans;
          us.add(u);
          supports.add(pointKey(segmentPoint(segment, u)));
        }
      }
      const sorted = [...us].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length - 1; i++) {
        const u = sorted[i]!,
          v = sorted[i + 1]!,
          a = segmentPoint(segment, u),
          b = segmentPoint(segment, v);
        const isSeam = u === 0 && own.some((c) => c.startU < 0 || c.endU > 1);
        if (!inCut(u) && !isSeam) ring.push(a);
        if (!inCut((u + v) / 2) && distance(a, b) > 1e-6) walls.push([a, b]);
      }
    }
    rings.push(ring);
  }
  return { floor: validatePolygon(rings), walls, supports };
}
function blockedWidth(opening: PhysicalOpening, solids: Solid[]): number {
  const length = distance(opening.start, opening.end),
    t = {
      x: (opening.end.x - opening.start.x) / length,
      z: (opening.end.z - opening.start.z) / length,
    };
  const project = (p: Point) => ({
    u: (p.x - opening.start.x) * t.x + (p.z - opening.start.z) * t.z,
    v: (p.x - opening.start.x) * opening.normal.x + (p.z - opening.start.z) * opening.normal.z,
  });
  const blocked: [number, number][] = [];
  for (const solid of solids) {
    if (solid.bottomM >= 1.75) continue;
    const ring = solid.footprint[0]!.map(project),
      xs: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      if (Math.abs(a.v) < 1e-7) xs.push(a.u);
      if (a.v * b.v < 0) xs.push(a.u + ((b.u - a.u) * -a.v) / (b.v - a.v));
    }
    if (xs.length) {
      const lo = Math.max(0, Math.min(...xs)),
        hi = Math.min(length, Math.max(...xs));
      if (hi > lo) blocked.push([lo, hi]);
    }
  }
  blocked.sort((a, b) => a[0] - b[0]);
  let cursor = 0,
    longest = 0;
  for (const [lo, hi] of blocked) {
    longest = Math.max(longest, lo - cursor);
    cursor = Math.max(cursor, hi);
  }
  return Math.max(longest, length - cursor);
}
interface CompileContext {
  objectIds: string[];
  location: Point | null;
}
function compile(value: unknown, context: CompileContext): PhysicalSnapshot {
  const document = normalizeDocument(value),
    profile = document.physicalProfile;
  document.definitions.forEach(validateCatalogDefinition);
  const hashes = documentHashes(document),
    solids: Solid[] = [],
    rooms: Room[] = [],
    passages: PhysicalOpening[] = [],
    connections: PhysicalConnection[] = [];
  const wallKeys = new Map<string, Solid>(),
    postKeys = new Set<string>();
  let physicalSegments = 0;
  const reserve = (n: number) => {
    physicalSegments += n;
    if (physicalSegments > LIMITS.physicalSegments)
      fail(
        'RESOURCE_LIMIT',
        'compile',
        'Physical segment limit exceeded',
        physicalSegments,
        LIMITS.physicalSegments,
      );
  };
  const add = (solid: Solid) => {
    reserve(solid.footprint.reduce((n, r) => n + r.length, 0));
    solids.push(solid);
  };
  const board = (
    id: string,
    owner: string,
    a: Point & { y: number },
    b: Point & { y: number },
    widthM: number,
    thicknessM: number,
    normal: Point,
    kind: Solid['kind'],
  ) => {
    const envelope = beamEnvelope(a, b, widthM, thicknessM, { ...normal, y: 0 });
    add({
      id,
      ownerIds: [owner],
      kind,
      footprint: envelope.footprint,
      from: a,
      to: b,
      bottomM: envelope.bottomM,
      topM: envelope.topM,
      widthM,
      thicknessM,
      beam: { from: a, to: b, widthM, thicknessM, normal: envelope.normal },
    });
  };
  const construct = (
    owner: string,
    walls: [Point, Point][],
    maxSpan: number,
    lower: boolean,
    supports?: Set<string>,
  ) => {
    const spans = walls.flatMap(([a, b]) => {
      const count = Math.ceil(distance(a, b) / (maxSpan + 1e-6));
      return Array.from(
        { length: count },
        (_, i) => [lerp(a, b, i / count), lerp(a, b, (i + 1) / count)] as [Point, Point],
      );
    });
    for (let index = 0; index < spans.length; index++) {
      const [a, b] = spans[index]!,
        length = distance(a, b),
        t = { x: (b.x - a.x) / length, z: (b.z - a.z) / length },
        n = { x: -t.z, z: t.x };
      if (length > maxSpan + 1e-6)
        fail('SPAN', owner, `Wall span exceeds ${maxSpan} m`, length, maxSpan);
      const key = [pointKey(a), pointKey(b)].sort().join('|'),
        existing = wallKeys.get(key);
      if (existing) {
        if (!existing.ownerIds.includes(owner)) existing.ownerIds.push(owner);
        continue;
      }
      const id = `${owner}/wall-${index}`;
      const panel: Solid = {
        id,
        ownerIds: [owner],
        kind: 'panel',
        from: a,
        to: b,
        footprint: strip(a, b, profile.panelThicknessM),
        bottomM: 0,
        topM: profile.wallHeightM,
        widthM: profile.wallHeightM,
        thicknessM: profile.panelThicknessM,
      };
      add(panel);
      wallKeys.set(key, panel);
      for (const p of [a, b].filter((p) => !supports || supports.has(pointKey(p)))) {
        const key = pointKey(p);
        if (postKeys.has(key)) continue;
        postKeys.add(key);
        board(
          `${owner}/post-${key}/a`,
          owner,
          { ...p, y: 0 },
          { ...p, y: profile.wallHeightM },
          profile.boardWidthM,
          profile.boardThicknessM,
          n,
          'post-board',
        );
        board(
          `${owner}/post-${key}/b`,
          owner,
          { ...p, y: 0 },
          { ...p, y: profile.wallHeightM },
          profile.boardWidthM,
          profile.boardThicknessM,
          t,
          'post-board',
        );
      }
      const header = Math.min(profile.headerDepthM, Math.max(0.02, profile.wallHeightM - 1.78));
      const y = profile.wallHeightM - header / 2;
      for (const side of [-1, 1]) {
        const offset = side * (profile.panelThicknessM / 2 + profile.boardThicknessM / 2 + 0.002);
        const shift = (p: Point) => ({ x: p.x + n.x * offset, z: p.z + n.z * offset });
        board(
          `${id}/rail-${side}`,
          owner,
          { ...shift(a), y },
          { ...shift(b), y },
          header,
          profile.boardThicknessM,
          { x: n.x * side, z: n.z * side },
          'upper-rail',
        );
        const drop = Math.min(0.4, profile.wallHeightM - header - 1.85),
          span = Math.min(length * 0.32, Math.max(0, drop) * 1.15);
        if (drop > 0.06 && span > 0.08) {
          for (const [point, sign] of [
            [a, 1],
            [b, -1],
          ] as const) {
            if (supports && !supports.has(pointKey(point))) continue;
            const low = { ...shift(point), y: y - drop },
              high = { x: low.x + t.x * span * sign, z: low.z + t.z * span * sign, y };
            board(
              `${id}/brace-${side}-${sign}`,
              owner,
              low,
              high,
              profile.boardWidthM * 0.8,
              profile.boardThicknessM,
              { x: n.x * side, z: n.z * side },
              'brace',
            );
          }
        }
      }
      if (lower) {
        const offset = profile.panelThicknessM / 2 + profile.boardThicknessM / 2 + 0.002;
        board(
          `${id}/lower`,
          owner,
          { x: a.x + n.x * offset, z: a.z + n.z * offset, y: profile.boardWidthM / 2 },
          { x: b.x + n.x * offset, z: b.z + n.z * offset, y: profile.boardWidthM / 2 },
          profile.boardWidthM,
          profile.boardThicknessM,
          n,
          'lower-rail',
        );
      }
    }
  };
  const site = contourPolygon(document.site.boundaryLoops),
    siteBounds = bounds(site[0]!);
  if (
    siteBounds.maxX - siteBounds.minX > 100 + 1e-6 ||
    siteBounds.maxZ - siteBounds.minZ > 100 + 1e-6
  )
    fail('RESOURCE_LIMIT', 'site', 'Site bounds exceed 100×100 m');
  for (const instance of document.instances) {
    context.objectIds = [instance.id];
    context.location = instance.position;
    const definition = document.definitions.find((d) => d.contentHash === instance.definitionHash)!,
      loops = instanceBoundary(document, instance);
    const own = document.openings.filter((o) => o.instanceId === instance.id);
    const cuts = own.map((opening) => {
      context.objectIds = [instance.id, opening.id];
      const region = definition.openingRegions.find((r) => r.id === opening.regionId)!,
        loop = loops.find((l) => l.segments.some((s) => s.id === opening.boundarySegmentId))!;
      if (loop.role !== 'outer')
        fail('OPENING_REGION', opening.id, 'Openings in internal forbidden holes are unsupported');
      return openingCut(opening, region, loop, profile.postWidthM);
    });
    for (let i = 0; i < cuts.length; i++)
      for (let j = i + 1; j < cuts.length; j++) {
        const a = cuts[i]!,
          b = cuts[j]!;
        if (a.segment.id !== b.segment.id) continue;
        if (
          a.intervals.some(([lo, hi]) =>
            b.intervals.some(([x, y]) => Math.max(lo, x) < Math.min(hi, y) + 1e-6),
          )
        )
          fail('OPENING_OVERLAP', instance.id, 'Opening cuts overlap');
      }
    context.objectIds = [instance.id];
    const { floor, walls, supports } = physicalBoundary(
      loops,
      cuts,
      definition.constructionProfile.maxSpanM,
    );
    reserve(floor.reduce((n, r) => n + r.length, 0));
    if (multiArea(kernel.boolean('difference', [floor], [site])) > 1e-8)
      fail('OUTSIDE_SITE', instance.id, 'Module crosses site or a forbidden hole');
    for (const other of rooms) {
      if (
        boundsOverlap(bounds(floor[0]!), bounds(other.floor[0]!)) &&
        multiArea(kernel.boolean('intersection', [floor], [other.floor])) > 1e-8
      )
        fail('OVERLAP', instance.id, `Module overlaps ${other.id}`);
    }
    rooms.push({ id: instance.id, floor, maxSpanM: definition.constructionProfile.maxSpanM });
    passages.push(...cuts.map((c) => c.physical));
    construct(
      instance.id,
      walls,
      definition.constructionProfile.maxSpanM,
      definition.constructionProfile.maxSpanM > 3,
      supports,
    );
  }
  context.objectIds = [];
  context.location = null;
  const headerKeys = new Set<string>();
  for (const opening of passages) {
    context.objectIds = [opening.instanceId, opening.id];
    context.location = opening.center;
    const key = [opening.start, opening.end]
      .map((p) => `${Math.round(p.x * 1e6)},${Math.round(p.z * 1e6)}`)
      .sort()
      .join('|');
    if (headerKeys.has(key)) continue;
    headerKeys.add(key);
    const height = Math.min(profile.headerDepthM, Math.max(0.02, profile.wallHeightM - 1.78)),
      y = profile.wallHeightM - height / 2;
    for (const sign of [-1, 1]) {
      const offset = sign * (profile.panelThicknessM / 2 + profile.boardThicknessM / 2 + 0.002),
        shift = (p: Point) => ({
          x: p.x + opening.normal.x * offset,
          z: p.z + opening.normal.z * offset,
          y,
        });
      board(
        `${opening.id}/header-${sign}`,
        opening.instanceId,
        shift(opening.start),
        shift(opening.end),
        height,
        profile.boardThicknessM,
        { x: opening.normal.x * sign, z: opening.normal.z * sign },
        'upper-rail',
      );
    }
  }
  context.objectIds = [];
  context.location = null;
  const openingMap = new Map(passages.map((p) => [p.id, p]));
  const connected = new Set(document.connections.flatMap((c) => [c.openingA, c.openingB]));
  for (const opening of passages)
    if (opening.role === 'ordinary' && !connected.has(opening.id))
      fail('OPEN_END', opening.id, 'Ordinary opening has no explicit connection');
  if (
    passages.filter((p) => p.role === 'entrance').length !== 1 ||
    passages.filter((p) => p.role === 'exit').length !== 1
  )
    fail('TERMINALS', 'document', 'Exactly one entrance and one exit required');
  for (const c of document.connections) {
    context.objectIds = [c.id, c.openingA, c.openingB];
    context.location = openingMap.get(c.openingA)?.center ?? null;
    const a = openingMap.get(c.openingA)!,
      b = openingMap.get(c.openingB)!;
    if (!connectionFacing(a, b))
      fail('NORMALS', c.id, 'Opening normals do not face the connection');
    const direct = samePoint(a.start, b.end) && samePoint(a.end, b.start);
    if (direct) {
      connections.push({
        id: c.id,
        openingA: a.id,
        openingB: b.id,
        direct: true,
        floor: [],
        lengthM: 0,
      });
      continue;
    }
    const sides: [Point, Point][] = [
      [a.start, b.end],
      [b.start, a.end],
    ];
    const lengths = sides.map(([x, y]) => distance(x, y));
    if (lengths.some((n) => n > profile.maxConnectionSpanM + 1e-6))
      fail(
        'SPAN',
        c.id,
        'Connection side exceeds maximum span',
        Math.max(...lengths),
        profile.maxConnectionSpanM,
      );
    if (lengths.some((n) => n <= 1e-6)) fail('DEGENERATE', c.id, 'Partially collapsed connection');
    const floor = validatePolygon([[a.start, b.end, b.start, a.end]], c.id);
    const narrow =
      Math.min(
        ...sides[0]!.map((p) => pointSegmentDistance(p, ...sides[1]!)),
        ...sides[1]!.map((p) => pointSegmentDistance(p, ...sides[0]!)),
      ) - profile.panelThicknessM;
    if (narrow < profile.minClearanceM - 1e-8)
      fail(
        'WIDTH',
        c.id,
        'Real connection clearance is below minimum',
        narrow,
        profile.minClearanceM,
      );
    if (multiArea(kernel.boolean('difference', [floor], [site])) > 1e-8)
      fail('OUTSIDE_SITE', c.id, 'Connection crosses site or forbidden zone');
    for (const room of rooms)
      if (
        boundsOverlap(bounds(floor[0]!), bounds(room.floor[0]!)) &&
        multiArea(kernel.boolean('intersection', [floor], [room.floor])) > 1e-7
      )
        fail('OVERLAP', c.id, `Connection intersects module ${room.id}`);
    for (const other of connections)
      if (
        !other.direct &&
        boundsOverlap(bounds(floor[0]!), bounds(other.floor[0]!)) &&
        multiArea(kernel.boolean('intersection', [floor], [other.floor])) > 1e-8
      )
        fail('OVERLAP', c.id, `Connection intersects ${other.id}`);
    connections.push({
      id: c.id,
      openingA: a.id,
      openingB: b.id,
      direct: false,
      floor,
      lengthM: distance(a.center, b.center),
    });
    reserve(4);
    construct(c.id, sides, profile.maxConnectionSpanM, false);
  }
  for (const wall of document.freeWalls) {
    context.objectIds = [wall.id];
    context.location = segmentPoint(wall.centerline, 0);
    const count = Math.max(1, Math.ceil(segmentLength(wall.centerline) / 3)),
      us = Array.from({ length: count + 1 }, (_, i) => i / count),
      points = sampleSegment(wall.centerline, us),
      segments = points.slice(0, -1).map((a, i) => [a, points[i + 1]!] as [Point, Point]);
    const first = solids.length;
    construct(
      wall.id,
      segments,
      3,
      false,
      new Set(us.map((u) => pointKey(segmentPoint(wall.centerline, u)))),
    );
    for (const solid of solids.slice(first)) {
      if (multiArea(kernel.boolean('difference', [solid.footprint], [site])) > 1e-8)
        fail('OUTSIDE_SITE', wall.id, 'Separate wall crosses site or forbidden zone');
      for (const connection of connections)
        if (
          !connection.direct &&
          multiArea(kernel.boolean('intersection', [solid.footprint], [connection.floor])) > 1e-8
        )
          fail('OVERLAP', wall.id, `Separate wall obstructs connection ${connection.id}`);
    }
  }
  const axisRectangle =
    site.length === 1 &&
    site[0]!.length === 4 &&
    site[0]!.every(
      (p) =>
        (Math.abs(p.x - siteBounds.minX) < 1e-8 || Math.abs(p.x - siteBounds.maxX) < 1e-8) &&
        (Math.abs(p.z - siteBounds.minZ) < 1e-8 || Math.abs(p.z - siteBounds.maxZ) < 1e-8),
    );
  for (const solid of solids) {
    context.objectIds = solid.ownerIds;
    context.location = solid.from;
    const box = bounds(solid.footprint[0]!);
    if (axisRectangle) {
      if (
        box.minX < siteBounds.minX - 1e-6 ||
        box.minZ < siteBounds.minZ - 1e-6 ||
        box.maxX > siteBounds.maxX + 1e-6 ||
        box.maxZ > siteBounds.maxZ + 1e-6
      )
        fail('OUTSIDE_SITE', solid.id, 'Physical construction extends beyond site');
    } else if (multiArea(kernel.boolean('difference', [solid.footprint], [site])) > 1e-8)
      fail('OUTSIDE_SITE', solid.id, 'Physical construction crosses site or forbidden area');
  }
  const solidIndex = buildSpatialIndex(solids.map((s) => bounds(s.footprint[0]!)));
  for (const passage of passages) {
    context.objectIds = [passage.instanceId, passage.id];
    context.location = passage.center;
    const box = bounds([passage.start, passage.end]);
    const candidates = querySpatialIndex(solidIndex, {
      minX: box.minX - 1e-6,
      minZ: box.minZ - 1e-6,
      maxX: box.maxX + 1e-6,
      maxZ: box.maxZ + 1e-6,
    }).map((id) => solids[id]!);
    passage.clearWidthM = blockedWidth(passage, candidates);
    if (passage.clearWidthM < profile.minClearanceM - 1e-8)
      fail(
        'WIDTH',
        passage.id,
        'Actual opening clearance is below minimum',
        passage.clearWidthM,
        profile.minClearanceM,
      );
  }
  context.objectIds = [];
  context.location = null;
  const floors: MultiPolygon = [
    ...rooms.map((r) => r.floor),
    ...connections.filter((c) => !c.direct).map((c) => c.floor),
  ];
  const floor = floors.length
    ? kernel.boolean('union', [floors[0]!], ...floors.slice(1).map((p) => [p]))
    : [];
  const blocking = solids.filter((s) => s.bottomM < 1.75),
    obstacles = blocking.length
      ? kernel.boolean(
          'union',
          [blocking[0]!.footprint],
          ...blocking.slice(1).map((s) => [s.footprint]),
        )
      : [];
  const accessibleRegions = kernel.boolean('difference', floor, obstacles);
  const fasteners: Fastener[] = solids
    .filter((s) => s.kind === 'upper-rail' || s.kind === 'brace')
    .flatMap((s) => {
      const beam = s.beam!;
      return [beam.from, beam.to].map((p, i) => ({
        id: `${s.id}/bolt-${i}`,
        ownerIds: s.ownerIds,
        position: {
          x: p.x + beam.normal.x * (beam.thicknessM / 2 + 0.003),
          y: p.y + beam.normal.y * (beam.thicknessM / 2 + 0.003),
          z: p.z + beam.normal.z * (beam.thicknessM / 2 + 0.003),
        },
        normal: beam.normal,
        radiusM: 0.009,
        thicknessM: 0.007,
      }));
    });
  const quantities = {
    fastenerCount: fasteners.length,
    metalM3: fasteners.length * Math.PI * 0.009 ** 2 * 0.007,
    floorM2: multiArea(floor),
    roofM2: document.environment.roof ? multiArea(floor) : 0,
    fabricM2:
      solids
        .filter((s) => s.kind === 'panel')
        .reduce((n, s) => n + distance(s.from, s.to) * profile.wallHeightM, 0) +
      (document.environment.roof ? multiArea(floor) : 0),
    timberM3: solids
      .filter((s) => s.beam)
      .reduce((n, s) => {
        const b = s.beam!;
        return (
          n +
          Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z, b.to.y - b.from.y) *
            b.widthM *
            b.thicknessM
        );
      }, 0),
    panels: solids.filter((s) => s.kind === 'panel').length,
    postBoards: solids.filter((s) => s.kind === 'post-board').length,
    rails: solids.filter((s) => s.kind === 'upper-rail' || s.kind === 'lower-rail').length,
    braces: solids.filter((s) => s.kind === 'brace').length,
  };
  return {
    worldHash: worldHash(hashes.layoutHash),
    layoutHash: hashes.layoutHash,
    sourceRevision: document.revision,
    document,
    rooms,
    connections,
    openPassages: passages,
    floor,
    roof: document.environment.roof ? floor : [],
    solids,
    fasteners,
    obstacles,
    accessibleRegions,
    bounds: siteBounds,
    spatialIndex: solidIndex,
    segmentCount: physicalSegments,
    quantities,
  };
}
export function compileGeometry(value: unknown): CompileResult {
  const context: CompileContext = { objectIds: [], location: null };
  try {
    return { ok: true, snapshot: compile(value, context) };
  } catch (error) {
    const diagnostic: Diagnostic =
      error instanceof DomainError
        ? error.diagnostic
        : {
            code: 'INTERNAL_ERROR',
            path: 'compile',
            message: 'Unexpected geometry compilation error',
          };
    return {
      ok: false,
      diagnostics: [
        {
          objectIds: [],
          location: null,
          ...diagnostic,
          ...(context.objectIds.length
            ? {
                objectIds: [...context.objectIds],
                location: context.location ? { ...context.location } : null,
              }
            : {}),
        },
      ],
    };
  }
}
