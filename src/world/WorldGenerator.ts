import { COIN, LANE_COUNT, SPAWN, WORLD } from '../core/GameConfig';
import type { DifficultyProfile } from '../core/Difficulty';
import type { Rng } from '../utils/random';

export type ObstacleKind = 'barrier' | 'pylon' | 'gate' | 'drone';
export type LaneIndex = 0 | 1 | 2;

export interface RowObstacle {
  kind: ObstacleKind;
  lane: LaneIndex;
}

export interface CoinPlacement {
  lane: LaneIndex;
  y: number;
  /** Arcing runs reward a jump, low runs reward a slide. */
  arc: boolean;
}

export interface GeneratedRow {
  z: number;
  obstacles: RowObstacle[];
  coins: CoinPlacement[];
}

/** How a player clears a lane: change lanes, jump over it, or slide under it. */
type SolveAction = 'none' | 'jump' | 'slide';

interface RowSolution {
  lane: LaneIndex;
  action: SolveAction;
  laneChanges: number;
}

/** Obstacles that can only be avoided by changing lane. */
const DODGE_KINDS: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(['pylon', 'drone']);

const ALL_LANES: LaneIndex[] = [0, 1, 2];

/**
 * Fair procedural generation.
 *
 * Rows are described by the distance the player has to run before reaching
 * them, not by the moment they are generated. The generator therefore only has
 * to materialise a row once the spawn horizon reaches it, and the spacing
 * between two hazards is exact regardless of frame rate or forward speed.
 *
 * Two invariants keep every run solvable:
 *  1. A lane holds at most one obstacle, so a single action (jump or slide)
 *     always clears it.
 *  2. At least one lane stays dodge-free, so there is always a way through.
 *
 * Both are checked per row by {@link isRowFair} before the row is accepted.
 */
export class WorldGenerator {
  /** Distance travelled since the start of the run. */
  private travelled = 0;
  /** Run distance at which the next row is reached by the player. */
  private nextRowDistance = SPAWN.firstHazardDistance;
  private rowIndex = 0;
  private previousPattern: PatternName = 'rest';
  private lastBlockedLane: LaneIndex | null = null;

  constructor(
    private readonly rng: Rng,
    /** Z of the furthest point that still needs content. */
    private readonly spawnDistance: number = WORLD.spawnDistance,
  ) {}

  reset(): void {
    this.travelled = 0;
    this.nextRowDistance = SPAWN.firstHazardDistance;
    this.rowIndex = 0;
    this.previousPattern = 'rest';
    this.lastBlockedLane = null;
  }

  get rowsGenerated(): number {
    return this.rowIndex;
  }

  /**
   * Emits every row that has come within the spawn horizon, positioned so it
   * reaches the player exactly at its scheduled run distance.
   *
   * Rows are produced in order from a single RNG stream, which makes a run
   * fully reproducible from its seed.
   */
  update(difficulty: DifficultyProfile, speed: number, travel: number): GeneratedRow[] {
    this.travelled += travel;
    const rows: GeneratedRow[] = [];
    // A single frame can only ever need a few rows; the cap keeps a stalled
    // frame from generating an unbounded burst.
    let budget = 8;
    while (this.nextRowDistance - this.travelled <= this.spawnDistance && budget > 0) {
      budget -= 1;
      const remaining = this.nextRowDistance - this.travelled;
      rows.push(this.generateRow(-remaining, difficulty));
      this.nextRowDistance += this.rowIndex === 1 ? SPAWN.gapAfterIntro : this.gapFor(difficulty, speed);
    }
    return rows;
  }

  /** Metres between the next two rows, never below the reaction-time floor. */
  gapFor(difficulty: DifficultyProfile, speed: number): number {
    const reactionFloor = speed * SPAWN.minReactionTime;
    return Math.max(difficulty.spawnGap, reactionFloor);
  }

  private generateRow(z: number, difficulty: DifficultyProfile): GeneratedRow {
    const pattern = this.choosePattern(difficulty);
    let obstacles = this.buildObstacles(pattern, difficulty);
    // The patterns above are written to be fair by construction; this is the
    // backstop that keeps a future pattern from shipping an impossible row.
    if (obstacles.length > 0 && !isRowFair({ z, obstacles, coins: [] })) {
      obstacles = [];
    }
    this.previousPattern = pattern;
    this.lastBlockedLane = obstacles.length > 0 ? (obstacles[0]?.lane ?? null) : null;
    this.rowIndex += 1;
    return { z, obstacles, coins: this.buildCoins(obstacles, difficulty) };
  }

  private choosePattern(difficulty: DifficultyProfile): PatternName {
    // Opening hazard: a single centre-lane pylon. It is impossible to miss and
    // easy to answer - step into either side lane.
    if (this.rowIndex === 0) {
      return 'onboarding';
    }
    if (this.rng.chance(difficulty.restChance)) {
      return 'rest';
    }
    if (this.previousPattern === 'single' && this.rng.chance(0.55)) {
      return 'single';
    }

    const level = difficulty.level;
    const options: PatternName[] = ['single'];
    if (level > 0.12) {
      options.push('double');
    }
    if (level > 0.06) {
      options.push('jumpRow', 'slideRow');
    }
    if (level > 0.35) {
      options.push('double', 'single');
    }
    return this.rng.pick(options);
  }

