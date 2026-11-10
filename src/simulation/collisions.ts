import {wallDistance} from '../free/geometry';
import { WALL_THICKNESS, type Point, type Wall } from '../core/maze';

/** Spatial hash keeps collision queries local even for a 100 × 100 grid. */
export class CollisionWorld {
  private buckets = new Map<string, Wall[]>();
  constructor(segments: readonly Wall[], private bucketSize = 2) {
    for (const wall of segments) {
      for (let x = Math.floor((Math.min(wall.x1, wall.x2) - 0.1) / bucketSize); x <= Math.floor((Math.max(wall.x1, wall.x2) + 0.1) / bucketSize); x++)
        for (let z = Math.floor((Math.min(wall.z1, wall.z2) - 0.1) / bucketSize); z <= Math.floor((Math.max(wall.z1, wall.z2) + 0.1) / bucketSize); z++) {
          const key = `${x},${z}`;
          const list = this.buckets.get(key) ?? []; list.push(wall); this.buckets.set(key, list);
        }
    }
  }

  blocked(p: Point, radius = 0.25): boolean {
    for (let x = Math.floor((p.x-radius) / this.bucketSize); x <= Math.floor((p.x+radius) / this.bucketSize); x++)
      for (let z = Math.floor((p.z-radius) / this.bucketSize); z <= Math.floor((p.z+radius) / this.bucketSize); z++)
        for (const w of this.buckets.get(`${x},${z}`) ?? []) {
          if(w.y!==undefined&&((p.y??0)+1.7<=w.y+.001||(p.y??0)+.05>=w.y+(w.height??2.5)-.001))continue;
          if(w.x1!==w.x2&&w.z1!==w.z2){if(wallDistance(p,w)<radius-1e-10)return true;continue;}
          const half = (w.thickness ?? WALL_THICKNESS) / 2;
          const closestX = Math.max(Math.min(w.x1, w.x2)-half, Math.min(p.x, Math.max(w.x1, w.x2)+half));
          const closestZ = Math.max(Math.min(w.z1, w.z2)-half, Math.min(p.z, Math.max(w.z1, w.z2)+half));
          if ((p.x-closestX)**2 + (p.z-closestZ)**2 < radius**2 - 1e-10) return true;
        }
    return false;
  }

  move(start: Point, delta: Point, radius = 0.25, onStep?: (point: Point) => void): Point {
    const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / (radius * 0.25)));
    const result = { ...start }, dx = delta.x / steps, dz = delta.z / steps;
    for (let i = 0; i < steps; i++) {
      const x = { x: result.x+dx, z: result.z };
      if (!this.blocked(x, radius)) result.x = x.x;
      const z = { x: result.x, z: result.z+dz };
      if (!this.blocked(z, radius)) result.z = z.z;
      onStep?.(result);
    }
    return result;
  }
}
