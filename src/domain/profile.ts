import type { Environment, PhysicalProfile } from './types';

/** Render dimensions and collision dimensions share this serialized profile. */
export const PHYSICAL_V1: Readonly<PhysicalProfile> = Object.freeze({
  id: 'physical-v1',
  panelThicknessM: 0.006,
  boardWidthM: 0.12,
  boardThicknessM: 0.04,
  postWidthM: 0.12,
  headerDepthM: 0.14,
  wallHeightM: 2.5,
  playerRadiusM: 0.25,
  eyeHeightM: 1.7,
  minClearanceM: 1,
  maxConnectionSpanM: 3,
});
export function defaultEnvironment(): Environment {
  return {
    roof: true,
    translucentFabric: true,
    wallColor: '#181818',
    sun: { day: 15, minutes: 780 },
    forest: { side: 'north', distance: 12, offset: 0 },
  };
}
export const GEOMETRY_EPSILON_M = 1e-6;
export const AREA_EPSILON_M2 = 1e-8;
export const MAX_ARC_SAGITTA_M = 0.005;
export const VERSIONS = Object.freeze({
  geometry: 'geometry-v3-clipper2',
  approximation: 'chord-v1',
  navigation: 'nav-v2-round-offset',
});
