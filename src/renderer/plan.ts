import type { Point } from '../domain';
import type { PhysicalSnapshot } from '../geometry/compile/types';
import type { Polygon } from '../geometry/kernel/contour';
export class PlanRenderer {
  private observer: ResizeObserver;
  private physical: PhysicalSnapshot | null = null;
  private disposed = false;
  private scale = 1;
  private offset = { x: 0, z: 0 };
  private center = { x: 0, z: 0 };
  private zoom = 1;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(canvas);
  }
  setWorld(physical: PhysicalSnapshot): void {
    this.physical = physical;
    this.render();
  }
  setView(center: Point, zoom: number): void {
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    this.center = { ...center };
    this.zoom = zoom;
    this.render();
  }
  worldPoint(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.offset.x) / this.scale,
      z: (clientY - rect.top - this.offset.z) / this.scale,
    };
  }
  render(): void {
    if (this.disposed || !this.physical) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f3f4ec';
    ctx.fillRect(0, 0, width, height);
    const b = this.physical.bounds;
    this.scale =
      Math.max(
        0.01,
        Math.min((width - 40) / (b.maxX - b.minX), (height - 40) / (b.maxZ - b.minZ)),
      ) * this.zoom;
    this.offset = {
      x: width / 2 - ((b.minX + b.maxX) / 2 + this.center.x) * this.scale,
      z: height / 2 - ((b.minZ + b.maxZ) / 2 + this.center.z) * this.scale,
    };
    ctx.translate(this.offset.x, this.offset.z);
    ctx.scale(this.scale, this.scale);
    const path = (polygon: Polygon): Path2D => {
      const p = new Path2D();
      for (const ring of polygon) {
        if (!ring.length) continue;
        p.moveTo(ring[0]!.x, ring[0]!.z);
        for (let i = 1; i < ring.length; i++) p.lineTo(ring[i]!.x, ring[i]!.z);
        p.closePath();
      }
      return p;
    };
    ctx.fillStyle = '#dce6d3';
    for (const polygon of this.physical.floor) ctx.fill(path(polygon), 'evenodd');
    for (const solid of this.physical.solids) {
      if (solid.kind !== 'panel' && solid.kind !== 'post-board' && solid.kind !== 'lower-rail')
        continue;
      ctx.fillStyle = solid.kind === 'panel' ? '#263b32' : '#ab8659';
      ctx.fill(path(solid.footprint), 'evenodd');
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6 / this.scale;
      ctx.stroke(path(solid.footprint));
    }
    for (const opening of this.physical.openPassages) {
      if (opening.role === 'ordinary') continue;
      ctx.strokeStyle = opening.role === 'entrance' ? '#297a53' : '#b34830';
      ctx.lineWidth = 3 / this.scale;
      ctx.beginPath();
      ctx.moveTo(opening.start.x, opening.start.z);
      ctx.lineTo(opening.end.x, opening.end.z);
      ctx.stroke();
    }
  }
  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.physical = null;
    const ctx = this.canvas.getContext('2d');
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
