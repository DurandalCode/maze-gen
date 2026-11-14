import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {fabricMaterial} from '../src/renderer/fabric-material';
import {mazeMesh} from '../src/renderer/maze-mesh';
import {generate} from '../src/generators/generate';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {validateConstruction,DEFAULT_CONSTRUCTION} from '../src/core/maze';
const shader=(surface:'wall'|'roof',strength?:number)=>{
 const m=fabricMaterial('#000000',true,surface,strength),s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
 m.onBeforeCompile(s as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);return s;
};
test('fabric strength scales resolved pore alpha and roof glow while missing strength retains previous appearance',()=>{
 for(const surface of ['wall','roof'] as const){const normal=shader(surface),reduced=shader(surface,.25);
  expect(normal.uniforms).toMatchObject({uFabricTransmissionStrength:{value:1}});expect(reduced.uniforms).toMatchObject({uFabricTransmissionStrength:{value:.25}});
  expect(reduced.fragmentShader).toContain('1.0 - uFabricTransmissionStrength *');
  if(surface==='roof')expect(reduced.fragmentShader).toContain('totalEmissiveRadiance += uFabricTransmissionStrength *');
 }
 const opaque=fabricMaterial('#000000',true,'wall',0);expect(opaque.transparent).toBe(false);expect(opaque.depthWrite).toBe(true);
});
test('saved strengths survive grid and bridge JSON and reach every fabric surface',async()=>{
 const grid=generate({columns:3,rows:2,corridorWidth:2,seed:'transmission',algorithm:'prim',extraConnections:0});
 const bridge=deserialize(await Bun.file('examples/bundles/distribution-v2/05-free-bridges.json').text());
 for(const original of [grid,bridge]){
  const maze={...original,roof:true,fabricTransmissionStrength:.25};const restored=deserialize(serialize(maze));expect(restored.fabricTransmissionStrength).toBe(.25);expect(restored.passages).toEqual(maze.passages);
  let count=0;mazeMesh(restored).traverse(o=>{if(!(o instanceof THREE.Mesh))return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial&&m.transparent){const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);if('uFabricTransmissionStrength'in s.uniforms){expect(s.uniforms).toMatchObject({uFabricTransmissionStrength:{value:.25}});count++;}}});expect(count).toBeGreaterThanOrEqual(original.free?4:2);
 }
 expect(deserialize(serialize(grid)).fabricTransmissionStrength).toBeUndefined();
 expect(generate(grid.parameters,{...grid,fabricTransmissionStrength:.25}).fabricTransmissionStrength).toBe(.25);
});
test('construction rejects invalid strengths instead of silently resetting imported settings',()=>{
 for(const strength of [-.1,1.1,NaN,Infinity,null,'0.25'])expect(()=>validateConstruction({...DEFAULT_CONSTRUCTION,fabricTransmissionStrength:strength as number})).toThrow();
});
