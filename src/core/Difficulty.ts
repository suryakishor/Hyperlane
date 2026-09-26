import { DIFFICULTY, SPEED, SPAWN } from './GameConfig';
import { clamp01, lerp } from '../utils/math';

export interface DifficultyProfile {
  /** 0 = opening run, 1 = full intensity. */
  level: number;
  /** Forward speed in m/s. */
  speed: number;
  /** Distance between obstacle rows in metres. */
  spawnGap: number;
  /** Upper bound for how many lanes a single row may block. */
  maxBlockedLanes: number;
  /** Chance that a row is skipped entirely to create breathing room. */
  restChance: number;
}

/**
 * Pure difficulty curve, free of any game state, so pacing stays tunable in one
 * place.
 */
function difficultyAt(distance: number, level = 0): DifficultyProfile {
  const d = clamp01(distance / DIFFICULTY.maxDifficultyDistance);
  // Power curve: ramps up quickly in the first 400m, then flattens out.
  const ramp = Math.pow(d, DIFFICULTY.curve);
  // `level` shifts the whole curve towards full intensity, so a run level of 0
  // still reaches 1.0 (and therefore SPEED.max) at maxDifficultyDistance.
  const intensity = clamp01(ramp + level * (1 - ramp));

  const speed = lerp(SPEED.base, SPEED.max, Math.pow(intensity, DIFFICULTY.speedEase));
  const spawnGap = lerp(SPAWN.gapEasy, SPAWN.gapHard, intensity);

  return {
    level: intensity,
    speed,
    spawnGap,
    // A row can never block all three lanes (see isRowFair), so the ceiling is
    // two. The early curve only allows a single blocked lane.
    maxBlockedLanes: intensity < 0.28 ? 1 : 2,
    restChance: lerp(0.22, 0.06, intensity),
  };
}

/** Mutable holder used by the running game. */
export class DifficultyTracker {
  private profile: DifficultyProfile = difficultyAt(0, 0);

  get current(): DifficultyProfile {
    return this.profile;
  }

  get speed(): number {
    return this.profile.speed;
  }

  get level(): number {
    return this.profile.level;
  }

  /** `runLevel` lets later runs of the same session start slightly harder. */
  update(distance: number, runLevel = 0): DifficultyProfile {
    this.profile = difficultyAt(distance, runLevel);
    return this.profile;
  }
}
