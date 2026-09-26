import type { ColliderBox } from '../player/Player';
import type { Obstacle } from '../obstacles/ObstacleManager';
import type { CoinRecord } from '../collectibles/CoinManager';
import { COIN } from '../core/GameConfig';

interface CollisionResult {
  /** The first blocking obstacle hit this frame, if any. */
  hit: Obstacle | null;
  /** Coins collected this frame. */
  collected: number;
  /**
   * Indices of collected coins, in descending order.
   * The array is reused between frames - copy anything you need to keep.
   */
  collectedIndices: number[];
  firstCollectedAt: { x: number; y: number; z: number } | null;
}

/** Standard axis aligned overlap test. */
function boxesOverlap(a: ColliderBox, b: ColliderBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/**
 * Swept overlap along Z.
 *
 * Obstacles travel towards the player, so at high speed a single frame can move
 * an obstacle further than its own depth. Testing the span covered this frame
 * (`prevZ` to `z`) prevents tunnelling at 30 fps and on high refresh displays.
 */
function sweptOverlapZ(player: ColliderBox, minZ: number, maxZ: number): boolean {
  return minZ < player.maxZ && maxZ > player.minZ;
}

const scratchBox: ColliderBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

/**
 * Stateless collision resolution between the player, the obstacle field and
 * the collectible field. Collision is only ever evaluated while playing, so a
 * crash cannot fire repeatedly.
 */
export class CollisionManager {
  /** Reused buffer of collected coin indices, in descending order. */
  private readonly indices: number[] = [];

  check(player: ColliderBox, obstacles: readonly Obstacle[], coins: CoinRecord[]): CollisionResult {
    let hit: Obstacle | null = null;
    let collected = 0;
    let firstCollectedAt: { x: number; y: number; z: number } | null = null;
    this.indices.length = 0;

    for (const obstacle of obstacles) {
      const minZ = Math.min(obstacle.prevZ, obstacle.z) - obstacle.halfDepth;
      const maxZ = Math.max(obstacle.prevZ, obstacle.z) + obstacle.halfDepth;
      if (!sweptOverlapZ(player, minZ, maxZ)) {
        continue;
      }
      const box = scratchBox;
      box.minX = obstacle.x - obstacle.halfWidth;
      box.maxX = obstacle.x + obstacle.halfWidth;
      box.minY = obstacle.minY;
      box.maxY = obstacle.maxY;
      box.minZ = minZ;
      box.maxZ = maxZ;
      if (boxesOverlap(player, box)) {
        hit = obstacle;
        break;
      }
    }

    for (let i = coins.length - 1; i >= 0; i -= 1) {
      const coin = coins[i];
      if (!coin) {
        continue;
      }
      const minZ = coin.z - coin.radius;
      const maxZ = coin.z + coin.radius;
      if (!sweptOverlapZ(player, minZ, maxZ)) {
        continue;
      }
      if (
        coin.x + coin.radius + COIN.collectPadding < player.minX ||
        coin.x - coin.radius - COIN.collectPadding > player.maxX
      ) {
        continue;
      }
      const vertical =
        Math.min(player.maxY, coin.y + coin.radius + COIN.collectPadding) -
        Math.max(player.minY, coin.y - coin.radius - COIN.collectPadding);
      if (vertical <= 0) {
        continue;
      }
      collected += 1;
      this.indices.push(i);
      if (firstCollectedAt === null) {
        firstCollectedAt = { x: coin.x, y: coin.y, z: coin.z };
      }
    }

    return { hit, collected, collectedIndices: this.indices, firstCollectedAt };
  }
}
