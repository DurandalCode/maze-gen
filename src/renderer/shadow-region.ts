import type * as THREE from 'three';
/** The geometry is static during a walk. A directional shadow only changes
 * when its existing half-metre following region (or light/maze) changes. */
export class FollowingShadowRegion {
 private x=NaN;private y=NaN;private z=NaN;
 invalidate():void{this.x=NaN;}
 update(position:{x:number;z:number;y?:number},direction:THREE.Vector3,light:THREE.DirectionalLight):boolean{
  const x=Math.round(position.x*2)/2,y=position.y??0,z=Math.round(position.z*2)/2;
  if(x===this.x&&y===this.y&&z===this.z)return false;
  this.x=x;this.y=y;this.z=z;
  light.position.set(x,y,z).add(direction);light.target.position.set(x,y,z);
  return true;
 }
}
