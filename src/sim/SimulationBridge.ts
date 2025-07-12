export interface PlayerSnapshot {
  lng: number;
  lat: number;
  rot: number;
}

interface WorkerInitMessage {
  type: 'init';
  npcCount: number;
  player: PlayerSnapshot;
  sharedBuffer?: SharedArrayBuffer;
  floatsPerSnap?: number;
}

class SimulationBridge {
  /** Latest authoritative player snapshot (written by worker or main thread) */
  public lastPlayer: PlayerSnapshot = { lng: 0, lat: 0, rot: 0 };

  /** Latest snapshot of NPC positions coming from the worker */
  private latestNpcSnapshot: Float32Array | null = null;
  private sharedCtrl: Int32Array | null = null;
  private sharedData: Float32Array | null = null;
  private floatsPerSnap = 0;

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

    // Attempt SharedArrayBuffer path
    let sharedBuffer: SharedArrayBuffer | undefined;
    let floatsPerSnap: number | undefined;
    if (typeof SharedArrayBuffer !== 'undefined') {
      this.floatsPerSnap = npcCount * 3;
      const HEADER_SIZE = Int32Array.BYTES_PER_ELEMENT; // 4 bytes
      const TOTAL_BYTES = HEADER_SIZE + Float32Array.BYTES_PER_ELEMENT * this.floatsPerSnap * 2; // double buffer
      sharedBuffer = new SharedArrayBuffer(TOTAL_BYTES);
      this.sharedCtrl = new Int32Array(sharedBuffer, 0, 1);
      this.sharedData = new Float32Array(sharedBuffer, HEADER_SIZE);
      floatsPerSnap = this.floatsPerSnap;
    }

    const msg: WorkerInitMessage = {
      type: 'init',
      npcCount,
      player,
      sharedBuffer,
      floatsPerSnap,
    };
    // Transfer list empty because SAB isn't transferable
    this.worker.postMessage(msg);
  }

  isWorkerEnabled(): boolean {
    return this.useWorker;
  }

  hasSharedBuffer(): boolean {
    return !!this.sharedData;
  }

  /** Latest NPC snapshot sent by the worker. 3 floats per NPC: lng, lat, rot */
  getLatestNpcSnapshot(): Float32Array | null {
    if (this.sharedCtrl && this.sharedData) {
      const index = Atomics.load(this.sharedCtrl, 0); // 0 or 1
      if (this.floatsPerSnap === 0) return null;
      return this.sharedData.subarray(index * this.floatsPerSnap, (index + 1) * this.floatsPerSnap);
    }
    return this.latestNpcSnapshot;
  }

  /**
   * When running without a worker, allow main-thread systems to keep the
   * bridge updated so that consumers (e.g. NpcLayer) can use a unified path.
   */
  updateFromMainThread(lng: number, lat: number, rot: number): void {
    // Even when the worker is active, it does not manage the player entity.
    // The main thread remains authoritative for the player's pose.
    this.lastPlayer = { lng, lat, rot };
  }
}

export const bridge = new SimulationBridge(); 