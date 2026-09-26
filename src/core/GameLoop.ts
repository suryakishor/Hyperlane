export type FrameCallback = (delta: number, elapsed: number) => void;

/**
 * requestAnimationFrame driver.
 *
 * Delta time is clamped so a stalled tab, a breakpoint or a slow device cannot
 * teleport the simulation; every system is expected to be frame-rate
 * independent, and this guard is the second line of defence.
 */
export class GameLoop {
  private frameHandle: number | null = null;
  private lastTime = 0;
  private elapsed = 0;
  private running = false;

  constructor(
    private readonly callback: FrameCallback,
    private readonly maxDelta = 0.05,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get time(): number {
    return this.elapsed;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastTime = 0;
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) {
      return;
    }
    this.frameHandle = requestAnimationFrame(this.tick);

    // `now` is DOMHighResTimeStamp; the first frame has no previous sample.
    if (this.lastTime === 0) {
      this.lastTime = now;
      return;
    }
    const rawDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const delta = Math.min(Math.max(rawDelta, 0), this.maxDelta);
    this.elapsed += delta;
    this.callback(delta, this.elapsed);
  };
}
