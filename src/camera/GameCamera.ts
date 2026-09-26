import * as THREE from 'three';
import { CAMERA } from '../core/GameConfig';
import type { Player } from '../player/Player';
import { clamp01, damp, lerp } from '../utils/math';

/** Nominal length of an impact shake, used to fade it out. */
const SHAKE_DURATION = 0.4;

/**
 * Third person chase camera.
 *
 * The camera never leaves the world origin region - the skyway scrolls past
 * instead - so perspective precision stays constant no matter how far the run
 * has progressed.
 */
export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;

  private targetX = 0;
  private currentX = 0;
  private currentY: number = CAMERA.height;
  private currentZ: number = CAMERA.distance;
  private currentFov: number = CAMERA.fov;
  private shakeTime = 0;
  private shakeStrength = 0;
  private portrait = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, 0.1, 1400);
    this.camera.position.set(0, CAMERA.height, CAMERA.distance);
    this.camera.lookAt(0, 1, -CAMERA.lookAhead);
  }

  /** Called on init and on every resize. */
  setViewport(width: number, height: number): void {
    const aspect = height > 0 ? width / height : 16 / 9;
    this.portrait = aspect < 1;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get fov(): number {
    return this.currentFov;
  }

  reset(): void {
    this.targetX = 0;
    this.currentX = 0;
    this.currentY = CAMERA.height;
    this.currentZ = this.portrait ? CAMERA.portraitDistance : CAMERA.distance;
    this.currentFov = this.baseFov();
    this.shakeTime = 0;
    this.shakeStrength = 0;
    this.apply();
  }

  addShake(strength: number, duration = SHAKE_DURATION): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  follow(player: Player, delta: number, speed: number, crashFactor: number): void {
    const baseDistance = this.portrait ? CAMERA.portraitDistance : CAMERA.distance;

    this.targetX = player.x * 0.62;
    this.currentX = damp(this.currentX, this.targetX, CAMERA.followStiffness, delta);

    const targetY = CAMERA.height + player.y * CAMERA.jumpFollow;
    const targetZ = lerp(baseDistance, CAMERA.gameOverDistance, crashFactor);
    this.currentY = damp(this.currentY, targetY, 6, delta);
    this.currentZ = damp(this.currentZ, targetZ, 3.5, delta);

    const speedT = clamp01((speed - 15) / 20);
    const targetFov = this.baseFov() + speedT * CAMERA.fovSpeedBoost;
    this.currentFov = damp(this.currentFov, targetFov, 4, delta);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.apply(delta);
  }

  dispose(): void {
    this.camera.clear();
  }

  private baseFov(): number {
    return this.portrait ? CAMERA.portraitFov : CAMERA.fov;
  }

  /**
   * Writes the current state to the camera.
   *
   * `delta` is only needed for the impact shake: the shake is a timed effect, so
   * it must advance with real time rather than with the number of calls to this
   * method (a resize would otherwise swallow part of it).
   */
  private apply(delta = 0): void {
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      const decay = this.shakeStrength * (this.shakeTime / SHAKE_DURATION);
      shakeX = Math.sin(this.shakeTime * 91) * decay;
      shakeY = Math.cos(this.shakeTime * 77) * decay * 0.6;
      if (this.shakeTime === 0) {
        this.shakeStrength = 0;
      }
    }

    this.camera.position.set(this.currentX + shakeX, this.currentY + shakeY, this.currentZ);
    this.camera.lookAt(this.currentX * 0.85, 1.05 + this.currentY * 0.04, -CAMERA.lookAhead);
  }
}
