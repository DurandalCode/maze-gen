import type { Point } from '../../domain';
import { move } from '../../navigation/collision';
import type { CollisionWorld } from '../../navigation/collision';

export interface MovementInput {
  forward: number;
  strafe: number;
  yaw: number;
  running: boolean;
}
export class MovementController {
  private accumulator = 0;
  paused = true;
  distanceM = 0;
  activeTimeMs = 0;
  contacting = false;
  constructor(
    readonly world: CollisionWorld,
    public position: Point,
    readonly radius = 0.25,
  ) {}
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.accumulator = 0;
  }
  frame(
    deltaSeconds: number,
    input: MovementInput,
    onStep?: (position: Point, distanceM: number) => void,
  ): number {
    if (this.paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
    this.accumulator += Math.min(deltaSeconds, 5 / 60);
    let steps = 0;
    while (!this.paused && this.accumulator + 1e-12 >= 1 / 60 && steps < 5) {
      const scale = Math.max(1, Math.hypot(input.forward, input.strafe)),
        speed = input.running ? 2.8 : 1.4;
      const forward = input.forward / scale,
        strafe = input.strafe / scale;
      const displacement = {
        x: ((Math.sin(input.yaw) * forward + Math.cos(input.yaw) * strafe) * speed) / 60,
        z: ((-Math.cos(input.yaw) * forward + Math.sin(input.yaw) * strafe) * speed) / 60,
      };
      let distance = 0;
      const next = move(this.world, this.position, displacement, this.radius, (a, b) => {
        distance += Math.hypot(b.x - a.x, b.z - a.z);
      });
      if (Math.hypot(displacement.x, displacement.z) > 1e-10)
        this.contacting =
          Math.hypot(
            next.x - this.position.x - displacement.x,
            next.z - this.position.z - displacement.z,
          ) > 1e-7;
      this.position = next;
      this.distanceM += distance;
      this.activeTimeMs += 1000 / 60;
      onStep?.({ ...next }, distance);
      this.accumulator -= 1 / 60;
      steps++;
    }
    return steps;
  }
}
