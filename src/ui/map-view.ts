import { axisBounds, portalPoint, walls, type Maze, type Point } from '../core/maze';
import { moduleFootprints } from '../core/structure';
import { routePoints } from '../core/pathfinding';

export class MapView {
  private context: CanvasRenderingContext2D;
  private maze: Maze;
  private segments: ReturnType<typeof walls>;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private drag: { x: number; y: number } | null = null;
  private observer: ResizeObserver;
  private events = new AbortController();
  showRoute = false;
  trajectory: readonly Point[] = [];

  constructor(readonly canvas: HTMLCanvasElement, maze: Maze) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось создать 2D-карту.');
    this.context = ctx; this.maze = maze; this.segments = walls(maze);
    this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(canvas);
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX-rect.left-rect.width/2, y = event.clientY-rect.top-rect.height/2;
      const next = Math.max(0.35, Math.min(12, this.zoom * Math.exp(-event.deltaY*0.001)));
      const ratio = next/this.zoom;
      this.pan.x = x-(x-this.pan.x)*ratio; this.pan.y = y-(y-this.pan.y)*ratio;
      this.zoom = next; this.draw();
    }, { passive: false, signal: this.events.signal });
    canvas.addEventListener('pointerdown', event => {
      this.drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
    }, { signal: this.events.signal });
    canvas.addEventListener('pointermove', event => {
      if (!this.drag) return;
      this.pan.x += event.clientX-this.drag.x; this.pan.y += event.clientY-this.drag.y;
      this.drag = { x: event.clientX, y: event.clientY }; this.draw();
    }, { signal: this.events.signal });
    const end = () => { this.drag = null; canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', end, { signal: this.events.signal });
    canvas.addEventListener('pointercancel', end, { signal: this.events.signal });
  }
  setMaze(maze: Maze): void {
    this.maze = maze; this.segments = walls(maze); this.trajectory = []; this.fit();
  }
  fit(): void { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.draw(); }
  zoomBy(factor: number): void { this.zoom = Math.max(0.35, Math.min(12, this.zoom*factor)); this.draw(); }
  dispose(): void { this.observer.disconnect(); this.events.abort(); }

  draw(): void {
    const { canvas, context: ctx, maze } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const scale = Math.min((w-150)/maze.width, (h-160)/maze.depth)*this.zoom;
    const s = Math.max(0.1, scale);
    const left = w/2+this.pan.x-maze.width*s/2, top = h/2+this.pan.y-maze.depth*s/2;
    const px = (x: number) => left+x*s, py = (z: number) => top+z*s;
    ctx.fillStyle = '#1b211b'; ctx.fillRect(left, top, maze.width*s, maze.depth*s);
    for (const m of moduleFootprints(maze)) {
      ctx.fillStyle = '#293023'; ctx.fillRect(px(m.x), py(m.z), m.size*s, m.size*s);
      ctx.strokeStyle = '#576044'; ctx.lineWidth = 1; ctx.strokeRect(px(m.x), py(m.z), m.size*s, m.size*s);
    }
    ctx.strokeStyle = '#293027'; ctx.lineWidth = 1;
    const cell = maze.parameters.corridorWidth;
    ctx.beginPath();
    for (const x of axisBounds(maze, 'x')) { ctx.moveTo(px(x), top); ctx.lineTo(px(x), py(maze.depth)); }
    for (const z of axisBounds(maze, 'z')) { ctx.moveTo(left, py(z)); ctx.lineTo(px(maze.width), py(z)); }
    ctx.stroke();
    const line = (points: readonly Point[], color: string, width: number) => {
      if (!points.length) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))); ctx.stroke();
    };
    if (this.showRoute) line(routePoints(maze), '#d1ee86', Math.max(2, Math.min(5, cell*s*0.16)));
    line(this.trajectory, '#e2ab78', 3);
    ctx.strokeStyle = '#c4ccb7'; ctx.lineWidth = Math.max(1.3, Math.min(3, cell*s*0.065)); ctx.lineCap = 'square';
    ctx.beginPath();
    for (const wall of this.segments) { ctx.moveTo(px(wall.x1), py(wall.z1)); ctx.lineTo(px(wall.x2), py(wall.z2)); }
    ctx.stroke();
    for (const [portal, label, color] of [[maze.entrance, 'ВХОД', '#d1ee86'], [maze.exit, 'ВЫХОД', '#e2ab78']] as const) {
      const point = portalPoint(maze, portal);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px(point.x), py(point.z), 5, 0, Math.PI*2); ctx.fill();
      ctx.font = '600 10px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      const offset = portal.side === 'north' ? -16 : portal.side === 'south' ? 23 : -14;
      ctx.fillText(label, px(point.x), py(point.z)+offset);
    }
    ctx.fillStyle = '#8a9584'; ctx.font = '11px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${maze.width.toLocaleString('ru-RU')} м`, w/2+this.pan.x, top-29);
    ctx.save(); ctx.translate(left-30, h/2+this.pan.y); ctx.rotate(-Math.PI/2);
    ctx.fillText(`${maze.depth.toLocaleString('ru-RU')} м`, 0, 0); ctx.restore();
    const rulerMeters = Math.max(1, Math.round(70/s));
    ctx.strokeStyle = '#8a9584'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(28, h-35); ctx.lineTo(28+rulerMeters*s, h-35); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillText(`${rulerMeters} м`, 28, h-44);
  }
}
