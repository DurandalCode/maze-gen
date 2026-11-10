import {TwoStoreyWorld} from './two-storey-world';
import {freePortal} from '../free/layout';
import {segmentDistance} from '../free/geometry';
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
  private spatialWorld?:TwoStoreyWorld;
  constructor(private maze: Maze, private world: CollisionWorld, readonly mode:'walk'|'inspection'='walk') {
    this.position = {...portalPoint(maze, maze.entrance)};
    this.yaw = { west: -Math.PI/2, east: Math.PI/2, north: Math.PI, south: 0 }[maze.entrance.side];
    if(maze.version===5){const n=freePortal(maze,maze.free!.entrance).normal;this.yaw=Math.atan2(n.x,n.z);}
    if(mode==='inspection'){this.position={x:maze.width/2,z:maze.depth+6,y:0,floor:0};this.yaw=0;}
    this.recorder = new Recorder(this.position);
    if(maze.storeys&&mode==='walk')this.spatialWorld=new TwoStoreyWorld(maze);
  }

  update(dt: number, keys: ReadonlySet<string>): void {
    if (this.finished || dt <= 0) return;
    let forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    let right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const norm = Math.hypot(forward, right);
    if (norm) { forward /= norm; right /= norm; }
    this.updateAnalog(dt, forward, right, keys.has('ShiftLeft') || keys.has('ShiftRight'));
  }

  /** Continuous thumbstick movement; magnitude controls speed, diagonals stay bounded. */
  updateAnalog(dt: number, forward: number, right: number, sprint = false): void {
    if (this.finished || !Number.isFinite(dt) || dt <= 0) return;
    if (!Number.isFinite(forward) || !Number.isFinite(right)) { forward = 0; right = 0; }
    const norm = Math.hypot(forward, right);
    if (norm > 1) { forward /= norm; right /= norm; }
    const distance = (sprint ? 2.8 : 1.4) * dt;
    const delta = {
      x: (-Math.sin(this.yaw)*forward + Math.cos(this.yaw)*right)*distance,
      z: (-Math.cos(this.yaw)*forward - Math.sin(this.yaw)*right)*distance,
    };
    if(this.spatialWorld){
      const elapsed=this.recorder.elapsed,count=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.z)/.0625));let step=0;
      this.position=this.spatialWorld.move(this.position,delta,p=>{step++;if(this.finished)return;this.recorder.record(p,elapsed+dt*step/count);if(this.atExit(p)){this.finished=true;this.recorder.record(p,this.recorder.elapsed,true);}});
      if(this.finished)this.position={...this.recorder.samples.at(-1)!};return;
    }
    const previousTime = this.recorder.elapsed;
    let step = 0;
    const totalSteps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / 0.0625));
    let previous = {...this.position};
    this.position = this.world.move(this.position, delta, 0.25, point => {
      step++;
      if(this.mode==='inspection'){
        point.x=Math.max(-20,Math.min(this.maze.width+20,point.x));
        point.z=Math.max(-20,Math.min(this.maze.depth+20,point.z));
        return;
      }
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
    if(this.maze.storeys&&((point.floor??0)!==0||point.stair!==undefined||(point.y??0)>.01))return false;
    if(this.maze.version===5){const g=freePortal(this.maze,this.maze.free!.exit);return segmentDistance(point,g.wall)<.03&&Math.hypot(point.x-g.mid.x,point.z-g.mid.z)<=this.maze.exit.width!/2-.25;}
    const exit = portalPoint(this.maze, this.maze.exit);
    const side = this.maze.exit.side;
    const size = cellSize(this.maze, this.maze.exit.cell);
    const half = (this.maze.exit.width??(side === 'east' || side === 'west' ? size.depth : size.width))/2 - 0.25;
    return side === 'east' || side === 'west'
      ? Math.abs(point.x-exit.x) < 1e-6 && Math.abs(point.z-exit.z) <= half
      : Math.abs(point.z-exit.z) < 1e-6 && Math.abs(point.x-exit.x) <= half;
  }
}
