export interface Updatable {
  update(deltaMs: number): void;
}

/**
 * Simple rAF-based game loop.  Each frame we calculate the elapsed time
 * (delta in milliseconds, capped to avoid huge jumps when the tab was
 * in the background) and call `update(deltaMs)` on every registered
 * subsystem.
 */
export default class GameLoop {
  private lastTime = performance.now();
  private running = false;
  private readonly updatables: Updatable[] = [];

  /** Register a subsystem that implements `update(deltaMs)` */
  add(u: Updatable): void {
    this.updatables.push(u);
  }

  /** Start the loop (idempotent) */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  /** Stop the loop – useful for cleanup / tests */
  stop(): void {
    this.running = false;
  }

  private tick = () => {
    if (!this.running) return;

    const now = performance.now();
    let delta = now - this.lastTime;
    this.lastTime = now;

    // Cap to 200 ms to avoid giant leaps after tab was hidden.
    if (delta > 200) delta = 200;

    for (const u of this.updatables) {
      u.update(delta);
    }

    requestAnimationFrame(this.tick);
  };
} 