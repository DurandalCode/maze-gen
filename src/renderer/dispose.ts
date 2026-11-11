import * as THREE from 'three';
export function disposeObjects(root: THREE.Object3D): {
  geometries: number;
  materials: number;
  textures: number;
} {
  const instances = new Set<THREE.InstancedMesh>();
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) instances.add(object);
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        materials.add(material);
    if (mesh.customDepthMaterial) materials.add(mesh.customDepthMaterial);
    if (mesh.customDistanceMaterial) materials.add(mesh.customDistanceMaterial);
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  }
  instances.forEach((mesh) => mesh.dispose());
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  root.clear();
  return { geometries: geometries.size, materials: materials.size, textures: textures.size };
}
