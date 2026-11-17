import * as THREE from 'three';
/** Spatially bound opaque instances so normal camera AND shadow frusta can
 * reject remote tiles. Transparent instances keep their global ordering. */
export function spatialInstances(root:THREE.Object3D,tileSize=12,minimumInstances=128):void{
 const candidates:THREE.InstancedMesh[]=[];root.traverse(o=>{if(o instanceof THREE.InstancedMesh&&o.count>=minimumInstances&&!o.morphTexture&&(Array.isArray(o.material)?o.material:[o.material]).every(m=>!m.transparent))candidates.push(o);});
 const matrix=new THREE.Matrix4(),color=new THREE.Color();
 for(const mesh of candidates){const parent=mesh.parent;if(!parent)continue;const buckets=new Map<string,number[]>();
  for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);const key=Math.floor(matrix.elements[12]!/tileSize)+':'+Math.floor(matrix.elements[14]!/tileSize);let bucket=buckets.get(key);if(!bucket)buckets.set(key,bucket=[]);bucket.push(i);}
  if(buckets.size<2)continue;
  mesh.updateMatrix();const group=new THREE.Group();group.name=mesh.name;group.matrix.copy(mesh.matrix);group.matrixAutoUpdate=false;group.visible=mesh.visible;group.userData={...mesh.userData,spatialInstanceCount:mesh.count};group.layers.mask=mesh.layers.mask;
  for(const[key,indices]of buckets){const chunk=new THREE.InstancedMesh(mesh.geometry,mesh.material,indices.length);chunk.name=mesh.name+'-tile-'+key;chunk.castShadow=mesh.castShadow;chunk.receiveShadow=mesh.receiveShadow;chunk.renderOrder=mesh.renderOrder;chunk.layers.mask=mesh.layers.mask;chunk.frustumCulled=mesh.frustumCulled;chunk.customDepthMaterial=mesh.customDepthMaterial;chunk.customDistanceMaterial=mesh.customDistanceMaterial;chunk.onBeforeRender=mesh.onBeforeRender;chunk.onAfterRender=mesh.onAfterRender;chunk.onBeforeShadow=mesh.onBeforeShadow;chunk.onAfterShadow=mesh.onAfterShadow;
   indices.forEach((source,i)=>{mesh.getMatrixAt(source,matrix);chunk.setMatrixAt(i,matrix);if(mesh.instanceColor){mesh.getColorAt(source,color);chunk.setColorAt(i,color);}});
   chunk.instanceMatrix.needsUpdate=true;if(chunk.instanceColor)chunk.instanceColor.needsUpdate=true;chunk.computeBoundingSphere();chunk.computeBoundingBox();group.add(chunk);
  }
  const at=parent.children.indexOf(mesh);parent.remove(mesh);parent.add(group);parent.children.splice(parent.children.indexOf(group),1);parent.children.splice(at,0,group);
  // Instance attributes are replaced; shared geometry/materials stay alive.
  mesh.dispose();
 }
}
