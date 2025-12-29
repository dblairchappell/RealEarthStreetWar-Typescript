/**
 * GameLoop - Main Game Loop with Fixed Timestep and Render Interpolation
 * 
 * This class implements a sophisticated game loop that combines:
 * 1. Fixed-timestep simulation (60 Hz) for deterministic game logic
 * 2. Variable-delta updates for frame-rate dependent animations
 * 3. Render interpolation for smooth visuals between fixed timesteps
 * 
 * Architecture:
 * 
 * The loop uses an accumulator pattern for fixed-timestep updates:
 * - Accumulates elapsed time each frame
 * - Runs fixed updates in 16.666ms chunks until caught up
 * - Limits steps per frame to prevent "spiral of death"
 * 
 * Render interpolation uses an "alpha" value (0.0 to 1.0) representing
 * how far between fixed timesteps we are, allowing smooth rendering
 * even when simulation runs at discrete intervals.
 * 
 * Update Phases (per frame):
 * 
 * 1. Fixed Updates (deterministic):
 *    - Run multiple times if needed to catch up
 *    - Always exactly 16.666ms per step
 *    - Used for: game logic, physics, ECS systems
 * 
 * 2. Variable Updates (frame-dependent):
 *    - Run once per frame
 *    - Uses actual elapsed time (delta)
 *    - Used for: animations, UI, camera smoothing
 * 
 * 3. Render (interpolated):
 *    - Run once per frame
 *    - Uses alpha for interpolation between fixed steps
 *    - Used for: smooth visual rendering
 * 
 * Example Usage:
 * 
 * ```typescript
 * const loop = new GameLoop();
 * loop.addFixed(gameController);      // Fixed-timestep logic
 * loop.add(mapView);                 // Variable-delta animations
 * loop.addRenderable(mapView);       // Interpolated rendering
 * loop.start();
 * ```
 */

/**
 * Interface for systems that need variable-delta updates.
 * Called once per frame with the actual elapsed time since last frame.
 * 
 * Use for: animations, UI updates, camera smoothing, anything that
 * should scale with frame rate.
 */
export interface Updatable {
  /**
   * Update called with variable delta time.
   * @param deltaMs - Elapsed time in milliseconds since last frame
   */
  update(deltaMs: number): void;
}

/**
 * Interface for systems that need fixed-timestep updates.
 * Called multiple times per frame if needed, always with exactly 16.666ms steps.
 * 
 * Use for: game logic, physics, ECS systems, anything that needs
 * deterministic, frame-rate independent behavior.
 */
export interface FixedUpdatable {
  /**
   * Fixed update called at exactly 60 Hz (16.666ms intervals).
   * May be called multiple times per frame to catch up if falling behind.
   */
  fixedUpdate(): void;
}

/**
 * Interface for systems that render with interpolation.
 * Called once per frame with an alpha value (0.0 to 1.0) representing
 * how far between fixed timesteps we are.
 * 
 * Use for: rendering that needs to be smooth between discrete simulation steps.
 * The alpha value allows interpolation between previous and current positions.
 */
export interface Renderable {
  /**
   * Render called with interpolation alpha.
   * @param alpha - Interpolation factor (0.0 = previous step, 1.0 = current step)
   */
  render(alpha: number): void;
}

/**
 * Main game loop class implementing fixed-timestep simulation with render interpolation.
 * 
 * Uses requestAnimationFrame to drive the loop and maintains three separate
 * update phases: fixed (deterministic), variable (frame-dependent), and render (interpolated).
 */
export default class GameLoop {
  /** Timestamp of last frame (milliseconds) */
  private lastTime = performance.now();
  /** Whether the loop is currently running */
  private running = false;
  
  /** Systems that receive variable-delta updates (animations, UI) */
  private readonly updatables: Updatable[] = [];
  /** Systems that receive fixed-timestep updates (game logic, physics) */
  private readonly fixedUpdatables: FixedUpdatable[] = [];
  /** Systems that render with interpolation (smooth visuals) */
  private readonly renderables: Renderable[] = [];

  /* ───────── Fixed-Timestep Bookkeeping ───────── */
  
  /**
   * Accumulator for fixed-timestep updates.
   * Accumulates elapsed time and is consumed in 16.666ms chunks.
   */
  private accumulator = 0;
  
  /**
   * Fixed timestep duration in milliseconds.
   * 60 Hz = 16.666... milliseconds per step.
   * This ensures deterministic, frame-rate independent simulation.
   */
  public static readonly FIXED_DT = 1000 / 60;
  
  /**
   * Maximum number of fixed steps to run per frame.
   * Prevents "spiral of death" where falling behind causes more work,
   * which causes more falling behind. If we can't catch up in 5 steps,
   * we skip ahead.
   */
  private readonly MAX_STEPS = 5;

  /**
   * CPU usage percentage for the current frame.
   * Calculated as: (work time / frame time) * 100
   * Exposed statically for performance monitoring (e.g., PerfOverlay).
   */
  public static cpuPercent = 0;

  /* ───────── Registration Methods ───────── */
  
  /**
   * Register a system that needs variable-delta updates.
   * Called once per frame with actual elapsed time.
   * 
   * @param u - System implementing Updatable interface
   */
  add(u: Updatable): void {
    this.updatables.push(u);
  }

  /**
   * Register a system that needs fixed-timestep updates.
   * Called at exactly 60 Hz (16.666ms intervals), multiple times per frame if needed.
   * 
   * @param u - System implementing FixedUpdatable interface
   */
  addFixed(u: FixedUpdatable): void {
    this.fixedUpdatables.push(u);
  }

