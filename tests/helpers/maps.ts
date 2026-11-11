import { controlCatalog, instantiate } from '../../src/catalog/catalog';
import { createDefinition, emptyDocument, normalizeDocument } from '../../src/domain';
import type { Document, Opening } from '../../src/domain';
export function twoRooms(gap = 2, rotation = 0, widthM = 1.4): Document {
  const d = emptyDocument('fixture-two-rooms'),
    definition = controlCatalog()[0]!;
  d.definitions = [definition];
  const c = Math.cos(rotation),
    s = Math.sin(rotation),
    position = (x: number, z: number) => ({ x: 10 + x * c - z * s, z: 10 + x * s + z * c });
  d.instances = [
    instantiate(definition, 'a', position(0, 0), rotation),
    instantiate(definition, 'b', position(0, 2 + gap), rotation),
  ];
  const op = (id: string, instanceId: string, edge: number, role: Opening['role']): Opening => ({
    id,
    instanceId,
    regionId: `region-edge-${edge}`,
    boundarySegmentId: `edge-${edge}`,
    uCenter: 0.5,
    widthM,
    role,
  });
  d.openings = [
    op('entrance', 'a', 3, 'entrance'),
    op('a-b', 'a', 2, 'ordinary'),
    op('b-a', 'b', 0, 'ordinary'),
    op('exit', 'b', 1, 'exit'),
  ];
  d.connections = [{ id: 'a-to-b', openingA: 'a-b', openingB: 'b-a' }];
  return normalizeDocument(d);
}
export function circleRoom(wrap = true): Document {
  const d = emptyDocument('fixture-circle'),
    definition = controlCatalog()[3]!;
  d.definitions = [definition];
  d.instances = [instantiate(definition, 'circle', { x: 10, z: 10 })];
  d.openings = [
    {
      id: 'entrance',
      instanceId: 'circle',
      regionId: 'region-edge-0',
      boundarySegmentId: 'edge-0',
      uCenter: wrap ? 0.01 : 0.25,
      widthM: 1.4,
      role: 'entrance',
    },
    {
      id: 'exit',
      instanceId: 'circle',
      regionId: 'region-edge-0',
      boundarySegmentId: 'edge-0',
      uCenter: 0.5,
      widthM: 1.4,
      role: 'exit',
    },
  ];
  return normalizeDocument(d);
}
export function obstacleRoom(hole = false): Document {
  const d = emptyDocument('fixture-obstacle');
  const polygon = (id: string, role: 'outer' | 'hole', points: { x: number; z: number }[]) => ({
    id,
    role,
    segments: points.flatMap((a, i) => {
      const b = points[(i + 1) % points.length]!,
        steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3);
      return Array.from({ length: steps }, (_, j) => ({
        id: `${id}-${i}-${j}`,
        kind: 'line' as const,
        from: { x: a.x + ((b.x - a.x) * j) / steps, z: a.z + ((b.z - a.z) * j) / steps },
        to: { x: a.x + ((b.x - a.x) * (j + 1)) / steps, z: a.z + ((b.z - a.z) * (j + 1)) / steps },
      }));
    }),
  });
  const loops = [
    polygon('outer', 'outer', [
      { x: 0, z: 0 },
      { x: 8, z: 0 },
      { x: 8, z: 8 },
      { x: 0, z: 8 },
    ]),
  ];
  if (hole)
    loops.push(
      polygon('hole', 'hole', [
        { x: 3, z: 3 },
        { x: 3, z: 5 },
        { x: 5, z: 5 },
        { x: 5, z: 3 },
      ]),
    );
  const definition = createDefinition({
    id: 'explicit-obstacle',
    version: 1,
    builder: { kind: 'explicitLoops' },
    parameters: [],
    boundaryLoops: loops,
    openingRegions: ['outer-0-1', 'outer-2-1'].map((segmentId) => ({
      id: `region-${segmentId}`,
      segmentId,
      uMin: 0,
      uMax: 1,
      wrap: false,
      minWidthM: 1,
      maxWidthM: 3,
      connectionClass: 'passage',
    })),
    constructionProfile: {
      profileRef: 'physical-v1',
      maxSpanM: 3,
      supportPattern: 'corners-and-openings',
    },
  });
  d.definitions = [definition];
  d.instances = [instantiate(definition, 'room', { x: 10, z: 10 })];
  d.openings = ['outer-0-1', 'outer-2-1'].map((segmentId, i) => ({
    id: i ? 'exit' : 'entrance',
    instanceId: 'room',
    regionId: `region-${segmentId}`,
    boundarySegmentId: segmentId,
    uCenter: 0.5,
    widthM: 1.4,
    role: i ? ('exit' as const) : ('entrance' as const),
  }));
  if (!hole)
    d.freeWalls = [
      {
        id: 'island',
        constructionProfileRef: 'physical-v1',
        centerline: {
          id: 'island-axis',
          kind: 'line',
          from: { x: 13, z: 14 },
          to: { x: 15, z: 14 },
        },
      },
    ];
  return normalizeDocument(d);
}

