import * as THREE from 'three';
import type {Maze,Point} from '../core/maze';
import {bridgeGeometry,bridgeSteps,bridgeUprights} from './bridges';
import {fabricMaterial} from '../renderer/fabric-material';
import {woodMaterial} from '../renderer/wood';
/** Render the same landings, stair runs and deck used by the free walker. */
export function bridgeMesh(maze:Maze):THREE.Group{
 const group=new THREE.Group();group.name='covered-free-bridges';
 const wood=woodMaterial(),fabric=fabricMaterial(maze.wallColor,maze.translucentFabric,'wall',maze.fabricTransmissionStrength);fabric.side=THREE.DoubleSide;
 const roof=fabricMaterial(maze.wallColor,maze.translucentFabric,'roof',maze.fabricTransmissionStrength);roof.side=THREE.DoubleSide;
 for(const bridge of maze.free!.bridges??[]){
  const g=bridgeGeometry(maze.free!,bridge),part=new THREE.Group();part.name=bridge.id;
  const box=(p:Point,w:number,h:number,d:number)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),wood);m.rotation.y=-Math.atan2(g.uz,g.ux);m.position.set(p.x,p.y??0,p.z);m.castShadow=true;m.receiveShadow=true;part.add(m);};
  const quad=(a:Point,b:Point,c:Point,d:Point,material:THREE.Material)=>{
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([a.x,a.y!,a.z,b.x,b.y!,b.z,c.x,c.y!,c.z,a.x,a.y!,a.z,c.x,c.y!,c.z,d.x,d.y!,d.z],3));geometry.computeVertexNormals();
   const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;part.add(mesh);
  };
  const offset=(p:Point,side:number,y=0):Point=>({x:p.x-g.uz*side,z:p.z+g.ux*side,y:p.y!+y});
  const steps=bridgeSteps(bridge),run=bridge.stairRun/g.length;
  for(const end of [0,1])for(let i=0;i<steps;i++){
   const t=end===0?run*(i+.5)/steps:1-run*(i+.5)/steps,p=g.at(t);
   const height=bridge.rise/steps+.12;box({...p,y:bridge.rise*(i+1)/steps-height/2},bridge.stairRun/steps,height,bridge.width);
  }
  const mid=g.at(.5);box({...mid,y:bridge.rise-.1},g.length-2*bridge.stairRun,.2,bridge.width);
  for(let i=1;i<g.path.length;i++){
   const a=g.path[i-1]!,b=g.path[i]!,half=bridge.width/2;
   for(const sign of [-1,1]){
    const p=offset(a,half*sign),q=offset(b,half*sign);
    quad(p,q,{...q,y:q.y!+maze.wallHeight},{...p,y:p.y!+maze.wallHeight},fabric);
    if(Math.abs(p.y!-q.y!)>1e-8)quad({...p,y:0},{...q,y:0},q,p,wood);
   }
   quad(offset(a,-half,maze.wallHeight),offset(b,-half,maze.wallHeight),offset(b,half,maze.wallHeight),offset(a,half,maze.wallHeight),roof);
  }
  for(const p of [g.path[1]!,g.path[2]!])quad({...offset(p,-bridge.width/2),y:0},{...offset(p,bridge.width/2),y:0},offset(p,bridge.width/2),offset(p,-bridge.width/2),wood);
  for(const p of g.deck)box({...p,y:maze.wallHeight+bridge.rise/2},.12,bridge.rise,.12);
  // Upper wall supports and roof headers follow the sloped flights as well.
  for(const post of bridgeUprights({...maze.free!,bridges:[bridge]},maze.wallHeight))box({x:post.x1,z:post.z1,y:post.y!+maze.wallHeight/2},.12,maze.wallHeight,.12);
  for(let i=1;i<g.path.length;i++)for(const sign of [-1,1]){const a=offset(g.path[i-1]!,bridge.width/2*sign,maze.wallHeight-.07),b=offset(g.path[i]!,bridge.width/2*sign,maze.wallHeight-.07),v=new THREE.Vector3(b.x-a.x,b.y!-a.y!,b.z-a.z),beam=new THREE.Mesh(new THREE.BoxGeometry(v.length(),.14,.04),wood);beam.position.set((a.x+b.x)/2,(a.y!+b.y!)/2,(a.z+b.z)/2);beam.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),v.normalize());beam.castShadow=true;part.add(beam);}
  group.add(part);
 }
 return group;
}
