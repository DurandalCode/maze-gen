import {normalizeYaw,DIRECTION_MARKER_LIMIT,type DirectionMarker} from './direction-markers';
import {spatialDistance} from '../core/two-storey';
import type { Point } from '../core/maze';

export interface Sample extends Point { time: number }
export class Recorder {
  readonly samples: Sample[];
  readonly markers:DirectionMarker[]=[];
  distance = 0;
  elapsed = 0;
  private last: Point;
  constructor(start: Point) {
    this.last = { ...start };
    this.samples = [{ ...start, time: 0 }];
  }
  markDirection(point:Point,yaw:number,time=this.elapsed):DirectionMarker|undefined{
    if(this.markers.length>=DIRECTION_MARKER_LIMIT||![point.x,point.z,yaw,time].every(Number.isFinite)||time<0||time<(this.markers.at(-1)?.time??0))return;
    const marker:DirectionMarker={version:1,kind:'perceived-exit',x:point.x,z:point.z,floor:point.floor??0,...(point.y===undefined?{}:{y:point.y}),...(point.stair===undefined?{}:{stair:point.stair}),...(point.bridge===undefined?{}:{bridge:point.bridge}),time,yaw:normalizeYaw(yaw)};
    this.markers.push(marker);return marker;
  }
  record(point: Point, elapsed: number, force = false): void {
    this.distance += spatialDistance(point,this.last);
    this.last = { ...point }; this.elapsed = elapsed;
    const prev = this.samples[this.samples.length-1]!;
    if (force || (spatialDistance(point,prev) >= 0.08 || point.floor!==prev.floor || point.stair!==prev.stair || point.bridge!==prev.bridge))
      this.samples.push({ ...point, time: elapsed });
  }
}
