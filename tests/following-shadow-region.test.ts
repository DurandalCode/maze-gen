import{test,expect}from'bun:test';import * as THREE from'three';import{FollowingShadowRegion}from'../src/renderer/shadow-region';
test('shadow reuse preserves the exact existing following-light transform, including negative positions and stairs',()=>{
 const region=new FollowingShadowRegion(),light=new THREE.DirectionalLight(),direction=new THREE.Vector3(12,28,-19);
 for(const p of [{x:1.1,z:2.1},{x:1.2,z:2.2},{x:1.26,z:2.2},{x:-.26,z:-.24},{x:-.26,z:-.24,y:2},{x:-.26,z:-.24,y:2.1}]){
  region.update(p,direction,light);const x=Math.round(p.x*2)/2,z=Math.round(p.z*2)/2,y=p.y??0;
  expect(light.position.toArray()).toEqual([x+direction.x,y+direction.y,z+direction.z]);expect(light.target.position.toArray()).toEqual([x,y,z]);
 }
});
test('turning or moving within the same region reuses shadow; crossings, height and scene invalidation refresh it',()=>{
 const region=new FollowingShadowRegion(),light=new THREE.DirectionalLight(),direction=new THREE.Vector3(10,30,20);
 expect(region.update({x:0,z:0},direction,light)).toBe(true);
 for(let i=0;i<100;i++)expect(region.update({x:i/500,z:i/500},direction,light)).toBe(false);
 expect(region.update({x:.26,z:0},direction,light)).toBe(true);expect(region.update({x:.3,z:0},direction,light)).toBe(false);
 expect(region.update({x:.3,z:0,y:.01},direction,light)).toBe(true);
 region.invalidate();expect(region.update({x:.3,z:0,y:.01},direction,light)).toBe(true);
 direction.set(20,10,-10);region.invalidate();expect(region.update({x:.3,z:0,y:.01},direction,light)).toBe(true);expect(light.position.z).toBe(-10);
});
