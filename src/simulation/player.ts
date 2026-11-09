import { domainOf } from '../core/domain';
import { cellSize, portalPoint, type Maze, type Point } from '../core/maze';
import { CollisionWorld } from './collisions';
import { Recorder } from './recorder';

export class Player {
  position: Point;
  yaw: number;
  pitch = 0;
  readonly recorder: Recorder;
  finished = false;
  constructor(private maze: Maze, private world: CollisionWorld) {
    this.position = portalPoint(maze, maze.entrance);
    this.yaw = { west: -Math.PI/2, east: Math.PI/2, north: Math.PI, south: 0 }[maze.entrance.side];
    this.recorder = new Recorder(this.position);
  }

  update(dt: number, keys: ReadonlySet<string>): void {
    if (this.finished || dt <= 0) return;
    let forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    let right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const norm = Math.hypot(forward, right);
    if (norm) { forward /= norm; right /= norm; }
    const distance = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.8 : 1.4) * dt;
    const delta = {
      x: (-Math.sin(this.yaw)*forward + Math.cos(this.yaw)*right)*distance,
      z: (-Math.cos(this.yaw)*forward - Math.sin(this.yaw)*right)*distance,
    };
    const previousTime = this.recorder.elapsed;
    let step = 0;
    const totalSteps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / 0.0625));
    let previous = {...this.position};
    this.position = this.world.move(this.position, delta, 0.25, point => {
      step++;
      // Keep visitors on the site: leaving via the entrance cannot bypass the maze.
      const clipped = domainOf(this.maze).constrain(previous, point);
      point.x=clipped.x; point.z=clipped.z; previous={...point};
      if (!this.finished) {
        this.recorder.record(point, previousTime + dt * step / totalSteps);
        this.position = point;
        if (this.atExit(point)) { this.finished = true; this.recorder.record(point, this.recorder.elapsed, true); }
      }
    });

    if (this.finished) {
      const end = this.recorder.samples[this.recorder.samples.length-1]!;
      this.position = { x: end.x, z: end.z };
    }
  }

  private atExit(point: Point): boolean {
    const exit = portalPoint(this.maze, this.maze.exit);
    const side = this.maze.exit.side;
    const size = cellSize(this.maze, this.maze.exit.cell);
    const half = (side === 'east' || side === 'west' ? size.depth : size.width)/2 - 0.25;
    return side === 'east' || side === 'west'
      ? Math.abs(point.x-exit.x) < 1e-6 && Math.abs(point.z-exit.z) <= half
      : Math.abs(point.z-exit.z) < 1e-6 && Math.abs(point.x-exit.x) <= half;
  }
}
