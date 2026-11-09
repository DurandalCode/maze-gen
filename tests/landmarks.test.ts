import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { SUN_DIRECTION, DEFAULT_ENVIRONMENT, environmentOf, forestAtPoint, forestMapPoints, sunDirection, type Environment } from '../src/core/environment';
import { moscowAugustSun, solarMinuteForAzimuth, solarPosition } from '../src/core/solar';
import { deserialize, serialize } from '../src/persistence/maze-json';
import { generate } from '../src/generators/generate';
import { forestMesh, WorldLandmarks } from '../src/renderer/landmarks';
import { disposeMeshes } from '../src/renderer/dispose';

const maze = (seed = 'landmarks') => generate({ columns: 5, rows: 5, moduleSize: 2, corridorWidth: 2, extraConnections: 0, seed, algorithm: 'prim' });

test('the same north forest remains in place when the maze seed changes', () => {
  const a = forestMesh(maze('first')), b = forestMesh(maze('second'));
  const trunksA = a.getObjectByName('forest-trunks') as THREE.InstancedMesh;
  const trunksB = b.getObjectByName('forest-trunks') as THREE.InstancedMesh;
  expect(trunksA.instanceMatrix.array).toEqual(trunksB.instanceMatrix.array);
  const leaves = a.getObjectByName('forest-foliage') as THREE.InstancedMesh;
  leaves.computeBoundingBox(); trunksA.computeBoundingBox();
  expect(leaves.boundingBox!.max.z).toBeLessThan(0);
  expect(trunksA.boundingBox!.max.z).toBeLessThan(0);
  disposeMeshes(a); disposeMeshes(b);
});

test('visible sun keeps the lighting direction after walking and changing the camera view', () => {
  const landmarks = new WorldLandmarks(maze());
  const camera = new THREE.PerspectiveCamera(76, 1, 0.05, 1500);
  const expected = new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
  for (const [x, z, yaw] of [[0, 0, 0], [18, 12, Math.PI], [-5, 6, -Math.PI/2]]) {
    camera.position.set(x!, 1.7, z!); camera.rotation.y = yaw!;
    landmarks.update(camera);
    const sun = landmarks.group.getObjectByName('sun-landmark')!;
    const direction = sun.position.clone().sub(camera.position).normalize();
    expect(direction.distanceTo(expected)).toBeLessThan(1e-8);
    expect(sun.position.distanceTo(camera.position)).toBeLessThan(camera.far);
  }
  disposeMeshes(landmarks.group);
});

test('configured forest rotates and translates on all sides, matching its map strip', () => {
  for (const side of ['north', 'east', 'south', 'west'] as const) {
    const environment: Environment = { ...DEFAULT_ENVIRONMENT, forest: { side, distance: 25, offset: 7 } };
    const configured = { ...maze(), environment }, forest = forestMesh(configured);
    forest.updateMatrixWorld(true);
    const trunks = forest.getObjectByName('forest-trunks') as THREE.InstancedMesh;
    const box = new THREE.Box3().setFromObject(trunks), points = forestMapPoints(configured);
    if (side === 'north') { expect(box.max.z).toBeLessThan(-24); expect(points[0]!.z).toBe(-25); }
    if (side === 'south') { expect(box.min.z).toBeGreaterThan(configured.depth+24); expect(points[0]!.z).toBe(configured.depth+25); }
    if (side === 'east') { expect(box.min.x).toBeGreaterThan(configured.width+24); expect(points[0]!.x).toBe(configured.width+25); }
    if (side === 'west') { expect(box.max.x).toBeLessThan(-24); expect(points[0]!.x).toBe(-25); }
    const handle = points.reduce((sum, p) => ({ x: sum.x+p.x/4, z: sum.z+p.z/4 }), { x: 0, z: 0 });
    const moved = forestAtPoint(configured, handle, environment);
    expect(moved.forest.side).toBe(side);
    expect(moved.forest.distance).toBeCloseTo(25);
    expect(moved.forest.offset).toBeCloseTo(7);
    disposeMeshes(forest);
  }
});

