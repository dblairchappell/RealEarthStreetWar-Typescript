export interface PlayerSnapshot {
  lng: number;
  lat: number;
  rot: number;
}

interface WorkerInitMessage {
  type: 'init';
  npcCount: number;
  player: PlayerSnapshot;
}

class SimulationBridge {
  /** Latest authoritative player snapshot (written by worker or main thread) */
  public lastPlayer: PlayerSnapshot = { lng: 0, lat: 0, rot: 0 };

  /** Latest snapshot of NPC positions coming from the worker */
  private latestNpcSnapshot: Float32Array | null = null;

  private useWorker = false;
  private worker: Worker | null = null;

  /**
   * Spawns the simulation worker and sends initial world data.
   * When `enable` is false we simply keep running everything on the main thread.
   */
  startInWorker(enable: boolean, npcCount: number, player: PlayerSnapshot): void {
    if (!enable) {
      this.useWorker = false;
      return;
    }
    // Already running – idempotent guard
    if (this.worker) return;

    this.useWorker = true;
    // Path is relative to the source file that calls this method (main.ts in src/)
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (evt: MessageEvent) => {
      const payload = evt.data;
      // For now the worker only posts Float32Array snapshots
      if (payload instanceof Float32Array) {
        this.latestNpcSnapshot = payload;
      } else if (payload && payload.type === 'player') {
        // future: accept authoritative player snapshot
        this.lastPlayer = payload.data as PlayerSnapshot;
      }
    };

    const msg: WorkerInitMessage = {
      type: 'init',
      npcCount,
      player,
    };
    this.worker.postMessage(msg);
  }

  isWorkerEnabled(): boolean {
    return this.useWorker;
  }

  /** Latest NPC snapshot sent by the worker. 3 floats per NPC: lng, lat, rot */
  getLatestNpcSnapshot(): Float32Array | null {
    return this.latestNpcSnapshot;
  }

  /**
   * When running without a worker, allow main-thread systems to keep the
   * bridge updated so that consumers (e.g. NpcLayer) can use a unified path.
   */
  updateFromMainThread(lng: number, lat: number, rot: number): void {
    if (this.useWorker) return; // worker supplies authoritative data
    this.lastPlayer = { lng, lat, rot };
  }
}

export const bridge = new SimulationBridge(); 