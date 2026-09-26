/**
 * Deterministic pseudo random number generator (mulberry32).
 *
 * Runs use a random seed by default; passing an explicit seed reproduces a
 * world exactly, which is what a bug report needs to be actionable.
 */
export class Rng {
  private state: number;

  readonly seed: number;

  constructor(seed: number = randomSeed()) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max <= min) {
      return min;
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Rng.pick called with an empty array');
    }
    const index = Math.min(items.length - 1, Math.floor(this.next() * items.length));
    // Safe: index is clamped to the array bounds.
    return items[index] as T;
  }

  /** Fisher-Yates in place; returns the same array for chaining. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = items[i] as T;
      items[i] = items[j] as T;
      items[j] = a;
    }
    return items;
  }

  reset(): void {
    this.state = this.seed;
  }
}

/** A non-deterministic 32 bit seed. */
export function randomSeed(): number {
  const cryptoRef: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoRef?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoRef.getRandomValues(buf);
    return (buf[0] ?? 1) >>> 0;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

/** Stable hash used for per-index deterministic decoration. */
export function hashToUnit(seed: number, index: number): number {
  let t = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}
