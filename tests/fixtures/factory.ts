import { controlCatalog, instantiate } from '../../src/catalog/catalog';
import { emptyDocument, normalizeDocument } from '../../src/domain';
import type { Document, Opening } from '../../src/domain';
import {
  circleRoom,
  concaveRoom,
  obstacleRoom,
  squareNetwork,
  touchingCorner,
  twoRooms,
} from '../helpers/maps';
function opening(
  id: string,
  instanceId: string,
  edge: number,
  role: Opening['role'] = 'ordinary',
  uCenter = 0.5,
): Opening {
  return {
    id,
    instanceId,
    regionId: `region-edge-${edge}`,
    boundarySegmentId: `edge-${edge}`,
    uCenter,
    widthM: 1.4,
    role,
  };
}
export function mixedFixture(): Document {
  const d = emptyDocument('F-02'),
    catalog = controlCatalog();
  d.definitions = catalog;
  d.instances = [
    instantiate(catalog[1]!, 'rectangle', { x: 10, z: 10 }),
    instantiate(catalog[3]!, 'circle', { x: 13.87349939951952, z: 10 }),
    instantiate(catalog[2]!, 'triangle', { x: 17.90169979903904, z: 10 }, -Math.PI / 2),
  ];
  d.openings = [
    opening('entrance', 'rectangle', 3, 'entrance'),
    opening('rect-circle-a', 'rectangle', 1),
    opening('rect-circle-b', 'circle', 0, 'ordinary', 0.5),
    opening('circle-triangle-a', 'circle', 0, 'ordinary', 0),
    opening('circle-triangle-b', 'triangle', 0),
    opening('exit', 'triangle', 1, 'exit'),
  ];
  d.connections = [
    { id: 'rectangle-to-circle', openingA: 'rect-circle-a', openingB: 'rect-circle-b' },
    { id: 'circle-to-triangle', openingA: 'circle-triangle-a', openingB: 'circle-triangle-b' },
  ];
  return normalizeDocument(d);
}
export function m50(): Document {
  const d = emptyDocument('M-50'),
    catalog = controlCatalog();
  d.definitions = catalog;
  const chain: {
    id: string;
    incoming: number;
    outgoing: number;
    incomingU: number;
    outgoingU: number;
  }[] = [];
  const push = (id: string, definition: number, x: number, z: number, rotation = 0) => {
    d.instances.push(instantiate(catalog[definition]!, id, { x, z }, rotation));
  };
  for (let row = 0; row < 12; row++)
    for (let i = 0; i < 20; i++) {
      const col = row % 2 ? 19 - i : i,
        id = `square-${row}-${col}`;
      push(id, 0, 2 + col * 2.4, 2 + row * 2);
      chain.push({
        id,
        incoming: i === 0 ? 0 : row % 2 ? 1 : 3,
        outgoing: i === 19 ? 2 : row % 2 ? 3 : 1,
        incomingU: 0.5,
        outgoingU: 0.5,
      });
    }
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 20; i++) {
      const col = row % 2 ? 19 - i : i,
        id = `rectangle-${row}-${col}`;
      push(id, 1, 2 + col * 2.4, 28 + row * 6);
      chain.push({
        id,
        incoming: i === 0 ? 0 : row % 2 ? 1 : 3,
        outgoing: i === 19 ? 2 : row % 2 ? 3 : 1,
        incomingU: 0.5,
        outgoingU: 0.5,
      });
    }
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 10; i++) {
      const col = row % 2 ? 9 - i : i,
        id = `circle-${row}-${col}`;
      push(id, 3, 2 + col * 4.8, 39.2 + row * 4.05);
      chain.push({
        id,
        incoming: 0,
        outgoing: 0,
        incomingU: i === 0 ? 0.75 : row % 2 ? 0 : 0.5,
        outgoingU: i === 9 ? 0.25 : row % 2 ? 0.5 : 0,
      });
    }
  for (let i = 0; i < 20; i++) {
    const down = i % 2 === 1,
      id = `triangle-${i}`;
    push(id, 2, 2 + i * 2, 45.5 + (down ? 2.309401 : 1.154701), down ? Math.PI : 0);
    chain.push({
      id,
      incoming: i === 0 ? 0 : down ? 1 : 2,
      outgoing: i === 19 ? 0 : down ? 2 : 1,
      incomingU: 0.5,
      outgoingU: 0.5,
    });
  }
  d.openings.push(opening('entrance', chain[0]!.id, 0, 'entrance'));
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i]!,
      b = chain[i + 1]!,
      id = `link-${String(i).padStart(3, '0')}`;
    d.openings.push(
      opening(`${id}-a`, a.id, a.outgoing, 'ordinary', a.outgoingU),
      opening(`${id}-b`, b.id, b.incoming, 'ordinary', b.incomingU),
    );
    d.connections.push({ id, openingA: `${id}-a`, openingB: `${id}-b` });
  }
  d.openings.push(opening('exit', chain[chain.length - 1]!.id, 0, 'exit'));
  // Keep the complete construction envelope inside the site, including timber at x=0.
  d.instances.forEach((instance) => (instance.position.x += 0.1));
  return normalizeDocument(d);
}
export function m100(): Document {
  const base = m50(),
    d = emptyDocument('M-100');
  d.site.boundaryLoops[0]!.segments.forEach((s) => {
    if (s.kind === 'line') {
      s.from = { x: s.from.x * 2, z: s.from.z * 2 };
      s.to = { x: s.to.x * 2, z: s.to.z * 2 };
    }
  });
  d.definitions = base.definitions;
  for (const [prefix, x, z] of [
    ['a', 0, 0],
    ['b', 50, 0],
    ['c', 0, 50],
    ['d', 50, 50],
  ] as const) {
    d.instances.push(
      ...base.instances.map((i) => ({
        ...i,
        id: `${prefix}/${i.id}`,
        position: { x: i.position.x + x, z: i.position.z + z },
      })),
    );
    d.openings.push(
      ...base.openings
        .filter(
          (o) =>
            o.role === 'ordinary' ||
            (prefix === 'a' && o.role === 'entrance') ||
            ((prefix === 'b' || prefix === 'c') && o.role === 'exit'),
        )
        .map((o) => ({
          ...o,
          id: `${prefix}/${o.id}`,
          instanceId: `${prefix}/${o.instanceId}`,
          role: prefix === 'b' && o.role === 'exit' ? ('ordinary' as const) : o.role,
        })),
    );
    d.connections.push(
      ...base.connections.map((c) => ({
        ...c,
        id: `${prefix}/${c.id}`,
        openingA: `${prefix}/${c.openingA}`,
        openingB: `${prefix}/${c.openingB}`,
      })),
    );
  }
  const link = (id: string, a: string, ae: number, b: string, be: number) => {
    d.openings.push(opening(`${id}-a`, a, ae), opening(`${id}-b`, b, be));
    d.connections.push({ id, openingA: `${id}-a`, openingB: `${id}-b` });
  };
  link('seam-a-b', 'a/square-0-19', 1, 'b/square-0-0', 3);
  link('seam-c-d', 'c/square-0-19', 1, 'd/square-0-0', 3);
  d.openings.push(opening('seam-b-d-end', 'd/square-0-16', 0));
  d.connections.push({ id: 'seam-b-d', openingA: 'b/exit', openingB: 'seam-b-d-end' });
  return normalizeDocument(d);
}
export function fixtures(): Record<string, Document> {
  return {
    'F-01': twoRooms(2, Math.PI / 7),
    'F-02': mixedFixture(),
    'F-03-hole': obstacleRoom(true),
    'F-03-concave': concaveRoom(),
    'F-03-corner-touch': touchingCorner(),
    'F-03-island': obstacleRoom(false),
    'F-04-circle-wrap': circleRoom(),
    'F-04-width-099': twoRooms(2, 0, 1.11),
    'F-04-width-100': twoRooms(2, 0, 1.12),
    'F-04-width-101': twoRooms(2, 0, 1.13),
    'F-05-tree': squareNetwork(3, 2, 0),
    'F-05-ring': squareNetwork(2, 2, 1),
    'F-05-two-cycles': squareNetwork(3, 2, 2),
    'M-50': m50(),
    'M-100': m100(),
  };
}