export function squareNetwork(columns = 2, rows = 2, cycles = 1): Document {
  const d = emptyDocument('fixture-network'),
    definition = controlCatalog()[0]!;
  d.definitions = [definition];
  d.instances = [];
  d.openings = [];
  d.connections = [];
  const op = (
    id: string,
    instanceId: string,
    edge: number,
    role: Opening['role'] = 'ordinary',
  ): Opening => ({
    id,
    instanceId,
    regionId: `region-edge-${edge}`,
    boundarySegmentId: `edge-${edge}`,
    uCenter: 0.5,
    widthM: 1.4,
    role,
  });
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++)
      d.instances.push(
        instantiate(definition, `${row}-${col}`, { x: 10 + col * 4, z: 10 + row * 4 }),
      );
  const links: [string, number, string, number][] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col + 1 < columns; col++)
      links.push([`${row}-${col}`, 1, `${row}-${col + 1}`, 3]);
  for (let row = 0; row + 1 < rows; row++)
    for (let col = 0; col < columns; col++)
      links.push([`${row}-${col}`, 2, `${row + 1}-${col}`, 0]);
  links.slice(0, columns * rows - 1 + cycles).forEach(([a, ae, b, be], i) => {
    const id = `link-${i}`;
    d.openings.push(op(`${id}-a`, a, ae), op(`${id}-b`, b, be));
    d.connections.push({ id, openingA: `${id}-a`, openingB: `${id}-b` });
  });
  d.openings.push(
    op('entrance', '0-0', 0, 'entrance'),
    op('exit', `${rows - 1}-${columns - 1}`, 2, 'exit'),
  );
  return normalizeDocument(d);
}

export function concaveRoom(): Document {
  const document = emptyDocument('F-03-concave');
  const points = [
    { x: 0, z: 0 },
    { x: 8, z: 0 },
    { x: 8, z: 2 },
    { x: 2, z: 2 },
    { x: 2, z: 8 },
    { x: 0, z: 8 },
  ];
  const definition = createDefinition({
    id: 'concave-L',
    version: 1,
    builder: { kind: 'explicitLoops' },
    parameters: [],
    boundaryLoops: [
      {
        id: 'outer',
        role: 'outer',
        segments: points.map((from, i) => ({
          id: `edge-${i}`,
          kind: 'line',
          from,
          to: points[(i + 1) % points.length]!,
        })),
      },
    ],
    openingRegions: [1, 5].map((edge) => ({
      id: `region-edge-${edge}`,
      segmentId: `edge-${edge}`,
      uMin: 0,
      uMax: 1,
      wrap: false,
      minWidthM: 1,
      maxWidthM: 3,
      connectionClass: 'passage',
    })),
    constructionProfile: {
      profileRef: 'physical-v1',
      maxSpanM: 3,
      supportPattern: 'corners-and-openings',
    },
  });
  document.definitions = [definition];
  document.instances = [instantiate(definition, 'concave', { x: 10, z: 10 })];
  document.openings = [5, 1].map((edge, i) => ({
    id: i ? 'exit' : 'entrance',
    instanceId: 'concave',
    regionId: `region-edge-${edge}`,
    boundarySegmentId: `edge-${edge}`,
    uCenter: 0.5,
    widthM: 1.4,
    role: i ? 'exit' : 'entrance',
  }));
  return normalizeDocument(document);
}
export function touchingCorner(): Document {
  const document = twoRooms();
  document.instances.find((i) => i.id === 'b')!.position = { x: 12, z: 12 };
  document.openings = document.openings.filter((o) => o.role !== 'ordinary');
  document.connections = [];
  return normalizeDocument(document);
}
