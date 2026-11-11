import { PHYSICAL_V1 } from '../domain/profile';

export const VISUAL_V1 = Object.freeze({
  id: 'visual-v1',
  physicalProfile: PHYSICAL_V1,
  camera: { fovDegrees: 76, nearM: 0.05, farM: 1500, eyeHeightM: PHYSICAL_V1.eyeHeightM },
  renderer: {
    colorSpace: 'srgb',
    toneMapping: 'aces-filmic',
    exposure: 1.25,
    antialias: true,
    maxDpr: 2,
  },
  light: {
    sunColor: '#fff4de',
    sunIntensity: 2.1,
    hemisphereSky: '#eff7ff',
    hemisphereGround: '#6d7658',
    hemisphereIntensity: 2.3,
    shadowMapSize: 2048,
    shadow: 'pcf-soft',
  },
  sky: { day: '#c9dce5', night: '#101927' },
  fabric: {
    roughness: 0.98,
    metalness: 0,
    porePeriodM: 0.003,
    openArea: 0.01,
    closeNearM: 0.3,
    wallCloseFarM: 0.9,
    roofCloseFarM: 0.5,
    backlightRequired: true,
  },
  timber: {
    corner: 'two-perpendicular-boards',
    upperRails: 'paired',
    braces: true,
    fasteners: true,
    lowerRails: true,
  },
  environment: { month: 8, north: '-z', east: '+x', forestDepthM: 6 },
});
