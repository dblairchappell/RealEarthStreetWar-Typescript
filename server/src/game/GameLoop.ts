/**
 * ServerGameLoop - Fixed-timestep game loop for server
 * 
 * Runs game simulation at 60Hz (16.666ms per step).
 * All game logic runs deterministically on the server.
 */

export interface FixedUpdatable {
  fixedUpdate(): void;
}

/**
 * Server-side game loop running at fixed timestep
 */
export class ServerGameLoop {
  private running = false;
  private fixedUpdatables: FixedUpdatable[] = [];
  
  /** Fixed timestep duration in milliseconds (60Hz) */
  public static readonly FIXED_DT = 1000 / 60; // ~16.666ms
  
  /** Callback to broadcast state to clients */
  private broadcastCallback?: () => void;
  
  /** Last tick timestamp */
  private lastTick = 0;

  /**
   * Add a system that needs fixed-timestep updates
   */
  addFixed(system: FixedUpdatable): void {
    this.fixedUpdatables.push(system);
  }

  /**
   * Set callback for broadcasting state to clients
   */
  setBroadcastCallback(callback: () => void): void {
    this.broadcastCallback = callback;
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.running) {
      console.warn('[ServerGameLoop] Loop already running');
      return;
    }
    
    this.running = true;
    this.lastTick = performance.now();
    console.log(`[ServerGameLoop] Started at ${ServerGameLoop.FIXED_DT}ms timestep (60Hz)`);
    this.tick();
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    this.running = false;
    console.log('[ServerGameLoop] Stopped');
  }

  /**
   * Main tick function
   * Uses setTimeout to maintain consistent 60Hz timing
   */
  private tick = (): void => {
    if (!this.running) return;

    const start = performance.now();
    
    // Run all fixed-timestep systems
    for (const system of this.fixedUpdatables) {
      system.fixedUpdate();
    }
    
    // Broadcast state to clients (if callback is set)
    if (this.broadcastCallback) {
      this.broadcastCallback();
    }
    
    // Calculate elapsed time and schedule next tick
    const elapsed = performance.now() - start;
    const delay = Math.max(0, ServerGameLoop.FIXED_DT - elapsed);
    
    // Use setTimeout to maintain consistent timing
    // In production, you might want to use setImmediate or a more precise timer
    setTimeout(this.tick, delay);
  };

  /**
   * Get current running state
   */
  isRunning(): boolean {
    return this.running;
  }
}

