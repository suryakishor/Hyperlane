export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 * `stiffness` is roughly "how many e-foldings per second".
 */
export function damp(current: number, target: number, stiffness: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-stiffness * dt));
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) {
    return target;
  }
  return current + Math.sign(diff) * maxDelta;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

/** 1234 -> "001234" */
export function formatScore(value: number, digits = 6): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return String(safe).padStart(digits, '0').slice(-digits);
}

export function formatMetres(value: number): string {
  return `${Math.max(0, Math.floor(value))} m`;
}

/** km/h readout for the HUD (game units are metres and seconds). */
export function toKmh(metresPerSecond: number): number {
  return Math.round(metresPerSecond * 3.6);
}