  private buildObstacles(pattern: PatternName, difficulty: DifficultyProfile): RowObstacle[] {
    switch (pattern) {
      case 'rest':
      case 'onboarding':
        return pattern === 'onboarding' ? [{ kind: 'pylon', lane: 1 }] : [];
      case 'jumpRow': {
        // Every lane gets a low barrier: one jump clears the whole row.
        const lanes = this.rng.chance(0.72) ? ALL_LANES : this.randomLanes(2);
        return lanes.map((lane) => ({ kind: 'barrier' as const, lane }));
      }
      case 'slideRow': {
        // Every lane gets an overhead gate: one slide clears the whole row.
        const lanes = this.rng.chance(0.72) ? ALL_LANES : this.randomLanes(2);
        return lanes.map((lane) => ({ kind: 'gate' as const, lane }));
      }
      case 'double': {
        const count = Math.min(2, difficulty.maxBlockedLanes);
        const lanes = this.randomLanes(count);
        return lanes.map((lane, i) => ({
          kind: i === 0 ? this.pickDodgeKind() : this.rng.chance(0.35) ? 'barrier' : this.pickDodgeKind(),
          lane,
        }));
      }
      case 'single':
      default: {
        // Avoid repeating the same lane twice in a row (feels unfair when the
        // player just moved away from it).
        let lane = this.rng.int(0, LANE_COUNT - 1) as LaneIndex;
        if (lane === this.lastBlockedLane) {
          lane = (((lane + 1 + this.rng.int(0, 1)) % LANE_COUNT) as LaneIndex) || 1;
        }
        return [{ kind: this.pickDodgeKind(), lane }];
      }
    }
  }

  private pickDodgeKind(): ObstacleKind {
    return this.rng.chance(0.78) ? 'pylon' : 'drone';
  }

  private randomLanes(count: number): LaneIndex[] {
    const lanes = this.rng.shuffle([...ALL_LANES]);
    return lanes.slice(0, Math.max(1, Math.min(LANE_COUNT, count)));
  }

  private buildCoins(obstacles: readonly RowObstacle[], difficulty: DifficultyProfile): CoinPlacement[] {
    if (!this.rng.chance(COIN.runChance)) {
      return [];
    }
    const barrier = obstacles.find((o) => o.kind === 'barrier');
    if (barrier && this.rng.chance(0.8)) {
      // Arc over the barrier: only a jump collects it.
      return [{ lane: barrier.lane, y: 0, arc: true }];
    }
    const gate = obstacles.find((o) => o.kind === 'gate');
    if (gate && this.rng.chance(0.7)) {
      // Low run under the gate: only a slide collects it.
      return [{ lane: gate.lane, y: 0.42, arc: false }];
    }
    const blocked = new Set(obstacles.map((o) => o.lane));
    const free = ALL_LANES.filter((lane) => !blocked.has(lane));
    if (free.length === 0) {
      return [];
    }
    // At higher difficulty coins are placed further from the safe lane.
    const lane = this.rng.pick(free);
    if (this.rng.chance(COIN.arcChance * (1 - difficulty.level * 0.4))) {
      return [{ lane, y: 0, arc: true }];
    }
    return [{ lane, y: 0.95, arc: false }];
  }
}

type PatternName = 'rest' | 'onboarding' | 'single' | 'double' | 'jumpRow' | 'slideRow';

/** Actions required to clear a single obstacle, independent of lane changes. */
function actionFor(kind: ObstacleKind): SolveAction {
  switch (kind) {
    case 'barrier':
      return 'jump';
    case 'gate':
      return 'slide';
    default:
      return 'none';
  }
}

/**
 * Finds the cheapest way through a row from a given lane.
 * Returns null when the row cannot be cleared from there at all.
 */
function solveRow(row: GeneratedRow, fromLane: LaneIndex): RowSolution | null {
  const byLane = new Map<LaneIndex, ObstacleKind>();
  for (const obstacle of row.obstacles) {
    byLane.set(obstacle.lane, obstacle.kind);
  }

  let best: RowSolution | null = null;
  for (const lane of ALL_LANES) {
    const kind = byLane.get(lane);
    if (kind && DODGE_KINDS.has(kind)) {
      continue; // cannot be cleared in place
    }
    const laneChanges = Math.abs(lane - fromLane);
    const candidate: RowSolution = { lane, action: kind ? actionFor(kind) : 'none', laneChanges };
    if (!best || laneChanges < best.laneChanges) {
      best = candidate;
    }
  }
  return best;
}

/** True when the row can be cleared no matter which lane the player is in. */
function isRowFair(row: GeneratedRow): boolean {
  const dodgeLanes = row.obstacles.filter((o) => DODGE_KINDS.has(o.kind)).length;
  if (dodgeLanes >= LANE_COUNT) {
    return false; // all three lanes blocked with no action that saves you
  }
  // One obstacle per lane only - guarantees a single action is enough.
  const lanes = new Set(row.obstacles.map((o) => o.lane));
  if (lanes.size !== row.obstacles.length) {
    return false;
  }
  return ALL_LANES.every((lane) => solveRow(row, lane) !== null);
}