  /**
   * Register a system that renders with interpolation.
   * Called once per frame with alpha value for smooth interpolation.
   * 
   * @param r - System implementing Renderable interface
   */
  addRenderable(r: Renderable): void {
    this.renderables.push(r);
  }

  /**
   * Unregister a variable-delta updatable system.
   * 
   * @param u - System to remove from updates
   */
  remove(u: Updatable): void {
    const idx = this.updatables.indexOf(u);
    if (idx !== -1) {
      this.updatables.splice(idx, 1);
    }
  }

  /* ───────── Loop Control ───────── */
  
  /**
   * Start the game loop.
   * Idempotent - safe to call multiple times.
   * Alias for resume() kept for backward compatibility.
   */
  start(): void {
    this.resume();
  }

  /**
   * Pause the game loop.
   * Stops the loop but preserves all registered systems.
   * Can be resumed later with resume().
   */
  pause(): void {
    this.running = false;
  }

  /**
   * Resume the game loop after a pause.
   * Resets timing and schedules the first frame.
   * Idempotent - safe to call if already running.
   */
  resume(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  /**
   * Stop the game loop.
   * Alias for pause() kept for backward compatibility.
   */
  stop(): void {
    this.pause();
  }

  /**
   * Main game loop tick function.
   * Called by requestAnimationFrame every frame (~60 Hz, but can vary).
   * 
   * Execution order:
   * 1. Measure elapsed time
   * 2. Run fixed-timestep updates (multiple times if needed)
   * 3. Run variable-delta updates (once per frame)
   * 4. Render with interpolation (once per frame)
   * 5. Schedule next frame
   */
  private tick = () => {
    if (!this.running) return;

    /* ---------------- Time Measurement ---------------- */
    
    // Calculate elapsed time since last frame
    const now = performance.now();
    let delta = now - this.lastTime;
    this.lastTime = now;

    /**
     * Cap delta to prevent huge time jumps.
     * This can happen when:
     * - Tab was hidden/backgrounded
     * - Browser throttled the page
     * - System was under heavy load
     * 
     * Capping prevents simulation from trying to catch up all at once,
     * which would cause visible stuttering.
     */
    if (delta > 200) delta = 200;

    /* ---------------- Fixed-Timestep Updates ---------------- */
    
    /**
     * Accumulate elapsed time into accumulator.
     * The accumulator will be consumed in fixed 16.666ms chunks.
     */
    this.accumulator += delta;
    let steps = 0;
    
    /**
     * Run fixed updates until we've caught up with real time.
     * 
     * Example: If 33ms elapsed:
     * - First iteration: accumulator >= 16.666ms, run update, accumulator = 16.334ms
     * - Second iteration: accumulator >= 16.666ms? No, exit loop
     * 
     * This ensures simulation always runs at exactly 60 Hz, regardless of
     * actual frame rate. If frame rate is higher, we might skip some frames.
     * If lower, we catch up by running multiple steps.
     */
    while (this.accumulator >= GameLoop.FIXED_DT && steps < this.MAX_STEPS) {
      // Run all fixed-timestep systems
      for (const f of this.fixedUpdatables) {
        f.fixedUpdate();
      }
      // Consume one timestep from accumulator
      this.accumulator -= GameLoop.FIXED_DT;
      steps++;
    }

    /* ---------------- Variable-Delta Updates ---------------- */
    
    /**
     * Measure work time for CPU usage calculation.
     * Start timing when we enter the "heavy work" section.
     */
    const workStart = performance.now();
    
    /**
     * Run variable-delta updates once per frame.
     * These systems receive the actual elapsed time (delta) and can
     * scale their behavior accordingly.
     * 
     * Uses spread operator [...this.updatables] to create a copy,
     * preventing issues if a system modifies the array during iteration.
     */
    for (const u of [...this.updatables]) {
      u.update(delta);
    }

    /* ---------------- Render Interpolation ---------------- */
    
    /**
     * Calculate interpolation alpha value.
     * 
     * Alpha represents how far between fixed timesteps we are:
     * - alpha = 0.0: At the previous fixed step
     * - alpha = 1.0: At the current fixed step
     * - alpha = 0.5: Halfway between steps
     * 
     * This allows renderers to interpolate positions smoothly even
     * when simulation runs at discrete 16.666ms intervals.
     * 
     * Example: If accumulator = 8ms remaining:
     *   alpha = 8 / 16.666 = 0.48
     *   Renderer can interpolate 48% of the way from previous to current position
     */
    const alpha = this.accumulator / GameLoop.FIXED_DT;
    
    /**
     * Render all renderable systems with interpolation.
     * Each system receives the alpha value and can use it to smooth
     * visual updates between fixed simulation steps.
     */
    for (const r of this.renderables) {
      r.render(alpha);
    }

    /* ---------------- Performance Monitoring ---------------- */
    
    /**
     * Calculate CPU usage percentage for this frame.
     * 
     * Formula: (work time / frame time) * 100
     * 
     * This measures how much of the frame budget was spent in game logic.
     * If consistently > 80%, the game is CPU-bound and may need optimization.
     * 
     * Capped at 100% to handle edge cases where work time exceeds frame time.
     */
    const workTime = performance.now() - workStart;
    GameLoop.cpuPercent = delta > 0 ? Math.min(100, (workTime / delta) * 100) : 0;

    /**
     * Schedule the next frame.
     * requestAnimationFrame will call tick() again when the browser is ready
     * to render the next frame (typically ~60 times per second).
     */
    requestAnimationFrame(this.tick);
  };
} 