export function visualFixture(): Document {
  const d = emptyDocument('VIS-MIX-01'),
    catalog = controlCatalog();
  d.definitions = catalog;
  const points = [
    { x: -12, z: -12 },
    { x: 12, z: -12 },
    { x: 12, z: 12 },
    { x: -12, z: 12 },
  ];
  d.site.boundaryLoops = [
    {
      id: 'site',
      role: 'outer',
      segments: points.map((from, i) => ({
        id: `site-${i}`,
        kind: 'line',
        from,
        to: points[(i + 1) % 4]!,
      })),
    },
  ];
  d.instances = [
    instantiate(catalog[0]!, 'square', { x: 0, z: 0 }),
    instantiate(catalog[1]!, 'hall', { x: 0, z: 5 }),
    instantiate(catalog[3]!, 'circle', { x: 5, z: 0 }),
    instantiate(catalog[2]!, 'triangle', { x: -5, z: 0 }, 0.523598776),
  ];
  d.openings = [
    opening('entrance', 'square', 3, 'entrance'),
    opening('a', 'square', 2),
    opening('b', 'hall', 0),
    opening('exit', 'hall', 1, 'exit'),
  ];
  d.connections = [{ id: 'square-hall', openingA: 'a', openingB: 'b' }];
  return normalizeDocument(d);
}
