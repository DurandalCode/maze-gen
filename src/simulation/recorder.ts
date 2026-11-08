import type { Point } from '../core/maze';

export interface Sample extends Point { time: number }
export class Recorder {
  readonly samples: Sample[];
  distance = 0;
  elapsed = 0;
  private last: Point;
  constructor(start: Point) {
    this.last = { ...start };
    this.samples = [{ ...start, time: 0 }];
  }
  record(point: Point, elapsed: number, force = false): void {
    this.distance += Math.hypot(point.x-this.last.x, point.z-this.last.z);
    this.last = { ...point }; this.elapsed = elapsed;
    const prev = this.samples[this.samples.length-1]!;
    if (force || Math.hypot(point.x-prev.x, point.z-prev.z) >= 0.08)
      this.samples.push({ ...point, time: elapsed });
  }
}
