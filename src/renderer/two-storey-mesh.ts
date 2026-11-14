import {woodMaterial} from './wood';
import {plankFloorMaterial,plankSlabGeometry} from './plank-floor';
import * as THREE from 'three';
import {domainOf} from '../core/domain';
import {walls,type Maze} from '../core/maze';
import {storeyView} from '../core/two-storey';
import {timberMesh} from './timber-mesh';
import {fabricMaterial} from './fabric-material';
import {groundMaterial} from './ground';
/** Floors, shaft holes and steps share the navigation layout's reserved rectangles. */
export function twoStoreyMesh(maze:Maze):THREE.Group {
  const s=maze.storeys!,group=new THREE.Group(),deck=plankFloorMaterial(),stairWood=woodMaterial(),fabric=fabricMaterial(maze.wallColor,maze.translucentFabric,'wall',maze.fabricTransmissionStrength),box=new THREE.BoxGeometry(1,1,1),dummy=new THREE.Object3D();
  const segments=walls(maze),mesh=new THREE.InstancedMesh(box,fabric,segments.length);mesh.name='fabric-walls';mesh.castShadow=true;mesh.receiveShadow=true;
  for(const [i,w]of segments.entries()){dummy.position.set((w.x1+w.x2)/2,(w.y??0)+(w.height??maze.wallHeight)/2,(w.z1+w.z2)/2);dummy.scale.set(Math.max(.06,Math.abs(w.x2-w.x1)),w.height??maze.wallHeight,Math.max(.06,Math.abs(w.z2-w.z1)));dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.computeBoundingSphere();group.add(mesh);
  const addBox=(x:number,y:number,z:number,width:number,height:number,depth:number,material:THREE.Material)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);};
  for(const floor of [0,1]){
    const view=storeyView(maze,floor),frame=timberMesh(view);frame.position.y=floor*s.floorHeight;
    // Remove frame members inside shafts before building, instead of hiding collision obstacles.
    frame.traverse(obj=>{if(obj instanceof THREE.Mesh)obj.castShadow=true;});
    group.add(frame);
    const n=view.passages.length;
    for(const c of domainOf(view).cells){if(!s.nodes[c+floor*n])continue;const r=domainOf(view).rectangles[c]!,x=(r.x1+r.x2)/2,z=(r.z1+r.z2)/2,width=r.x2-r.x1,depth=r.z2-r.z1;
      if(floor===1){const slab=new THREE.Mesh(plankSlabGeometry(x,z,width,s.slabThickness,depth),deck);slab.name='plank-floor-ceiling';slab.position.set(x,s.floorHeight-s.slabThickness/2,z);slab.castShadow=true;slab.receiveShadow=true;group.add(slab);}
      const covered=floor===0&&!!s.nodes[c+n];
      if(maze.roof&&!covered)addBox(x,floor*s.floorHeight+maze.wallHeight+.03,z,width,.06,depth,fabricMaterial(maze.wallColor,maze.translucentFabric,'roof',maze.fabricTransmissionStrength));
    }
  }
  for(const st of s.stairs){const dx=(st.end.x-st.start.x)/st.steps,dz=(st.end.z-st.start.z)/st.steps;
    for(let i=0;i<st.steps;i++){
      const height=st.rise*(i+1)/st.steps,width=st.axis==='x'?Math.abs(dx):st.width,depth=st.axis==='z'?Math.abs(dz):st.width;
      const geometry=new THREE.BoxGeometry(width,height,depth),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
      // The long grain follows the tread width on both stair orientations.
      // Each step samples another part of the same pine texture, in physical metres.
      for(let v=0;v<position.count;v++){
        const across=st.axis==='x'?position.getZ(v):position.getX(v),along=st.axis==='x'?position.getX(v):position.getZ(v);
        const side=st.axis==='x'?Math.abs(normal.getZ(v))>.5:Math.abs(normal.getX(v))>.5;
        uv.setXY(v,(Math.abs(normal.getY(v))>.5?along:position.getY(v))/.2,(side?along:across)/2+i*.29+st.id*.17);
      }
      const step=new THREE.Mesh(geometry,stairWood);step.name='wooden-stair-step';step.position.set(st.start.x+dx*(i+.5),height/2,st.start.z+dz*(i+.5));step.castShadow=true;step.receiveShadow=true;group.add(step);
    }
    if(maze.roof){const length=Math.hypot(st.end.x-st.start.x,st.end.z-st.start.z);addBox((st.start.x+st.end.x)/2,s.floorHeight+maze.wallHeight+.03,(st.start.z+st.end.z)/2,st.axis==='x'?length:st.width,.06,st.axis==='z'?length:st.width,fabricMaterial(maze.wallColor,maze.translucentFabric,'roof',maze.fabricTransmissionStrength));}
  }
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(maze.width+100,maze.depth+100),groundMaterial(maze.width+100,maze.depth+100));ground.rotation.x=-Math.PI/2;ground.position.set(maze.width/2,-.025,maze.depth/2);ground.receiveShadow=true;group.add(ground);return group;
}
