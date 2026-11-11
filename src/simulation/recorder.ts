import {spatialDistance} from '../core/two-storey';
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
    this.distance += spatialDistance(point,this.last);
    this.last = { ...point }; this.elapsed = elapsed;
    const prev = this.samples[this.samples.length-1]!;
    if (force || (spatialDistance(point,prev) >= 0.08 || point.floor!==prev.floor || point.stair!==prev.stair || point.bridge!==prev.bridge))
      this.samples.push({ ...point, time: elapsed });
  }
}
