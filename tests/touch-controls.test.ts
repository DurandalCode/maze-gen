import { expect, test } from 'bun:test';
import { cellCenter, emptyMaze, walls } from '../src/core/maze';
import { generate } from '../src/generators/generate';
import { CollisionWorld } from '../src/simulation/collisions';
import { Player } from '../src/simulation/player';
import { applyTouchLook, applyTouchMovement, stickVector } from '../src/ui/touch-input';

function openPlayer() {
  const maze = emptyMaze({ columns: 10, rows: 10, corridorWidth: 10, extraConnections: 0, seed: 'touch-test', algorithm: 'backtracker' });
  const player = new Player(maze, new CollisionWorld([]));
  player.position = cellCenter(maze, 44); player.yaw = 0;
  // Recorder must start at the fixture's actual location.
  player.recorder.record(player.position, 0); player.recorder.distance = 0;
  return player;
}

test('radial deadzone rejects thumb drift and preserves proportional movement', () => {
  expect(stickVector({ x: .05, y: .05 })).toEqual({ x: 0, y: 0 });
  expect(stickVector({ x: 0, y: .56 }).y).toBeCloseTo(.5);
  const diagonal = stickVector({ x: 1, y: 1 });
  expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
  expect(stickVector({ x: NaN, y: 0 })).toEqual({ x: 0, y: 0 });
});

test('analog speed is proportional, frame independent, and diagonal bounded', () => {
  for (const fps of [30, 60, 144]) {
    for (const [forward, right, expected] of [[1, 0, 1.4], [.5, 0, .7], [1, 1, 1.4], [0, -1, 1.4]]) {
      const player = openPlayer(), start = { ...player.position };
      for (let i = 0; i < fps; i++) player.updateAnalog(1 / fps, forward!, right!);
      expect(Math.hypot(player.position.x - start.x, player.position.z - start.z)).toBeCloseTo(expected!, 7);
      expect(player.recorder.elapsed).toBeCloseTo(1);
    }
  }
});

test('right stick look and left stick movement run together; look rate uses dt', () => {
  const result = (fps: number) => {
    const p = openPlayer();
    for (let i = 0; i < fps; i++) { applyTouchLook(p, { x: .4, y: .25 }, 1 / fps); p.updateAnalog(1 / fps, 1, 0); }
    return p;
  };
  const a = result(30), b = result(120);
  expect(a.yaw).toBeCloseTo(-.88); expect(a.pitch).toBeCloseTo(.425);
  expect(a.yaw).toBeCloseTo(b.yaw); expect(a.pitch).toBeCloseTo(b.pitch);
  expect(a.recorder.distance).toBeCloseTo(1.4); expect(b.recorder.distance).toBeCloseTo(1.4);
  applyTouchLook(a, { x: 1, y: 1 }, 5); expect(a.yaw).toBeCloseTo(-.88);
  for (let i = 0; i < 100; i++) applyTouchLook(a, { x: 0, y: 1 }, .1);
  expect(a.pitch).toBe(1.35);
});

test('neutral input advances active timer without adding route samples; pause makes no updates', () => {
  const maze = generate({ columns: 1, rows: 1, corridorWidth: 2, extraConnections: 0, seed: 'touch', algorithm: 'backtracker' });
  const player = new Player(maze, new CollisionWorld(walls(maze)));
  for (let i = 0; i < 60; i++) player.updateAnalog(1 / 60, 0, 0);
  expect(player.recorder.elapsed).toBeCloseTo(1);
  expect(player.recorder.distance).toBe(0); expect(player.recorder.samples).toHaveLength(1);
  const elapsed = player.recorder.elapsed;
  player.updateAnalog(0, 1, 0); expect(player.recorder.elapsed).toBe(elapsed);
  for (let i = 0; i < 200 && !player.finished; i++) player.updateAnalog(1 / 60, 1, 0);
  expect(player.finished).toBe(true); expect(player.recorder.distance).toBeCloseTo(2);
  const end = { ...player.position }, endTime = player.recorder.elapsed;
  player.updateAnalog(1, -1, 1); expect(player.position).toEqual(end); expect(player.recorder.elapsed).toBe(endTime);
});

test('analog movement respects walls and cannot escape through entrance', () => {
  const maze = generate({ columns: 1, rows: 1, corridorWidth: 2, extraConnections: 0, seed: 'touch', algorithm: 'backtracker' });
  const p = new Player(maze, new CollisionWorld(walls(maze)));
  p.updateAnalog(5, -1, 0); expect(p.recorder.distance).toBe(0);
  p.updateAnalog(.4, 1, 0); p.updateAnalog(5, 0, 1);
  expect(new CollisionWorld(walls(maze)).blocked(p.position)).toBe(false);
  expect(p.finished).toBe(false);
});

test('left thumbstick continuously scales from slow movement through walking to full running',()=>{
 for(const fps of [30,60,144]){
  for(const [magnitude,expected] of [[0,0],[.25,.7],[.5,1.4],[.75,2.1],[1,2.8]]){
   const p=openPlayer(),start={...p.position};
   for(let i=0;i<fps;i++)applyTouchMovement(p,{x:0,y:magnitude!},1/fps);
   expect(Math.hypot(p.position.x-start.x,p.position.z-start.z)).toBeCloseTo(expected!,7);
   expect(p.recorder.distance).toBeCloseTo(expected!,7);
  }
  const diagonal=openPlayer(),start={...diagonal.position};
  for(let i=0;i<fps;i++)applyTouchMovement(diagonal,stickVector({x:1,y:1}),1/fps);
  expect(Math.hypot(diagonal.position.x-start.x,diagonal.position.z-start.z)).toBeCloseTo(2.8,7);
 }
});