test('time settings drive the visible sun through the same world direction', () => {
  for (const sun of [
    { day: 1, minutes: 8*60 }, { day: 15, minutes: 13*60 }, { day: 31, minutes: 18*60 },
  ]) {
    const environment = { ...DEFAULT_ENVIRONMENT, sun }, configured = { ...maze(), environment };
    const landmarks = new WorldLandmarks(configured), camera = new THREE.PerspectiveCamera(76, 1, 0.05, 1500);
    camera.position.set(10, 1.7, 2); landmarks.update(camera);
    const position = landmarks.group.getObjectByName('sun-landmark')!.position.clone().sub(camera.position).normalize();
    const direction = sunDirection(environment);
    expect(position.distanceTo(new THREE.Vector3(direction.x, direction.y, direction.z))).toBeLessThan(1e-8);
    expect(position.y).toBeCloseTo(Math.sin(solarPosition(sun).elevation*Math.PI/180));
    disposeMeshes(landmarks.group);
  }
});

test('Moscow August time follows the daylight arc and hides the solar disc at night', () => {
  const morning = moscowAugustSun(15, 8*60), noon = moscowAugustSun(15, 12*60+35), evening = moscowAugustSun(15, 18*60);
  expect(morning.azimuth).toBeGreaterThan(80); expect(morning.azimuth).toBeLessThan(130);
  expect(noon.azimuth).toBeGreaterThan(175); expect(noon.azimuth).toBeLessThan(185);
  expect(noon.elevation).toBeGreaterThan(45); expect(noon.elevation).toBeLessThan(50);
  expect(evening.azimuth).toBeGreaterThan(260); expect(evening.elevation).toBeGreaterThan(0);
  expect(noon.elevation).toBeGreaterThan(morning.elevation); expect(noon.elevation).toBeGreaterThan(evening.elevation);
  expect(moscowAugustSun(1, 12*60+35).elevation).toBeGreaterThan(moscowAugustSun(31, 12*60+35).elevation);
  expect(moscowAugustSun(15, 0).elevation).toBeLessThan(0);
  const configured = { ...maze(), environment: { ...DEFAULT_ENVIRONMENT,
    sun: { day: 15, minutes: 0 } } };
  const landmarks = new WorldLandmarks(configured);
  expect(landmarks.group.getObjectByName('sun-landmark')!.visible).toBe(false);
  disposeMeshes(landmarks.group);
});

test('environment settings survive JSON and legacy defaults; malformed settings are rejected', () => {
  const original = maze();
  expect(environmentOf(deserialize(serialize(original)))).toEqual(DEFAULT_ENVIRONMENT);
  const configured = { ...original, environment: { sun: { day: 22, minutes: 990 },
    forest: { side: 'east' as const, distance: 40, offset: -12 } } };
  expect(deserialize(serialize(configured))).toEqual(configured);
  for (const environment of [null, {}, { sun: null, forest: {} },
    { ...configured.environment, sun: { day: 15.5, minutes: 30 } },
    { ...configured.environment, sun: { ...configured.environment.sun, day: 32 } },
    { ...configured.environment, sun: { ...configured.environment.sun, minutes: 1440 } },
    { ...configured.environment, sun: { day: 15, minutes: '780' } },
    { ...configured.environment, forest: { side: 'east', distance: '40', offset: 0 } }])
    expect(() => deserialize(JSON.stringify({ ...original, environment }))).toThrow();
});

test('dragging solar direction chooses daylight time and derives the elevation automatically', () => {
  for (const day of [1, 15, 31]) for (const azimuth of [90, 180, 270]) {
    const minutes = solarMinuteForAzimuth(day, azimuth), position = moscowAugustSun(day, minutes);
    expect(position.elevation).toBeGreaterThanOrEqual(0);
    expect(Math.abs(position.azimuth-azimuth)).toBeLessThan(0.3);
  }
  const north = moscowAugustSun(15, solarMinuteForAzimuth(15, 0));
  expect(north.elevation).toBeGreaterThanOrEqual(0);
  expect(Math.min(north.azimuth, 360-north.azimuth)).toBeGreaterThan(40);
});
