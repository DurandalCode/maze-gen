import type { HeatDisplay } from './coldspot-controls';
import {visibleDeadEnds} from '../analysis/visible-deadends';
import { cellAtPoint } from '../analysis/navigation';
import { domainOf } from '../core/domain';
import { portalPoint, walls, type Maze, type Point, type Portal } from '../core/maze';
import { mazePortals, portalAtPoint, samePortal } from '../core/portals';
import { moduleFootprints } from '../core/structure';
import { routePoints } from '../core/pathfinding';
import { environmentOf, forestAtPoint, forestMapPoints, landmarkMapBounds, type Environment } from '../core/environment';
import { solarMinuteForAzimuth, solarPosition } from '../core/solar';
import {trapDetailsAt,type TrapOverlayEntry} from './trap-overlay';
import {criticalWallAt,type CriticalWall} from '../analysis/critical-walls';

interface MapLayout { scale: number; left: number; top: number; centerX: number; centerY: number; radiusX: number; radiusY: number }

export class MapView {
  private context: CanvasRenderingContext2D;
  private maze: Maze;
  private segments: ReturnType<typeof walls>;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private drag: { x: number; y: number } | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private dragged = false;
  private draggedLandmark: 'sun' | 'forest' | null = null;
  private preview: Environment | null = null;
  private frozenLayout: MapLayout | null = null;
  private observer: ResizeObserver;
  private events = new AbortController();
  heat: HeatDisplay|null = null;
  traps:readonly TrapOverlayEntry[]=[];
  criticalWalls:readonly CriticalWall[]=[];
  showRoute = false;
  trajectory: readonly Point[] = [];
  onPlacePortal: ((portal: Portal | null) => void) | null = null;
  onEnvironmentChange: ((environment: Environment) => void) | null = null;

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
      if (event.button !== 0) return;
      this.drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId);
      this.dragStart = { ...this.drag }; this.dragged = false;
      if (!this.onPlacePortal && this.onEnvironmentChange) {
        const rect = canvas.getBoundingClientRect(), handles = this.landmarkHandles();
        const x = event.clientX-rect.left, y = event.clientY-rect.top;
        this.draggedLandmark = Math.hypot(x-handles.sun.x, y-handles.sun.y) < 24 ? 'sun'
          : Math.hypot(x-handles.forest.x, y-handles.forest.y) < 30 ? 'forest' : null;
        if (this.draggedLandmark) { this.frozenLayout = this.layout(); this.preview = environmentOf(this.maze); }
      }
    }, { signal: this.events.signal });
    canvas.addEventListener('pointermove', event => {
      if (!this.drag) return;
      if (!this.dragged && this.dragStart && Math.hypot(event.clientX-this.dragStart.x, event.clientY-this.dragStart.y) < 4) return;
      this.dragged = true; canvas.classList.add('dragging');
      if (this.draggedLandmark && this.preview) {
        const rect = canvas.getBoundingClientRect(), layout = this.layout();
        const x = event.clientX-rect.left, y = event.clientY-rect.top;
        if (this.draggedLandmark === 'sun') {
          const azimuth = (Math.atan2((x-layout.centerX)/layout.radiusX, -(y-layout.centerY)/layout.radiusY)*180/Math.PI+360)%360;
          this.preview = { ...this.preview, sun: { ...this.preview.sun,
            minutes: solarMinuteForAzimuth(this.preview.sun.day, azimuth) } };
        } else this.preview = forestAtPoint(this.maze, { x: (x-layout.left)/layout.scale, z: (y-layout.top)/layout.scale }, this.preview);
        this.draw(); return;
      }
      this.pan.x += event.clientX-this.drag.x; this.pan.y += event.clientY-this.drag.y;
      this.drag = { x: event.clientX, y: event.clientY }; this.draw();
    }, { signal: this.events.signal });
    const end = () => {
      this.drag = null; this.dragStart = null; this.draggedLandmark = null;
      this.preview = null; this.frozenLayout = null; canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', event => {
      const place = this.drag && !this.dragged ? this.onPlacePortal : null;
      const environment = this.dragged && this.draggedLandmark ? this.preview : null;
      end();
      if (environment) { this.onEnvironmentChange?.(environment); return; }
      if (place) {
        const rect = canvas.getBoundingClientRect(), { scale, left, top } = this.layout();
        place(portalAtPoint(this.maze,
          { x: (event.clientX-rect.left-left)/scale, z: (event.clientY-rect.top-top)/scale }, 16/scale));
      }
    }, { signal: this.events.signal });
    canvas.addEventListener('pointercancel', () => { end(); this.draw(); }, { signal: this.events.signal });
  }
  setMaze(maze: Maze): void {
    this.maze = maze; this.segments = walls(maze); this.trajectory = []; this.fit();
  }
  fit(): void { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.draw(); }
  zoomBy(factor: number): void { this.zoom = Math.max(0.35, Math.min(12, this.zoom*factor)); this.draw(); }
  dispose(): void { this.observer.disconnect(); this.events.abort(); }

  heatDetailsAt(x:number,y:number):string|null {
    const {left,top,scale}=this.layout(),cell=cellAtPoint(this.maze,{x:(x-left)/scale,z:(y-top)/scale});
    if(cell===null) return null;
    const trapText=trapDetailsAt(this.traps,cell),critical=criticalWallAt(this.criticalWalls,{x:(x-left)/scale,z:(y-top)/scale},6/scale);
    if(critical)trapText.unshift(`Критическая стена: ${critical.protections.map(p=>p.reason).join('; ')}`);
    if(!this.heat)return trapText.length?trapText.join(' · '):null;
    const {analysis}=this.heat,p=analysis.probability[cell]!;
    if(analysis.method==='sampled'&&analysis.options.profile!=='explorer'&&visibleDeadEnds(this.maze).cells.has(cell))trapText.push('Полностью видимый тупик: исследуется взглядом, без захода');
    const region=p<analysis.options.threshold?analysis.regions.find(r=>r.cells.includes(cell)):undefined;
    const fmt=(v:number)=>v.toLocaleString('ru-RU',{maximumFractionDigits:1});
    const visibility=analysis.landmarks;
    const cues=visibility?[visibility.sun[cell]!>=0.2?'солнце':'',visibility.forest[cell]!>=0.2?'лес':'',visibility.boundary[cell]!>=0.2?'внешняя граница':''].filter(Boolean):[];
    const visibilityText=visibility?` · ${cues.length?cues.join(', '):'ориентиры скрыты'}`:'';
    return [`Посещение: ${fmt(p*100)}% · в среднем ${fmt(analysis.visits[cell]!)} раз${region?` · колдспот ${fmt(region.area)} м²`:''}${visibilityText}`,...trapText].join(' · ');
  }
  private layout(): MapLayout {
    if (this.frozenLayout) return this.frozenLayout;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const bounds = landmarkMapBounds(this.maze, this.preview ?? environmentOf(this.maze));
    const width = bounds.maxX-bounds.minX, depth = bounds.maxZ-bounds.minZ;
    const scale = Math.max(0.1, Math.min((w-150)/width, (h-160)/depth)*this.zoom);
    const centerX = w/2+this.pan.x, centerY = h/2+this.pan.y;
    return { scale, left: centerX-(bounds.minX+bounds.maxX)*scale/2,
      top: centerY-(bounds.minZ+bounds.maxZ)*scale/2, centerX, centerY,
      radiusX: width*scale/2+28, radiusY: depth*scale/2+28 };
  }

  private landmarkHandles() {
    const environment = this.preview ?? environmentOf(this.maze), layout = this.layout();
    const forest = forestMapPoints(this.maze, environment);
    const azimuth = solarPosition(environment.sun).azimuth*Math.PI/180;
    const divisor = Math.max(Math.abs(Math.sin(azimuth)), Math.abs(Math.cos(azimuth)));
    return { sun: { x: layout.centerX+Math.sin(azimuth)/divisor*layout.radiusX,
      y: layout.centerY-Math.cos(azimuth)/divisor*layout.radiusY },
      forest: { x: layout.left+forest.reduce((sum, p) => sum+p.x, 0)/4*layout.scale,
        y: layout.top+forest.reduce((sum, p) => sum+p.z, 0)/4*layout.scale } };
  }

  draw(): void {
    const { canvas, context: ctx, maze } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#b4c6a1'; ctx.textAlign = 'left'; ctx.font = '600 11px "Segoe UI", sans-serif';
    ctx.fillText('С ↑', 24, 90);
    const { scale: s, left, top } = this.layout();
    const px = (x: number) => left+x*s, py = (z: number) => top+z*s;
    const environment = this.preview ?? environmentOf(maze), forest = forestMapPoints(maze, environment);
    ctx.fillStyle = '#28422e'; ctx.strokeStyle = '#63865c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); forest.forEach((point, i) => i ? ctx.lineTo(px(point.x), py(point.z)) : ctx.moveTo(px(point.x), py(point.z)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    const handles = this.landmarkHandles();
    ctx.fillStyle = '#d1eead'; ctx.textAlign = 'center'; ctx.font = '600 12px "Segoe UI", sans-serif';
    ctx.fillText('♣ ЛЕС ↔', handles.forest.x, handles.forest.y+4);
    const sunPosition = solarPosition(environment.sun);
    ctx.fillStyle = sunPosition.elevation < 0 ? '#8695ad' : '#ffda7d';
    ctx.beginPath(); ctx.arc(handles.sun.x, handles.sun.y, 11, 0, Math.PI*2); ctx.fill();
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.fillText(sunPosition.elevation < 0 ? 'СОЛНЦЕ ЗА ГОРИЗОНТОМ' : `СОЛНЦЕ · ${Math.round(sunPosition.elevation)}°`,
      Math.max(100, Math.min(w-100, handles.sun.x)), handles.sun.y+25);
    ctx.fillStyle = '#1b211b';
    for (const cell of domainOf(maze).cells) { const r=domainOf(maze).rectangles[cell]!; ctx.fillRect(px(r.x1),py(r.z1),(r.x2-r.x1)*s,(r.z2-r.z1)*s); }
    for (const m of moduleFootprints(maze)) {
      ctx.fillStyle = '#293023'; ctx.fillRect(px(m.x), py(m.z), m.size*s, m.size*s);
      ctx.strokeStyle = '#576044'; ctx.lineWidth = 1; ctx.strokeRect(px(m.x), py(m.z), m.size*s, m.size*s);
    }
    if(this.heat) {
      const {analysis,layer,coldOnly}=this.heat;
      let maximum=1;
      if(layer==='visits') for(const cell of domainOf(maze).cells) maximum=Math.max(maximum,analysis.visits[cell]!);
      for(const cell of domainOf(maze).cells) {
        const p=analysis.probability[cell]!;
        if(coldOnly && p>=analysis.options.threshold) continue;
        const value=layer==='probability'?p:analysis.visits[cell]!/maximum,r=domainOf(maze).rectangles[cell]!;
        const red=Math.round(38+207*value),green=Math.round(97+39*value),blue=Math.round(150-100*value);
        ctx.fillStyle=`rgb(${red} ${green} ${blue} / 82%)`;
        ctx.fillRect(px(r.x1),py(r.z1),(r.x2-r.x1)*s,(r.z2-r.z1)*s);
      }
    }
    ctx.strokeStyle = '#293027'; ctx.lineWidth = 1;
    const cell = maze.parameters.corridorWidth;
    ctx.beginPath();
    for(const cellIndex of domainOf(maze).cells) {
      const r=domainOf(maze).rectangles[cellIndex]!;
      ctx.rect(px(r.x1),py(r.z1),(r.x2-r.x1)*s,(r.z2-r.z1)*s);
    }
    ctx.stroke();
    const line = (points: readonly Point[], color: string, width: number) => {
      if (!points.length) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))); ctx.stroke();
    };
    for(const trap of this.traps){
      for(const points of trap.falsePaths)line(points,'#ec8af144',Math.max(5,Math.min(16,cell*s*.5)));
      line(trap.awayPath,'#63e5e944',Math.max(5,Math.min(16,cell*s*.5)));
    }
    if (this.showRoute) line(routePoints(maze), '#d1ee86', Math.max(2, Math.min(5, cell*s*0.16)));
    line(this.trajectory, '#e2ab78', 3);
    ctx.strokeStyle = '#c4ccb7'; ctx.lineWidth = Math.max(1.3, Math.min(3, cell*s*0.065)); ctx.lineCap = 'square';
    ctx.beginPath();
    for (const wall of this.segments) { ctx.moveTo(px(wall.x1), py(wall.z1)); ctx.lineTo(px(wall.x2), py(wall.z2)); }
    ctx.stroke();
    ctx.save();
    ctx.strokeStyle='#ffda75';ctx.lineWidth=Math.max(2.5,Math.min(4,cell*s*.12));
    for(const item of this.criticalWalls){const wall=item.wall;ctx.beginPath();ctx.moveTo(px(wall.x1),py(wall.z1));ctx.lineTo(px(wall.x2),py(wall.z2));ctx.stroke();}
    const offset=Math.min(4,cell*s*.16),shifted=(points:readonly Point[],sign:number)=>points.map(p=>({x:p.x+sign*offset/s,z:p.z-sign*offset/s}));
    for(const trap of this.traps){
      ctx.setLineDash([5,4]);for(const points of trap.falsePaths)line(shifted(points,1),'#f39cf7',2);
      ctx.setLineDash([2,4]);line(shifted(trap.awayPath,-1),'#65edf1',2);
      ctx.setLineDash([]);
      const end=shifted(trap.awayPath,-1),a=end.at(-2),b=end.at(-1);
      if(a&&b){const angle=Math.atan2(b.z-a.z,b.x-a.x),x=px(b.x),y=py(b.z);ctx.strokeStyle='#65edf1';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-7*Math.cos(angle-.5),y-7*Math.sin(angle-.5));ctx.lineTo(x,y);ctx.lineTo(x-7*Math.cos(angle+.5),y-7*Math.sin(angle+.5));ctx.stroke();}
      ctx.strokeStyle='#f39cf7';ctx.lineWidth=2.5;
      for(const p of trap.deadEnds){const x=px(p.x),y=py(p.z);ctx.beginPath();ctx.moveTo(x-4,y-4);ctx.lineTo(x+4,y+4);ctx.moveTo(x+4,y-4);ctx.lineTo(x-4,y+4);ctx.stroke();}
      const x=px(trap.point.x),y=py(trap.point.z),radius=10;
      ctx.fillStyle='#331938';ctx.strokeStyle='#f39cf7';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff0ff';ctx.font='600 9px "Segoe UI", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(trap.label,x,y);
    }
    ctx.restore();
    for (const [index, portal] of mazePortals(maze).entries()) {
      const start = samePortal(portal, maze.entrance), end = samePortal(portal, maze.exit);
      const label = `${index+1} · ${start ? 'СТАРТ' : end ? 'ФИНИШ' : 'ПРОЁМ'}`;
      const color = start ? '#d1ee86' : end ? '#e2ab78' : '#9acbdd';
      const point = portalPoint(maze, portal);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px(point.x), py(point.z), 5, 0, Math.PI*2); ctx.fill();
      ctx.font = '600 10px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      const offset = portal.side === 'north' ? -16 : portal.side === 'south' ? 23 : -14;
      ctx.fillText(label, px(point.x), py(point.z)+offset);
    }
    ctx.fillStyle = '#8a9584'; ctx.font = '11px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${maze.width.toLocaleString('ru-RU')} м`, px(maze.width/2), top-29);
    ctx.save(); ctx.translate(left-30, py(maze.depth/2)); ctx.rotate(-Math.PI/2);
    ctx.fillText(`${maze.depth.toLocaleString('ru-RU')} м`, 0, 0); ctx.restore();
    const rulerMeters = Math.max(1, Math.round(70/s));
    ctx.strokeStyle = '#8a9584'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(28, h-35); ctx.lineTo(28+rulerMeters*s, h-35); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillText(`${rulerMeters} м`, 28, h-44);
  }
}
