import { LANE_CENTERS, LANE_COUNT, PLAYER } from '../core/GameConfig';
import { clamp01, moveToward } from '../utils/math';

export type PlayerActionState = 'run' | 'air' | 'slide' | 'crash';

export interface ColliderBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Pure player simulation - no Three.js, no DOM.
 *
 * The player never leaves the three lanes; lateral movement is a timed
 * transition between lane centres, which keeps collisions predictable and the
 * geometry readable.
 */
export class Player {
  private laneIndexValue = 1;
  private laneFrom = LANE_CENTERS[1] ?? 0;
  private laneTo = this.laneFrom;
  private laneProgress = 1;
  private queuedDirection: -1 | 0 | 1 = 0;

  private heightValue = 0;
  private verticalVelocity = 0;
  private slideTimeLeft = 0;
  private slideCooldown = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private crashed = false;
  private steeringLean = 0;

  /** Cached read-only view handed to collision detection. */
  private readonly colliderBox: ColliderBox = {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
  };

  reset(): void {
    this.laneIndexValue = 1;
    this.laneFrom = LANE_CENTERS[1] ?? 0;
    this.laneTo = this.laneFrom;
    this.laneProgress = 1;
    this.queuedDirection = 0;
    this.heightValue = 0;
    this.verticalVelocity = 0;
    this.slideTimeLeft = 0;
    this.slideCooldown = 0;
    this.jumpBuffer = 0;
    this.slideBuffer = 0;
    this.crashed = false;
    this.steeringLean = 0;
  }

  // ------------------------------------------------------------- accessors

  get lane(): number {
    return this.laneIndexValue;
  }

  get x(): number {
    return this.laneFrom + (this.laneTo - this.laneFrom) * this.easedLaneProgress();
  }

  get y(): number {
    return this.heightValue;
  }

  get isJumping(): boolean {
    return !this.crashed && this.heightValue > 0.001;
  }

  get isSliding(): boolean {
    return !this.crashed && this.slideTimeLeft > 0;
  }

  get isCrashed(): boolean {
    return this.crashed;
  }

  get lean(): number {
    return this.steeringLean;
  }

  get state(): PlayerActionState {
    if (this.crashed) {
      return 'crash';
    }
    if (this.isSliding) {
      return 'slide';
    }
    return this.isJumping ? 'air' : 'run';
  }

  /** Height of the player's head, used for gate collisions. */
  get height(): number {
    return this.isSliding ? PLAYER.slideHeight : PLAYER.standHeight;
  }

  get collider(): Readonly<ColliderBox> {
    const box = this.colliderBox;
    box.minX = this.x - PLAYER.halfWidth;
    box.maxX = this.x + PLAYER.halfWidth;
    box.minY = this.heightValue;
    box.maxY = this.heightValue + this.height;
    box.minZ = -PLAYER.halfDepth;
    box.maxZ = PLAYER.halfDepth;
    return box;
  }

  // ---------------------------------------------------------------- intents

  /** Queues a lane change; the direction is relative to the current lane. */
  moveLane(direction: -1 | 1): boolean {
    if (this.crashed) {
      return false;
    }
    if (this.laneProgress < 1) {
      // A transition is already running: remember the intent so fast double
      // taps chain into the neighbouring lane instead of being swallowed.
      this.queuedDirection = direction;
      return true;
    }
    return this.beginLaneChange(direction);
  }

  jump(): boolean {
    if (this.crashed) {
      return false;
    }
    this.jumpBuffer = 0.16;
    if (this.isGrounded) {
      return this.beginJump();
    }
    return false;
  }

  slide(): boolean {
    if (this.crashed) {
      return false;
    }
    this.slideBuffer = 0.16;
    if (this.isGrounded) {
      return this.beginSlide();
    }
    // Sliding in the air is a fast-fall that lands into a slide.
    this.verticalVelocity = Math.min(this.verticalVelocity, -26);
    return true;
  }

  crash(): void {
    this.crashed = true;
    this.slideTimeLeft = 0;
  }

  // ----------------------------------------------------------------- update

  update(delta: number): void {
    if (delta <= 0) {
      return;
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - delta);
    this.slideBuffer = Math.max(0, this.slideBuffer - delta);
    this.slideCooldown = Math.max(0, this.slideCooldown - delta);

    this.updateLane(delta);
    this.updateVertical(delta);
    this.updateSlide(delta);
  }

  private get isGrounded(): boolean {
    return this.heightValue <= 0.0005 && this.verticalVelocity <= 0;
  }

  private easedLaneProgress(): number {
    // Smoothstep keeps lateral motion from snapping between lanes.
    const t = clamp01(this.laneProgress);
    return t * t * (3 - 2 * t);
  }

  private beginLaneChange(direction: -1 | 1): boolean {
    const next = this.laneIndexValue + direction;
    if (next < 0 || next >= LANE_COUNT) {
      return false;
    }
    this.laneIndexValue = next;
    this.laneFrom = this.x;
    this.laneTo = LANE_CENTERS[next] ?? this.laneFrom;
    this.laneProgress = 0;
    return true;
  }

  private updateLane(delta: number): void {
    if (this.laneProgress < 1) {
      this.laneProgress = Math.min(1, this.laneProgress + delta / PLAYER.laneChangeTime);
      this.steeringLean = moveToward(this.steeringLean, (this.laneTo - this.laneFrom) * 0.16, delta * 2.4);
      if (this.laneProgress >= 1) {
        this.laneFrom = this.laneTo;
        if (this.queuedDirection !== 0 && this.beginLaneChange(this.queuedDirection)) {
          // Queued intent consumed; failure means we are at the outer lane.
        }
        this.queuedDirection = 0;
      }
      return;
    }
    this.laneFrom = this.laneTo;
    this.steeringLean = moveToward(this.steeringLean, 0, delta * 3);
  }

  private updateVertical(delta: number): void {
    if (this.isGrounded) {
      this.heightValue = 0;
      this.verticalVelocity = 0;
      return;
    }
    this.verticalVelocity += PLAYER.gravity * delta;
    this.heightValue += this.verticalVelocity * delta;
    if (this.heightValue <= 0) {
      this.heightValue = 0;
      this.verticalVelocity = 0;
      if (this.jumpBuffer > 0) {
        this.beginJump();
      } else if (this.slideBuffer > 0 && this.slideCooldown <= 0) {
        this.beginSlide();
      }
    }
  }

  private updateSlide(delta: number): void {
    if (this.slideTimeLeft > 0) {
      this.slideTimeLeft = Math.max(0, this.slideTimeLeft - delta);
    }
  }

  private beginJump(): boolean {
    if (this.slideTimeLeft > 0) {
      return false;
    }
    this.heightValue = Math.max(this.heightValue, 0.0001);
    this.verticalVelocity = PLAYER.jumpVelocity;
    this.jumpBuffer = 0;
    return true;
  }

  private beginSlide(): boolean {
    if (this.slideCooldown > 0) {
      return false;
    }
    this.slideTimeLeft = PLAYER.slideDuration;
    this.slideCooldown = PLAYER.slideDuration + PLAYER.slideCooldown;
    this.slideBuffer = 0;
    return true;
  }
}
