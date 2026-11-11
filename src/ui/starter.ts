import { controlCatalog, instantiate } from '../catalog/catalog';
import { emptyDocument, normalizeDocument } from '../domain';
import type { Document, Opening } from '../domain';
/** Explicit starter template, independent of the bounded procedural generator. */
export function starterDocument(): Document {
  const d = emptyDocument(crypto.randomUUID(), 'Две комнаты');
  const shape = controlCatalog()[0]!;
  d.definitions = [shape];
  d.instances = [
    instantiate(shape, 'a', { x: 10, z: 10 }),
    instantiate(shape, 'b', { x: 10, z: 14 }),
  ];
  const opening = (
    id: string,
    instanceId: string,
    edge: number,
    role: Opening['role'],
  ): Opening => ({
    id,
    instanceId,
    regionId: `region-edge-${edge}`,
    boundarySegmentId: `edge-${edge}`,
    uCenter: 0.5,
    widthM: 1.4,
    role,
  });
  d.openings = [
    opening('entrance', 'a', 3, 'entrance'),
    opening('a-b', 'a', 2, 'ordinary'),
    opening('b-a', 'b', 0, 'ordinary'),
    opening('exit', 'b', 1, 'exit'),
  ];
  d.connections = [{ id: 'link', openingA: 'a-b', openingB: 'b-a' }];
  const now = new Date().toISOString();
  d.metadata = { ...d.metadata, createdAt: now, updatedAt: now };
  return normalizeDocument(d);
}
