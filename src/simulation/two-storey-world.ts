import {walls,type Maze,type Point} from '../core/maze';
import {stairAt,stairProgress,spatialCellAt} from '../core/two-storey';
import {domainOf} from '../core/domain';
import {storeyView} from '../core/two-storey';
import {supportColliders} from '../core/structure';
import {CollisionWorld} from './collisions';
/** Grounded walking: a stair is the only surface connecting the two floor elevations. */
export class TwoStoreyWorld {
  private world:CollisionWorld;
  constructor(private maze:Maze){this.world=new CollisionWorld([...walls(maze),...supportColliders(maze)],maze.parameters.corridorWidth);}
  surface(from:Point,target:Point):Point|null {
    const s=this.maze.storeys!,st=stairAt(this.maze,target),result:Point={...target,floor:from.floor??0,y:from.y??0};
    if(st){const t=stairProgress(st,target),y=t*s.floorHeight;
      if(from.stair!==st.id&&Math.abs(y-(from.y??0))>.15)return null;
      result.stair=st.id;result.y=y;result.floor=t<.5?0:1;
    }else{
      delete result.stair;
      if(from.stair!==undefined){const previous=s.stairs.find(st=>st.id===from.stair)!;const t=stairProgress(previous,target);if(t>.99){result.floor=1;result.y=s.floorHeight;}else if(t<.01){result.floor=0;result.y=0;}else return null;}
      else result.y=(result.floor??0)*s.floorHeight;
      const constrained=domainOf(storeyView(this.maze,result.floor??0)).constrain(from,result);result.x=constrained.x;result.z=constrained.z;
      if(spatialCellAt(this.maze,result)===null)return null;
    }
    return result;
  }
  blocked(point:Point,radius=.25):boolean {
    return this.world.blocked(point,radius);
  }
  move(start:Point,delta:Point,onStep:(p:Point)=>void):Point {
    const count=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.z)/.0625));let point={...start};
    for(let i=0;i<count;i++){
      for(const axis of ['x','z'] as const){const next=this.surface(point,{...point,[axis]:point[axis]+delta[axis]/count});if(next&&!this.blocked(next))point=next;}
      onStep({...point});
    }
    return point;
  }
}
