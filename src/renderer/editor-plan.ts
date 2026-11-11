import type { Diagnostic, Document, Point } from '../domain';
import type { Bounds } from '../geometry/predicates';
import { bounds } from '../geometry/predicates';
import { hitPlan, inversePoint, planModel, previewRings, transformPoint } from '../editor/plan';
import type { PlanModel, PlanOpening } from '../editor/plan';
import { CommandStore, snapped } from '../editor/commands';
import type { EditorState, Selection, Transform } from '../editor/commands';
interface Drag {
  instanceId: string;
  start: Point;
  original: Transform;
  rotate: boolean;
  angle: number;
}
export interface EditorPlanOptions {
  snap?: () => boolean;
  error?: (error: unknown) => void;
  pointer?: (kind: 'down' | 'move' | 'up', point: Point, selection: Selection | null) => boolean;
  painted?: (inputTime: number, paintTime: number) => void;
}
const plans = new WeakMap<HTMLCanvasElement, EditorPlan>();
const paintObservers = new Set<(inputTime: number, paintTime: number) => void>();
export function getEditorPlan(canvas: HTMLCanvasElement): EditorPlan | undefined {
  return plans.get(canvas);
}
export function observeEditorPaint(
  observer: (inputTime: number, paintTime: number) => void,
): () => void {
  paintObservers.add(observer);
  return () => {
    paintObservers.delete(observer);
  };
}
/** Cached source blueprint. Pointer movement changes one overlay, not boolean geometry or navigation. */
export class EditorPlan {
  private model: PlanModel | null = null;
  private state: EditorState;
  private geometryRevision = -1;
  private observer: ResizeObserver;
  private unsubscribe: () => void;
  private base = document.createElement('canvas');
  private baseDirty = true;
  private center: Point = { x: 25, z: 25 };
  private scale = 12;
  private frame = 0;
  private disposed = false;
  private drag: Drag | null = null;
  private pan: { x: number; y: number; center: Point } | null = null;
  private space = false;
  private guide: Point[] | null = null;
  private diagnostics: Diagnostic[] = [];
  private inputs: number[] = [];
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly store: CommandStore,
    private readonly options: EditorPlanOptions = {},
  ) {
    this.state = store.getSnapshot();
    this.update();
    this.fit('objects');
    this.unsubscribe = store.subscribe(() => this.update());
    this.observer = new ResizeObserver(() => {
      this.baseDirty = true;
      this.schedule();
    });
    this.observer.observe(canvas);
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('lostpointercapture', this.lostCapture);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    plans.set(canvas, this);
  }
  private update(): void {
    this.state = this.store.getSnapshot();
    if (this.geometryRevision !== this.state.geometryRevision || !this.model) {
      try {
        this.model = planModel(this.state.document, this.model ?? undefined);
      } catch (error) {
        this.model = null;
        this.options.error?.(error);
      }
      this.geometryRevision = this.state.geometryRevision;
      this.baseDirty = true;
    }
    this.schedule();
  }
  fit(mode: 'site' | 'objects' = 'site'): void {
    const model = this.model;
    if (!model) return;
    let b: Bounds = model.bounds;
    if (mode === 'objects' && (model.modules.size || model.walls.size))
      b = bounds(
        [...model.modules.values()]
          .flatMap((m) => m.rings.flatMap((r) => r.points))
          .concat([...model.walls.values()].flatMap((w) => w.path)),
      );
    this.center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    this.scale = Math.max(
      0.05,
      Math.min(
        1000,
        Math.min(
          Math.max(100, this.canvas.clientWidth - 64) / Math.max(2, b.maxX - b.minX + 2),
          Math.max(100, this.canvas.clientHeight - 64) / Math.max(2, b.maxZ - b.minZ + 2),
        ),
      ),
    );
    this.baseDirty = true;
    this.schedule();
  }
  setDiagnostics(diagnostics: Diagnostic[]): void {
    this.diagnostics = diagnostics;
    this.schedule();
  }
  setGuide(points: Point[] | null): void {
    this.guide = points;
    this.schedule();
  }
  focusPoint(point: Point, scale = this.scale): void {
    this.center = { ...point };
    this.scale = Math.max(0.05, Math.min(1000, scale));
    this.baseDirty = true;
    this.schedule();
  }
  worldPoint(clientX: number, clientY: number): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.canvas.clientWidth / 2) / this.scale + this.center.x,
      z: (clientY - r.top - this.canvas.clientHeight / 2) / this.scale + this.center.z,
    };
  }
  clientPoint(point: Point): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.left + this.canvas.clientWidth / 2 + (point.x - this.center.x) * this.scale,
      y: r.top + this.canvas.clientHeight / 2 + (point.z - this.center.z) * this.scale,
    };
  }
  getModel(): PlanModel | null {
    return this.model;
  }
  private mark(event: PointerEvent): void {
    if ((this.options.painted || paintObservers.size) && this.inputs.length < 2048)
      this.inputs.push(event.timeStamp);
  }
  private schedule(): void {
    if (!this.frame && !this.disposed)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
  }
  private transform(context: CanvasRenderingContext2D): void {
    const dpr = Math.min(devicePixelRatio, 2);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.translate(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
    context.scale(this.scale, this.scale);
    context.translate(-this.center.x, -this.center.z);
  }
  private path(points: Point[], closed = false): Path2D {
    const path = new Path2D();
    if (!points.length) return path;
    path.moveTo(points[0]!.x, points[0]!.z);
    for (let i = 1; i < points.length; i++) path.lineTo(points[i]!.x, points[i]!.z);
    if (closed) path.closePath();
    return path;
  }
  private ringsPath(rings: { points: Point[] }[]): Path2D {
    const result = new Path2D();
    for (const ring of rings) result.addPath(this.path(ring.points, true));
    return result;
  }
  private drawBase(width: number, height: number): void {
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    const ctx = this.base.getContext('2d')!;
    ctx.fillStyle = '#e9ece1';
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    this.transform(ctx);
    const model = this.model;
    if (!model) return;
    ctx.fillStyle = '#f8f8ef';
    ctx.fill(this.ringsPath(model.site), 'evenodd');
    ctx.strokeStyle = '#aab69b';
    ctx.lineWidth = 1 / this.scale;
    ctx.setLineDash([6 / this.scale, 5 / this.scale]);
    ctx.stroke(this.ringsPath(model.site));
    ctx.setLineDash([]);
    const grid = Math.pow(2, Math.ceil(Math.log2(28 / this.scale))),
      left = this.center.x - width / 2 / this.scale,
      right = this.center.x + width / 2 / this.scale,
      top = this.center.z - height / 2 / this.scale,
      bottom = this.center.z + height / 2 / this.scale;
    ctx.strokeStyle = '#18372310';
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    for (let x = Math.ceil(left / grid) * grid; x < right; x += grid) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let z = Math.ceil(top / grid) * grid; z < bottom; z += grid) {
      ctx.moveTo(left, z);
      ctx.lineTo(right, z);
    }
    ctx.stroke();
    for (const module of model.modules.values()) {
      ctx.fillStyle = '#d9e4cf';
      ctx.fill(this.ringsPath(module.rings), 'evenodd');
      ctx.strokeStyle = '#2d4735';
      ctx.lineWidth = Math.max(
        1.5 / this.scale,
        this.state.document.physicalProfile.panelThicknessM,
      );
      for (const points of module.wallPaths) ctx.stroke(this.path(points));
      if (this.scale >= 12) {
        ctx.font = `${10 / this.scale}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#5b705b';
        ctx.fillText(
          module.instance.id.slice(0, 8),
          module.instance.position.x,
          module.instance.position.z,
        );
      }
    }
    ctx.lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = '#668358';
    ctx.setLineDash([5 / this.scale, 4 / this.scale]);
    for (const c of this.state.document.connections) {
      const a = model.openings.get(c.openingA),
        b = model.openings.get(c.openingB);
      if (a && b) ctx.stroke(this.path([a.center, b.center]));
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#8b6745';
    ctx.lineWidth = Math.max(2 / this.scale, this.state.document.physicalProfile.panelThicknessM);
    for (const wall of model.walls.values()) ctx.stroke(this.path(wall.path));
    for (const opening of model.openings.values()) this.drawOpening(ctx, opening, opening.center);
  }
  private drawOpening(ctx: CanvasRenderingContext2D, opening: PlanOpening, point: Point): void {
    ctx.fillStyle = opening.error
      ? '#d07a35'
      : opening.opening.role === 'entrance'
        ? '#2b8656'
        : opening.opening.role === 'exit'
          ? '#b74b35'
          : '#e9f3dc';
    ctx.strokeStyle = '#364d37';
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    ctx.arc(point.x, point.z, 4 / this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  render(): void {
    if (this.disposed) return;
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio, 2),
      w = Math.round(width * dpr),
      h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.baseDirty = true;
    }
    if (this.baseDirty) {
      this.drawBase(width, height);
      this.baseDirty = false;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.base, 0, 0);
    this.transform(ctx);
    const model = this.model,
      selection = this.state.selection,
      gesture = this.state.gesture;
    if (model) {
      if (gesture) {
        const module = model.modules.get(gesture.instanceId);
        if (module) {
          ctx.fillStyle = '#b4d6f0b0';
          ctx.fill(this.ringsPath(previewRings(module, gesture)), 'evenodd');
          ctx.strokeStyle = '#246b9d';
          ctx.lineWidth = 2 / this.scale;
          for (const points of module.wallPaths)
            ctx.stroke(
              this.path(
                points.map((p) =>
                  transformPoint(inversePoint(p, module.instance), gesture.preview),
                ),
              ),
            );
          for (const opening of model.openings.values())
            if (opening.opening.instanceId === gesture.instanceId)
              this.drawOpening(
                ctx,
                opening,
                transformPoint(inversePoint(opening.center, module.instance), gesture.preview),
              );
        }
      }
      if (selection) {
        ctx.strokeStyle = '#bc6c22';
        ctx.lineWidth = 2.5 / this.scale;
        ctx.setLineDash([5 / this.scale, 3 / this.scale]);
        if (selection.field === 'instances') {
          const module = model.modules.get(selection.id);
          if (module) ctx.stroke(this.ringsPath(previewRings(module, gesture)));
        } else if (selection.field === 'freeWalls') {
          const wall = model.walls.get(selection.id);
          if (wall) ctx.stroke(this.path(wall.path));
        } else if (selection.field === 'openings') {
          const opening = model.openings.get(selection.id);
          if (opening) {
            ctx.beginPath();
            ctx.arc(opening.center.x, opening.center.z, 8 / this.scale, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (selection.field === 'connections') {
          const c = this.state.document.connections.find((c) => c.id === selection.id),
            a = c && model.openings.get(c.openingA),
            b = c && model.openings.get(c.openingB);
          if (a && b) ctx.stroke(this.path([a.center, b.center]));
        }
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = '#c47521';
      ctx.lineWidth = 2 / this.scale;
      for (const d of this.diagnostics)
        if (d.location) {
          ctx.beginPath();
          ctx.arc(d.location.x, d.location.z, 10 / this.scale, 0, Math.PI * 2);
          ctx.stroke();
        }
    }
    if (this.guide) {
      ctx.strokeStyle = '#246b9d';
      ctx.lineWidth = 2 / this.scale;
      ctx.setLineDash([4 / this.scale, 3 / this.scale]);
      ctx.stroke(this.path(this.guide));
      ctx.setLineDash([]);
    }
    const now = performance.now();
    for (const time of this.inputs) {
      this.options.painted?.(time, now);
      for (const observer of paintObservers) observer(time, now);
    }
    this.inputs = [];
  }
  private down = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.mark(event);
    if (event.button === 1 || event.button === 2 || this.space || event.altKey) {
      this.pan = { x: event.clientX, y: event.clientY, center: { ...this.center } };
      return;
    }
    if (!this.model) return;
    const point = this.worldPoint(event.clientX, event.clientY),
      selection = hitPlan(this.model, this.state.document, point, 6 / this.scale);
    if (this.options.pointer?.('down', point, selection)) return;
    this.store.select(selection);
    if (selection?.field === 'instances') {
      const instance = this.state.document.instances.find((i) => i.id === selection.id)!;
      this.drag = {
        instanceId: instance.id,
        start: point,
        original: { position: { ...instance.position }, rotationRad: instance.rotationRad },
        rotate: event.shiftKey,
        angle: Math.atan2(point.z - instance.position.z, point.x - instance.position.x),
      };
      this.store.beginGesture(instance.id);
    }
  };
  private move = (event: PointerEvent): void => {
    if (this.pan) {
      this.center = {
        x: this.pan.center.x - (event.clientX - this.pan.x) / this.scale,
        z: this.pan.center.z - (event.clientY - this.pan.y) / this.scale,
      };
      this.baseDirty = true;
      this.mark(event);
      this.schedule();
      return;
    }
    const point = this.worldPoint(event.clientX, event.clientY);
    if (this.options.pointer?.('move', point, null)) {
      this.mark(event);
      this.schedule();
      return;
    }
    if (!this.drag) return;
    const drag = this.drag;
    let transform: Transform;
    if (drag.rotate) {
      const angle =
        Math.atan2(point.z - drag.original.position.z, point.x - drag.original.position.x) -
        drag.angle;
      transform = {
        ...drag.original,
        rotationRad: drag.original.rotationRad + Math.atan2(Math.sin(angle), Math.cos(angle)),
      };
    } else
      transform = {
        position: {
          x: drag.original.position.x + point.x - drag.start.x,
          z: drag.original.position.z + point.z - drag.start.z,
        },
        rotationRad: drag.original.rotationRad,
      };
    try {
      this.store.previewTransform(snapped(transform, this.options.snap?.() ?? false));
      this.mark(event);
    } catch (error) {
      this.options.error?.(error);
    }
  };
  private up = (event: PointerEvent): void => {
    const point = this.worldPoint(event.clientX, event.clientY);
    this.pan = null;
    if (this.options.pointer?.('up', point, null)) {
      this.release(event);
      return;
    }
    if (this.drag) {
      this.drag = null;
      try {
        this.store.endGesture();
      } catch (error) {
        this.options.error?.(error);
      }
    }
    this.release(event);
    this.mark(event);
    this.schedule();
  };
  private release(event: PointerEvent): void {
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
  }
  private cancel = (): void => {
    this.pan = null;
    this.drag = null;
    this.store.cancelGesture();
    this.guide = null;
    this.schedule();
  };
  private lostCapture = (): void => {
    if (this.drag) this.cancel();
  };
  private wheel = (event: WheelEvent): void => {
    event.preventDefault();
    const anchor = this.worldPoint(event.clientX, event.clientY);
    this.scale = Math.max(
      0.05,
      Math.min(1000, this.scale * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002)),
    );
    const r = this.canvas.getBoundingClientRect();
    this.center = {
      x: anchor.x - (event.clientX - r.left - this.canvas.clientWidth / 2) / this.scale,
      z: anchor.z - (event.clientY - r.top - this.canvas.clientHeight / 2) / this.scale,
    };
    this.baseDirty = true;
    this.schedule();
  };
  private contextMenu = (event: Event): void => {
    event.preventDefault();
  };
  private keyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && document.activeElement === this.canvas) {
      event.preventDefault();
      this.space = true;
    }
    if (event.code === 'Escape' && this.drag) {
      event.preventDefault();
      this.cancel();
    }
  };
  private keyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this.space = false;
  };
  private blur = (): void => {
    this.space = false;
    this.cancel();
  };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.observer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.drag = null;
    this.pan = null;
    this.store.cancelGesture();
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.lostCapture);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.removeEventListener('contextmenu', this.contextMenu);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    this.base.width = 0;
    this.base.height = 0;
    this.model = null;
    plans.delete(this.canvas);
    this.inputs = [];
  }
}
