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

  /** Unregister an updatable */
  remove(u: Updatable): void {
    const idx = this.updatables.indexOf(u);
    if (idx !== -1) {
      this.updatables.splice(idx, 1);
    }
  }

  /** Start the loop (idempotent) – kept for backward compatibility */
  start(): void {
    this.resume();
  }

  /** Pause the loop without clearing subscriptions */
  pause(): void {
    this.running = false;
  }

  /** Resume after pause */
  resume(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  /** Stop the loop – alias for pause for backward-compat */
  stop(): void {
    this.pause();
  }

  private tick = () => {
    if (!this.running) return;

    const now = performance.now();
    let delta = now - this.lastTime;
    this.lastTime = now;

    // Cap to 200 ms to avoid giant leaps after tab was hidden.
    if (delta > 200) delta = 200;

    // Iterate over a shallow copy so removals during update are safe.
    for (const u of [...this.updatables]) {
      u.update(delta);
    }

    requestAnimationFrame(this.tick);
  };
} 