import { expect, test } from 'bun:test';
import { InstancedMesh, Mesh } from 'three';
import { DEFAULT_CONSTRUCTION, validateConstruction, walls } from '../src/core/maze';
import { CollisionWorld } from '../src/simulation/collisions';
import { generate } from '../src/generators/generate';
import { deserialize, serialize } from '../src/persistence/maze-json';
import { mazeMesh } from '../src/renderer/maze-mesh';

const maze = () => generate({ columns: 3, rows: 2, corridorWidth: 1.5, extraConnections: 0, seed: 'construction', algorithm: 'prim' });

test('defaults are translucent black fabric, 2.5m high, without a roof', () => {
  expect(maze()).toMatchObject(DEFAULT_CONSTRUCTION);
  expect(maze().translucentFabric).toBe(true);
});

test('custom construction survives JSON without changing topology', () => {
  const original = maze();
  const custom = { ...original, wallHeight: 3.4, wallColor: '#ab12ef', translucentFabric: true, roof: true };
  const restored = deserialize(serialize(custom));
  expect(restored).toEqual(custom);
  expect(restored.passages).toEqual(original.passages);
});

test('legacy v1 JSON loads using the default color and open sky', () => {
  const legacy = JSON.parse(serialize(maze()));
  delete legacy.wallColor; delete legacy.translucentFabric; delete legacy.roof;
  expect(deserialize(JSON.stringify(legacy))).toMatchObject({...DEFAULT_CONSTRUCTION,translucentFabric:false});
});

test('rejects invalid height, color and roof values in saved files', () => {
  for (const wallHeight of [1.7, 10.1, null, '2.2'])
    expect(() => deserialize(JSON.stringify({ ...maze(), wallHeight }))).toThrow();
  for (const wallColor of [null, '#fff', 'red', 0, '#gg0000'])
    expect(() => deserialize(JSON.stringify({ ...maze(), wallColor }))).toThrow();
  for (const roof of [null, 'false', 1])
    expect(() => deserialize(JSON.stringify({ ...maze(), roof }))).toThrow();
  for (const wallOpacity of [null, -0.1, 1.1, '0.5'])
    expect(() => deserialize(JSON.stringify({ ...maze(), wallOpacity }))).toThrow();
  for (const translucentFabric of [null, 'true', 1])
    expect(() => deserialize(JSON.stringify({ ...maze(), translucentFabric }))).toThrow();
  expect(() => validateConstruction({ ...DEFAULT_CONSTRUCTION, wallHeight: NaN })).toThrow();
});

test('woven fabric applies to walls and roof, retaining collisions and opaque timber', () => {
  const original = maze(), fabric = { ...original, translucentFabric: true, roof: true };
  const group = mazeMesh(fabric);
  expect(group.children[0]!.visible).toBe(true);
  expect(fabric.passages).toEqual(original.passages);
  const panel = walls(fabric)[0]!;
  expect(new CollisionWorld(walls(fabric)).blocked({ x: (panel.x1+panel.x2)/2, z: (panel.z1+panel.z2)/2 })).toBe(true);
  const roof = group.getObjectByName('roof') as Mesh;
  expect((roof.material as { transparent: boolean }).transparent).toBe(true);
  expect(roof.material).not.toBe((group.children[0] as Mesh).material);
  const timber = group.getObjectByName('timber-boards') as Mesh;
  expect((timber.material as { opacity: number }).opacity).toBe(1);
});

test('old opacity files migrate to the fabric checkbox', () => {
  const saved = JSON.parse(serialize(maze()));
  delete saved.translucentFabric;
  saved.wallOpacity = 0.4;
  expect(deserialize(JSON.stringify(saved)).translucentFabric).toBe(true);
  saved.wallOpacity = 1;
  expect(deserialize(JSON.stringify(saved)).translucentFabric).toBe(false);
});

test('roof covers the whole site at wall height and can be removed', () => {
  const custom = { ...maze(), wallHeight: 3.4, wallColor: '#3478ab', translucentFabric:false, roof: true };
  const group = mazeMesh(custom);
  const roof = group.getObjectByName('roof');
  expect(roof).toBeInstanceOf(Mesh);
  if (!(roof instanceof Mesh)) throw new Error('Missing roof');
  expect((roof.material as { transparent: boolean }).transparent).toBe(false);
  roof.geometry.computeBoundingBox();
  const box = roof.geometry.boundingBox!.clone().translate(roof.position);
  expect(box.min.y).toBeCloseTo(3.4);
  expect(box.min.x).toBeLessThanOrEqual(0);
  expect(box.max.x).toBeGreaterThanOrEqual(custom.width);
  expect(box.min.z).toBeLessThanOrEqual(0);
  expect(box.max.z).toBeGreaterThanOrEqual(custom.depth);
  const wallMesh = group.children[0];
  expect(wallMesh).toBeInstanceOf(InstancedMesh);
  if (!(wallMesh instanceof InstancedMesh) || Array.isArray(wallMesh.material) || !('color' in wallMesh.material)) throw new Error('Missing wall material');
  expect((wallMesh.material.color as { getHexString(): string }).getHexString()).toBe('3478ab');
  expect(mazeMesh({ ...custom, roof: false }).getObjectByName('roof')).toBeUndefined();
});
