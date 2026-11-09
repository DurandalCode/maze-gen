export interface StickVector { x: number; y: number }
export const neutralStick = (): StickVector => ({ x: 0, y: 0 });

/** Radial deadzone prevents drift while preserving proportional control. */
export function stickVector(vector: StickVector, deadzone = 0.12): StickVector {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= deadzone) return neutralStick();
  const magnitude = (Math.min(1, length) - deadzone) / (1 - deadzone);
  return { x: vector.x / length * magnitude, y: vector.y / length * magnitude };
}

export function applyTouchLook(player: { yaw: number; pitch: number }, vector: StickVector, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0 || dt >= 0.25) return;
  player.yaw -= vector.x * 2.2 * dt;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch + vector.y * 1.7 * dt));
}

export function touchControlsAvailable(): boolean {
  return typeof window !== 'undefined' && (
    !!window.MazeAndroid || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches
  );
}
