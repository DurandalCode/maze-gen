import * as THREE from 'three';

/** 1% light transmission at every distance; individual pores resolve only up close. */
export function fabricMaterial(color: string, translucent: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color, roughness: 0.98, metalness: 0, transparent: translucent, depthWrite: !translucent,
  });
  if (!translucent) return material;
  material.customProgramCacheKey = () => 'light-transmitting-fabric-v2';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uFabricNear: { value: 0.3 }, uFabricFar: { value: 0.9 },
      uFabricPeriod: { value: 0.003 }, uFabricOpenArea: { value: 0.01 },
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      varying vec3 vFabricPosition;
    `).replace('#include <worldpos_vertex>', `
      #include <worldpos_vertex>
      vec4 fabricPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fabricPosition = instanceMatrix * fabricPosition;
      #endif
      vFabricPosition = (modelMatrix * fabricPosition).xyz;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec3 vFabricPosition;
      uniform float uFabricNear;
      uniform float uFabricFar;
      uniform float uFabricPeriod;
      uniform float uFabricOpenArea;
    `).replace('#include <alphamap_fragment>', `
      #include <alphamap_fragment>
      vec3 fabricToEye = cameraPosition - vFabricPosition;
      float fabricDistance = length(fabricToEye);
      vec3 fabricNormal = normalize(cross(dFdx(vFabricPosition), dFdy(vFabricPosition)));
      float fabricFacing = abs(dot(fabricNormal, fabricToEye / max(fabricDistance, 0.0001)));
      float fabricClose = (1.0 - smoothstep(uFabricNear, uFabricFar, fabricDistance))
        * smoothstep(0.35, 0.9, fabricFacing);
      vec2 fabricCoordinates = abs(fabricNormal.y) > 0.8 ? vFabricPosition.xz
        : (abs(fabricNormal.x) > abs(fabricNormal.z) ? vFabricPosition.zy : vFabricPosition.xy);
      fabricCoordinates /= uFabricPeriod;
      vec2 fabricFootprint = max(fwidth(fabricCoordinates), vec2(0.0001));
      float fabricPoreRadius = sqrt(uFabricOpenArea) * 0.5;
      vec2 fabricCell = abs(fract(fabricCoordinates) - 0.5);
      vec2 fabricPore = 1.0 - smoothstep(vec2(fabricPoreRadius) - fabricFootprint * 0.5,
        vec2(fabricPoreRadius) + fabricFootprint * 0.5, fabricCell);
      float fabricResolved = 1.0 - smoothstep(0.35, 1.0, max(fabricFootprint.x, fabricFootprint.y));
      float fabricTransmission = mix(uFabricOpenArea, fabricPore.x * fabricPore.y, fabricResolved);
      diffuseColor.a *= 1.0 - mix(uFabricOpenArea, fabricTransmission, fabricClose);
    `);
  };
  return material;
}
