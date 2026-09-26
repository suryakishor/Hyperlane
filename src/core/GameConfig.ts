/**
 * Centralised tuning values for Hyperlane.
 *
 * Gameplay balance lives here so that systems never hard-code magic numbers.
 * Values are expressed in metres and seconds.
 */
export const LANE_COUNT = 3;
export const LANE_WIDTH = 2.7;

/** Lane centres in world space: -LANE_WIDTH, 0, +LANE_WIDTH. */
export const LANE_CENTERS: readonly number[] = [
  -LANE_WIDTH,
  0,
  LANE_WIDTH,
];

export const PLAYER = {
  /** Half extents used for collision (x, y, z). */
  halfWidth: 0.42,
  halfDepth: 0.34,
  standHeight: 1.78,
  slideHeight: 0.82,
  /** Lane change duration in seconds. */
  laneChangeTime: 0.17,
  jumpVelocity: 15.6,
  gravity: -58,
  slideDuration: 0.62,
  /** Grace period so a new slide is not triggered while one is active. */
  slideCooldown: 0.08,
} as const;

export const SPEED = {
  base: 15.5,
  max: 33,
  /** Speed used on the game over slow-motion shot. */
  gameOverFactor: 0.18,
} as const;

export const WORLD = {
  segmentLength: 30,
  /** Total number of live segments (ahead + behind). */
  segmentCount: 14,
  /** Z distance (negative) at which new content is generated. */
  spawnDistance: 390,
  /** Z distance (positive) at which content is recycled. */
  despawnDistance: 26,
  trackHalfWidth: LANE_WIDTH * 1.9,
} as const;

export const SPAWN = {
  /** Run distance (m) at which the opening hazard is placed. */
  firstHazardDistance: 25,
  /** Gap between the opening hazard and the second row. */
  gapAfterIntro: 32,
  /** Metres between pattern rows at difficulty 0 / 1. */
  gapEasy: 46,
  gapHard: 24,
  /** Minimum reaction distance in seconds regardless of difficulty. */
  minReactionTime: 0.82,
} as const;

export const COIN = {
  score: 10,
  /** Spacing inside a coin run. */
  runSpacing: 2.1,
  /** Chance (0-1) that a pattern row also carries a coin run. */
  runChance: 0.72,
  /** Chance (0-1) that an empty lane gets an arcing jump-reward run. */
  arcChance: 0.45,
  radius: 0.42,
  collectPadding: 0.28,
} as const;

export const CAMERA = {
  distance: 7.4,
  height: 3.35,
  lookAhead: 9.5,
  /** Lateral follow smoothing (higher = snappier). */
  followStiffness: 9.5,
  fov: 56,
  fovSpeedBoost: 7,
  /** Camera pulls back / widens on tall narrow (portrait) viewports. */
  portraitFov: 66,
  portraitDistance: 8.6,
  /** Vertical offset applied while jumping. */
  jumpFollow: 0.45,
  gameOverDistance: 6.2,
} as const;

export const DIFFICULTY = {
  /** Distance (m) at which difficulty reaches 1. */
  maxDifficultyDistance: 5200,
  /** Difficulty curve exponent: <1 ramps quickly at first, then flattens. */
  curve: 1.45,
  speedEase: 1.1,
} as const;

export const SCORE = {
  /** Points per metre travelled. */
  perMetre: 1,
  perCoin: COIN.score,
  /** Digits used by the HUD counter. */
  hudDigits: 6,
} as const;

export const USERNAME = {
  maxLength: 16,
  /** Raw input is cut to this many characters before validation. */
  hardMaxLength: 24,
  defaultName: 'Runner',
} as const;

export const AUDIO = {
  masterVolume: 0.55,
  sfxVolume: 0.9,
  musicVolume: 0.32,
  /** Music scheduling lookahead in seconds. */
  scheduleAhead: 0.25,
  /** Length of one 16th note at 128 BPM. */
  stepDuration: 0.1171875,
  /** Steps in the looping bar pattern. */
  stepCount: 32,
} as const;

/**
 * Rendering preset. Hyperlane always runs at high; weaker devices are handled by
 * the device-pixel-ratio cap in `Game.handleResize` rather than a lower preset.
 */
export const QUALITY_PRESETS = {
  high: {
    pixelRatioCap: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    sceneryDensity: 1,
    coinSegments: 14,
    scenerySegments: 9,
    extraLights: true,
    grain: true,
  },
} as const;

export type QualityPreset = (typeof QUALITY_PRESETS)['high'];
