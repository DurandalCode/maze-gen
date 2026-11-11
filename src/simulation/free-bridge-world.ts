import type {Maze,Point} from '../core/maze';
import {walls} from '../core/maze';
import {supportColliders} from '../core/structure';
import {freeRuntime} from '../free/layout';
import {bridgeGeometry} from '../free/bridges';
import {CollisionWorld} from './collisions';

export class FreeBridgeWorld {
  private collisions:CollisionWorld;
  private ground:ReturnType<typeof freeRuntime>;
  private bridges:ReturnType<typeof bridgeGeometry>[];
  constructor(maze:Maze){
    this.collisions=new CollisionWorld([...walls(maze),...supportColliders(maze)]);
    this.ground=freeRuntime(maze);
    this.bridges=(maze.free!.bridges??[]).map(b=>bridgeGeometry(maze.free!,b));
  }
  surface(from:Point,target:Point):Point|null {
    const current=this.bridges.find(g=>g.bridge.id===from.bridge);
    if(current){
      const t=current.progress(target);
      if(current.contains(target)&&t>=0&&t<=1)return {...target,y:current.height(t),floor:1,bridge:current.bridge.id};
      if(t>1e-7&&t<1-1e-7)return null;
      if((from.y??0)>.12)return null;
    }else for(const g of this.bridges){
      const t=g.progress(target);
      if(g.contains(target)&&t>=0&&t<=1&&g.height(t)<.12)return {...target,y:g.height(t),floor:1,bridge:g.bridge.id};
    }
    const point:Point={...target,y:0,floor:0};delete point.bridge;delete point.stair;
    if(!this.ground.contains(point))return null;
    return point;
  }
  move(start:Point,delta:Point,onStep:(point:Point)=>void):Point {
    const count=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.z)/.0625));let point={...start};
    for(let i=0;i<count;i++){
      for(const axis of ['x','z'] as const){
        const next=this.surface(point,{...point,[axis]:point[axis]+delta[axis]/count});
        if(next&&!this.collisions.blocked(next))point=next;
      }
      onStep({...point});
    }
    return point;
  }
}
