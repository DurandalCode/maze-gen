import * as THREE from 'three';

/** Order wall instances from back to front while retaining a single draw call. */
export class TransparentWallSorter {
  private original: Float32Array;
  private order: Uint32Array;
  private depth: Float32Array;
  private previousDirection = new THREE.Vector3(Infinity, Infinity, Infinity);
  private direction = new THREE.Vector3();

  constructor(private mesh: THREE.InstancedMesh) {
    this.original = new Float32Array(mesh.instanceMatrix.array);
    this.order = Uint32Array.from({ length: mesh.count }, (_, i) => i);
    this.depth = new Float32Array(mesh.count);
  }

  update(camera: THREE.Camera): void {
    camera.getWorldDirection(this.direction);
    if (this.direction.distanceToSquared(this.previousDirection) < 0.0001) return;
    this.previousDirection.copy(this.direction);
    for (let i = 0; i < this.mesh.count; i++) {
      const base = i*16;
      this.depth[i] = this.original[base+12]!*this.direction.x + this.original[base+13]!*this.direction.y + this.original[base+14]!*this.direction.z;
    }
    this.order.sort((a, b) => this.depth[b]!-this.depth[a]!);
    const target = this.mesh.instanceMatrix.array;
    for (let i = 0; i < this.order.length; i++) {
      const source = this.order[i]!*16;
      for (let j = 0; j < 16; j++) target[i*16+j] = this.original[source+j]!;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
