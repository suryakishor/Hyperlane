import { SCORE } from '../core/GameConfig';

/**
 * Authoritative score. Rendering reads from here, it never writes to it.
 *
 * score = floor(distance) * perMetre + coins * perCoin
 */
export class ScoreManager {
  private distance = 0;
  private coins = 0;
  private coinScore = 0;
  private runScore = 0;

  reset(): void {
    this.distance = 0;
    this.coins = 0;
    this.coinScore = 0;
    this.runScore = 0;
  }

  update(distance: number): number {
    this.distance = Math.max(this.distance, distance);
    this.recompute();
    return this.runScore;
  }

  addCoin(): number {
    this.coins += 1;
    this.recompute();
    return this.runScore;
  }

  private recompute(): void {
    this.coinScore = this.coins * SCORE.perCoin;
    this.runScore = Math.floor(this.distance * SCORE.perMetre) + this.coinScore;
  }

  get score(): number {
    return this.runScore;
  }

  get coinCount(): number {
    return this.coins;
  }

  get coinPoints(): number {
    return this.coinScore;
  }

  get distanceMetres(): number {
    return this.distance;
  }
}
