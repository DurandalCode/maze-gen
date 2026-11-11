import * as THREE from 'three';
import { VISUAL_V1 } from './visual-profile';
const worldVertex = `
  varying vec3 vSurfaceWorld;
`;
const assignWorld = `
  vec4 surfaceLocal=vec4(transformed,1.0);
  #ifdef USE_INSTANCING
    surfaceLocal=instanceMatrix*surfaceLocal;
  #endif
  vSurfaceWorld=(modelMatrix*surfaceLocal).xyz;
`;
export function fabricMaterial(
  color: string,
  translucent: boolean,
  roof = false,
): THREE.MeshStandardMaterial {
  const settings = VISUAL_V1.fabric;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: settings.roughness,
    metalness: 0,
    transparent: translucent,
    depthWrite: !translucent,
  });
  material.name = roof ? 'roof-fabric' : 'wall-fabric';
  material.customProgramCacheKey = () => `reboot-fabric-v1/${roof}/${translucent}`;
  if (!translucent) return material;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uNear: { value: settings.closeNearM },
      uFar: { value: roof ? settings.roofCloseFarM : settings.wallCloseFarM },
      uPeriod: { value: settings.porePeriodM },
      uOpen: { value: settings.openArea },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${worldVertex}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${assignWorld}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      varying vec3 vSurfaceWorld;
      uniform float uNear,uFar,uPeriod,uOpen;
      float wovenPore(vec2 coordinate){
        vec2 cell=coordinate/uPeriod,footprint=max(fwidth(cell),vec2(.0001));
        vec2 pore=1.0-smoothstep(vec2(sqrt(uOpen)*.5)-footprint*.5,vec2(sqrt(uOpen)*.5)+footprint*.5,abs(fract(cell)-.5));
        float resolved=1.0-smoothstep(.35,1.0,max(footprint.x,footprint.y));
        return mix(uOpen,pore.x*pore.y,resolved);
      }
    `,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
      vec3 toEye=cameraPosition-vSurfaceWorld;
      float viewDistance=max(length(toEye),.0001);
      vec3 normalWorld=normalize(cross(dFdx(vSurfaceWorld),dFdy(vSurfaceWorld)));
      if(dot(normalWorld,toEye)<0.0)normalWorld=-normalWorld;
      vec3 weights=pow(abs(normalWorld),vec3(8.0));weights/=max(.0001,weights.x+weights.y+weights.z);
      float pore=dot(weights,vec3(wovenPore(vSurfaceWorld.zy),wovenPore(vSurfaceWorld.xz),wovenPore(vSurfaceWorld.xy)));
      float nearView=(1.0-smoothstep(uNear,uFar,viewDistance))*smoothstep(.35,.9,abs(dot(normalWorld,toEye/viewDistance)));
      vec3 normalView=normalize(mat3(viewMatrix)*normalWorld);
      float frontLight=0.0,backLight=0.0,glow=0.0;
      #if NUM_DIR_LIGHTS > 0
        #pragma unroll_loop_start
        for(int i=0;i<NUM_DIR_LIGHTS;i++){
          float facing=dot(normalView,directionalLights[i].direction);
          float brightness=dot(directionalLights[i].color,vec3(.2126,.7152,.0722));
          frontLight+=max(facing,0.0)*brightness;
          backLight+=max(-facing,0.0)*brightness;
          float angle=acos(clamp(dot(normalize(-vViewPosition),directionalLights[i].direction),-1.0,1.0));
          glow+=brightness*max(-facing,0.0)*exp(-pow(angle/.055,2.0));
        }
        #pragma unroll_loop_end
      #endif
      float backlit=smoothstep(.5,.95,backLight/max(.0001,frontLight+backLight))*smoothstep(.002,.05,backLight);
      diffuseColor.a*=1.0-${roof ? 'nearView*pore' : 'mix(uOpen*backlit,pore,nearView)'};
    `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${roof ? 'totalEmissiveRadiance+=vec3(1.0,.89,.68)*glow*1.8*backlit*(1.0-nearView)*mix(.1018,pore,1.0-smoothstep(.4,1.0,max(fwidth(vSurfaceWorld.x/uPeriod),fwidth(vSurfaceWorld.z/uPeriod))));' : ''}`,
      );
  };
  return material;
}
export function woodMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: '#b39772', roughness: 0.82 });
  material.name = 'timber-grain-v1';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrainUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrainUv=uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrainUv;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float grain=sin(vGrainUv.x*310.0+sin(vGrainUv.y*13.0)*2.0)*.06+sin(vGrainUv.x*71.0+vGrainUv.y*2.0)*.035;
      diffuseColor.rgb*=.92+grain*(1.0-smoothstep(.5,3.14,abs(fwidth(vGrainUv.x*310.0))));
    `,
      );
  };
  material.customProgramCacheKey = () => 'reboot-wood-v1';
  return material;
}
export function groundMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: '#78845c', roughness: 1 });
  material.name = 'grass-ground-v1';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${worldVertex}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${assignWorld}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfaceWorld;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float blades=sin(vSurfaceWorld.x*151.0+sin(vSurfaceWorld.z*73.0))*sin(vSurfaceWorld.z*107.0);
      float patches=sin(vSurfaceWorld.x*.71+sin(vSurfaceWorld.z*.43))*sin(vSurfaceWorld.z*.51);
      float resolvedGrass=1.0-smoothstep(.5,3.14,max(fwidth(vSurfaceWorld.x*151.0),fwidth(vSurfaceWorld.z*107.0)));
      diffuseColor.rgb*=.9+.065*blades*resolvedGrass+.09*patches;
    `,
      );
  };
  material.customProgramCacheKey = () => 'reboot-ground-v1';
  return material;
}
