import * as THREE from 'three';

/** Close pores remain visible; distant transmission requires light behind the fabric. */
export function fabricMaterial(color: string, translucent: boolean, surface: 'wall' | 'roof' = 'wall', transmissionStrength=1): THREE.MeshStandardMaterial {
  const strength=Math.max(0,Math.min(1,transmissionStrength));
  const material = new THREE.MeshStandardMaterial({
    color, roughness: 0.98, metalness: 0, transparent: translucent&&strength>0, depthWrite: !translucent||strength===0,
  });
  if (!translucent||strength===0) return material;
  material.customProgramCacheKey = () => `backlit-fabric-v6-${surface}`;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uFabricNear: { value: 0.3 }, uFabricFar: { value: surface === 'roof' ? 0.5 : 0.9 },
      uFabricPeriod: { value: 0.003 }, uFabricOpenArea: { value: 0.01 },
      uFabricTransmissionStrength:{value:strength},
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
      uniform float uFabricTransmissionStrength;
    `).replace('#include <lights_pars_begin>', `
      #include <lights_pars_begin>
      vec2 fabricLightSides(vec3 normal, IncidentLight light) {
        float facing = dot(normal, light.direction);
        float brightness = dot(light.color, vec3(0.2126, 0.7152, 0.0722));
        return vec2(max(facing, 0.0), max(-facing, 0.0)) * brightness;
      }
      ${surface === 'roof' ? `
      vec3 fabricScatteredSource(vec3 normal, IncidentLight light) {
        float angle = acos(clamp(dot(normalize(-vViewPosition), light.direction), -1.0, 1.0));
        float spot = exp(-pow(angle / 0.055, 2.0));
        return light.color * max(-dot(normal, light.direction), 0.0) * spot * 1.8;
      }
      ` : ''}
    `).replace('#include <alphamap_fragment>', `
      #include <alphamap_fragment>
      vec3 fabricToEye = cameraPosition - vFabricPosition;
      float fabricDistance = length(fabricToEye);
      vec3 fabricNormal = normalize(cross(dFdx(vFabricPosition), dFdy(vFabricPosition)));
      if (dot(fabricNormal, fabricToEye) < 0.0) fabricNormal = -fabricNormal;
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
      // Light uniforms use view space. Orient the surface toward the observer so
      // this works from either side of walls, and above or below the roof.
      vec3 fabricViewNormal = normalize(mat3(viewMatrix) * fabricNormal);
      vec2 fabricLighting = vec2(0.0);
      ${surface === 'roof' ? 'vec3 fabricGlow = vec3(0.0);' : ''}
      IncidentLight fabricLight;
      #if NUM_DIR_LIGHTS > 0
        #pragma unroll_loop_start
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
          getDirectionalLightInfo(directionalLights[i], fabricLight);
          fabricLighting += fabricLightSides(fabricViewNormal, fabricLight);
          ${surface === 'roof' ? 'fabricGlow += fabricScatteredSource(fabricViewNormal, fabricLight);' : ''}
        }
        #pragma unroll_loop_end
      #endif
      #if NUM_POINT_LIGHTS > 0
        #pragma unroll_loop_start
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
          getPointLightInfo(pointLights[i], -vViewPosition, fabricLight);
          fabricLighting += fabricLightSides(fabricViewNormal, fabricLight);
          ${surface === 'roof' ? 'fabricGlow += fabricScatteredSource(fabricViewNormal, fabricLight);' : ''}
        }
        #pragma unroll_loop_end
      #endif
      #if NUM_SPOT_LIGHTS > 0
        #pragma unroll_loop_start
        for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
          getSpotLightInfo(spotLights[i], -vViewPosition, fabricLight);
          fabricLighting += fabricLightSides(fabricViewNormal, fabricLight);
          ${surface === 'roof' ? 'fabricGlow += fabricScatteredSource(fabricViewNormal, fabricLight);' : ''}
        }
        #pragma unroll_loop_end
      #endif
      float fabricBacklight = smoothstep(0.5, 0.95,
        fabricLighting.y / max(fabricLighting.x + fabricLighting.y, 0.0001))
        * smoothstep(0.002, 0.05, fabricLighting.y);
      ${surface === 'roof' ? `
      // World-aligned, antialiased pores give the light spot a fine dotted weave.
      vec2 fabricGlowCoordinates = fabricCoordinates * 0.5;
      vec2 fabricGlowFootprint = fwidth(fabricGlowCoordinates);
      float fabricGlowAA = max(length(fabricGlowFootprint) * 0.5, 0.0001);
      float fabricGlowPore = 1.0 - smoothstep(0.18 - fabricGlowAA, 0.18 + fabricGlowAA,
        length(fract(fabricGlowCoordinates) - 0.5));
      float fabricGlowResolved = 1.0 - smoothstep(0.4, 1.0, max(fabricGlowFootprint.x, fabricGlowFootprint.y));
      float fabricGlowDots = mix(0.1018, fabricGlowPore, fabricGlowResolved);
      diffuseColor.a *= 1.0 - uFabricTransmissionStrength * fabricClose * fabricTransmission;
      ` : 'diffuseColor.a *= 1.0 - uFabricTransmissionStrength * mix(uFabricOpenArea * fabricBacklight, fabricTransmission, fabricClose);'}
    `).replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      ${surface === 'roof' ? 'totalEmissiveRadiance += uFabricTransmissionStrength * fabricGlow * fabricGlowDots * fabricBacklight * (1.0 - fabricClose);' : ''}
    `);
  };
  return material;
}
