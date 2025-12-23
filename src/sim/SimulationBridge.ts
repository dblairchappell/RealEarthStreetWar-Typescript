/**
 * SimulationBridge - Communication Layer Between Main Thread and Web Worker
 * 
 * This class acts as a bridge/communication layer between the main thread (UI/rendering)
 * and a Web Worker (game simulation). Its primary purpose is to enable running the game
 * simulation off the main thread, keeping the UI responsive even with many NPCs.
 * 
 * Key Responsibilities:
 * 
 * 1. Worker Management:
 *    - Starts/stops the Web Worker that runs the simulation
 *    - Supports two modes:
 *      * Worker mode: Simulation runs in a separate thread (better performance)
 *      * Main thread mode: Simulation runs on main thread (fallback)
 * 
 * 2. Data Synchronization:
 *    - Retrieves NPC positions from the worker
 *    - Uses two communication methods:
 *      * SharedArrayBuffer (preferred): Zero-copy, lock-free data sharing using Atomics
 *      * postMessage (fallback): Slower but works when SharedArrayBuffer isn't available
 * 
 * 3. Player Position Tracking:
 *    - Maintains the latest player position (lastPlayer)
 *    - Main thread remains authoritative for player (worker doesn't control player)
 * 
 * 4. Command Queue:
 *    - Allows main thread to send commands to worker (e.g., spawn NPCs)
 *    - Uses a ring buffer with atomic operations for thread-safe communication
 * 
 * Architecture:
 * 
 * Main Thread                    Web Worker
 *      │                              │
 *      │─── startInWorker() ────────>│
 *      │   (sends SharedArrayBuffer) │
 *      │                              │
 *      │<─── NPC positions ───────────│
 *      │   (via SharedArrayBuffer)    │
 *      │                              │
 *      │─── enqueueCommand() ────────>│
 *      │   (spawn NPC, etc.)          │
 * 
 * Benefits:
 * - Performance: Keeps simulation off main thread, preventing UI lag
 * - Scalability: Can handle thousands of NPCs without blocking rendering
 * - Flexibility: Gracefully falls back to main-thread mode if needed
 */

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
  cmdBuffer?: SharedArrayBuffer;
  cmdCapacity?: number;
  cmdWords?: number;
}

class SimulationBridge {
  /** Latest authoritative player snapshot (written by worker or main thread) */
  public lastPlayer: PlayerSnapshot = { lng: 0, lat: 0, rot: 0 };

  /** Latest snapshot of NPC positions coming from the worker */
  private latestNpcSnapshot: Float32Array | null = null;
  private sharedCtrl: Int32Array | null = null;
  private sharedData: Float32Array | null = null;
  // Command ring buffer (int32) – simple single-producer single-consumer queue
  private cmdCtrl: Int32Array | null = null; // [head, tail]
  private cmdData: Int32Array | null = null;
  private CMD_CAPACITY = 256; // commands
  private CMD_WORDS = 4; // ints per command
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
    const workerUrl = new URL('./sim.worker.ts', import.meta.url);
    // During development, append a timestamp to bust the browser cache so that
    // a regular page refresh always loads the newest version of the worker.
    if ((import.meta as any).env?.DEV) {
      workerUrl.search += (workerUrl.search ? '&' : '?') + `t=${Date.now()}`;
    }
    this.worker = new Worker(workerUrl, {
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

    // Command buffer allocation (separate SAB)
    let cmdBuffer: SharedArrayBuffer | undefined;
    if (typeof SharedArrayBuffer !== 'undefined') {
      const HEADER_INTS = 2; // head, tail
      const TOTAL_CMD_INTS = HEADER_INTS + this.CMD_CAPACITY * this.CMD_WORDS;
      cmdBuffer = new SharedArrayBuffer(TOTAL_CMD_INTS * Int32Array.BYTES_PER_ELEMENT);
      this.cmdCtrl = new Int32Array(cmdBuffer, 0, HEADER_INTS);
      this.cmdData = new Int32Array(cmdBuffer, HEADER_INTS * Int32Array.BYTES_PER_ELEMENT);
    }

    const msg: WorkerInitMessage = {
      type: 'init',
      npcCount,
      player,
      sharedBuffer,
      floatsPerSnap,
      cmdBuffer,
      cmdCapacity: this.CMD_CAPACITY,
      cmdWords: this.CMD_WORDS,
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
      
      // Create a COPY of the subarray, not a view. This is critical to prevent a race condition.
      const view = this.sharedData.subarray(index * this.floatsPerSnap, (index + 1) * this.floatsPerSnap);
      return new Float32Array(view);
    }
    // Fallback for when SharedArrayBuffer is not used
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

  /** Enqueue a command for the worker. Returns false if the queue is full. */
  enqueueCommand(type: number, a = 0, b = 0, c = 0): boolean {
    if (!this.cmdCtrl || !this.cmdData) return false;
    const head = Atomics.load(this.cmdCtrl, 0);
    const tail = Atomics.load(this.cmdCtrl, 1);
    const nextTail = (tail + 1) % this.CMD_CAPACITY;
    if (nextTail === head) {
      console.warn('Command queue full');
      return false;
    }
    const base = (tail * this.CMD_WORDS);
    this.cmdData[base] = type;
    this.cmdData[base + 1] = a;
    this.cmdData[base + 2] = b;
    this.cmdData[base + 3] = c;
    Atomics.store(this.cmdCtrl, 1, nextTail);
    Atomics.notify(this.cmdCtrl, 1);
    return true;
  }
}

export const bridge = new SimulationBridge(); 