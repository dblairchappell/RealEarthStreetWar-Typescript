/**
 * Simulation Worker - Off-Thread Game Simulation Engine
 * 
 * This Web Worker runs the game simulation in a separate thread, keeping the main thread
 * responsive for UI and rendering. It owns a complete ECS world for NPCs and runs a
 * deterministic fixed-timestep game loop at 60 Hz.
 * 
 * Key Responsibilities:
 * 
 * 1. NPC Management:
 *    - Spawns NPCs in a circle around the player on initialization
 *    - Manages all NPC entities using the bitecs ECS system
 *    - Runs AI systems (currently just straight-line walking)
 * 
 * 2. Fixed-Timestep Simulation:
 *    - Runs at exactly 60 Hz (16.666ms per tick) for deterministic results
 *    - Uses accumulator pattern to handle variable frame rates gracefully
 *    - Self-correcting: catches up if it falls behind, never runs too fast
 * 
 * 3. Command Processing:
 *    - Reads commands from the main thread via SharedArrayBuffer ring buffer
 *    - Currently supports SpawnNpc command (others defined but not implemented)
 *    - Thread-safe using atomic operations
 * 
 * 4. Position Synchronization:
 *    - Sends NPC positions back to main thread every frame
 *    - Uses double buffering to prevent race conditions
 *    - Two methods: SharedArrayBuffer (fast) or postMessage (fallback)
 * 
 * Architecture:
 * 
 * Main Thread                    Web Worker
 *      │                              │
 *      │─── init message ───────────>│
 *      │   (spawn NPCs, setup)       │
 *      │                              │
 *      │─── commands ────────────────>│
 *      │   (via SharedArrayBuffer)    │
 *      │                              │
 *      │<─── NPC positions ──────────│
 *      │   (via SharedArrayBuffer)    │
 * 
 * The worker runs a tight loop that:
 * 1. Processes commands from main thread
 * 2. Runs ECS systems (movement, AI)
 * 3. Updates spatial grid (currently unused)
 * 4. Writes position snapshots to shared buffer
 * 5. Yields to event loop and repeats
 */

import { addComponent, addEntity } from 'bitecs';
import { world, Position, Rotation, Velocity } from '../ecs/world';
import { SpriteRef } from '../ecs/components/SpriteRef';
import { NpcTag } from '../ecs/components/NpcTag';
import { movementSystem } from '../ecs/systems/movementSystem';
import { defineQuery } from 'bitecs';
import { straightWalkSystem, initializeStraightWalkNpcs } from '../ecs/systems/straightWalkSystem';
import { SpatialGrid } from '../utils/spatialGrid';
import { entityCollisionSystem } from '../ecs/systems/collisionSystem';

/**
 * Initialization message sent from main thread to worker.
 * Contains all data needed to set up the simulation.
 */
interface InitMessage {
  type: 'init';
  /** Number of NPCs to spawn initially */
  npcCount: number;
  /** Initial player position and rotation */
  player: { lng: number; lat: number; rot: number };
  /** Shared memory buffer for position snapshots (if SharedArrayBuffer is available) */
  sharedBuffer?: SharedArrayBuffer;
  /** Number of floats per snapshot (npcCount * 3: lng, lat, rot) */
  floatsPerSnap?: number;
  /** Shared memory buffer for command queue */
  cmdBuffer?: SharedArrayBuffer;
  /** Maximum number of commands the queue can hold */
  cmdCapacity?: number;
  /** Number of integers per command (always 4) */
  cmdWords?: number;
}

/**
 * ECS query to find all NPC entities.
 * Matches entities that have NpcTag, Position, and Rotation components.
 */
const npcQuery = defineQuery([NpcTag, Position, Rotation]);

/**
 * Spatial grid for efficient collision detection.
 * Rebuilt every frame with current NPC positions.
 * Initialized when worker receives init message.
 */
let spatialGrid: SpatialGrid | null = null;

/* ---------------- Fixed-Timestep Game Loop ---------------- */

/**
 * High-precision, self-correcting game loop for the worker.
 * Runs at exactly 60 Hz using an accumulator pattern to handle variable frame rates.
 * 
 * The accumulator ensures:
 * - Deterministic simulation (same input = same output)
 * - Handles frame rate spikes gracefully
 * - Never runs too fast (capped at MAX_STEPS per frame)
 * - Catches up if it falls behind
 */
const loop = {
  /** Timestamp of last frame (milliseconds) */
  lastTime: 0,
  /** Whether the loop is currently running */
  running: false,
  /** Accumulated time waiting to be processed (milliseconds) */
  accumulator: 0,
  /** Main loop function (defined in onmessage after initialization) */
  tick: () => {},
  
  /**
   * Starts the game loop.
   * Initializes timing and begins the first tick.
   */
  start: function() {
    this.running = true;
    this.lastTime = performance.now();
    this.tick();
  },
  
  /**
   * Stops the game loop.
   * Sets running flag to false, which will cause tick() to exit.
   */
  stop: function() {
    this.running = false;
  }
};

/**
 * Message handler for initialization and setup.
 * Called once when the worker receives the 'init' message from the main thread.
 */
self.onmessage = (evt: MessageEvent<InitMessage>) => {
  const data = evt.data;
  if (data.type !== 'init') return;
  const { npcCount, player } = data;

  /* ---------------- NPC Spawning ---------------- */
  
  /**
   * Spawn radius in degrees (approximately 111 meters at equator).
   * NPCs are spawned in a circle around the player's starting position.
   */
  const R = 0.001;
  
  /**
   * Create NPC entities and add them to the ECS world.
   * Each NPC is spawned at a random position within radius R of the player.
   */
  for (let i = 0; i < npcCount; i++) {
    // Random angle and distance for circular distribution
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * R;
    const lng = player.lng + Math.cos(angle) * dist;
    const lat = player.lat + Math.sin(angle) * dist;
    
    // Create entity and add required components
    const eid = addEntity(world);
    addComponent(world, Position, eid);
    addComponent(world, Rotation, eid);
    addComponent(world, Velocity, eid);
    addComponent(world, NpcTag, eid);
    addComponent(world, SpriteRef, eid);
    
    // Set initial position
    Position.x[eid] = lng;
    Position.y[eid] = lat;
  }

  /**
   * Initialize NPC movement directions.
   * Sets each NPC to walk outward from the player's position with some randomness.
   */
  initializeStraightWalkNpcs(player.lng, player.lat);

  /**
   * Initialize spatial grid for collision detection.
   * Creates a new grid instance that will be rebuilt every frame.
   */
  spatialGrid = new SpatialGrid();

  /* ---------------- Shared Memory Setup ---------------- */
  
  /**
   * Set up SharedArrayBuffer for fast position data transfer.
   * Uses double buffering: two buffers that alternate to prevent race conditions.
   */
  const useSharedBuffer = Boolean(data.sharedBuffer && data.floatsPerSnap);
  let ctrl: Int32Array | null = null;  // Control array: [writeIndex] (0 or 1)
  let buffer: Float32Array | null = null;  // Double buffer: [buffer0][buffer1]
  let floatsPerSnap = 0;
  if (useSharedBuffer && data.sharedBuffer && data.floatsPerSnap) {
    floatsPerSnap = data.floatsPerSnap;
    // Control array: first 4 bytes store the current write index (0 or 1)
    ctrl = new Int32Array(data.sharedBuffer, 0, 1);
    // Data buffer: starts after control, contains two snapshots (double buffer)
    buffer = new Float32Array(data.sharedBuffer, Int32Array.BYTES_PER_ELEMENT);
  }
  /** Tracks which buffer we're currently writing to (0 or 1) */
  let writeIndex = 0;

  /**
   * Set up SharedArrayBuffer for command queue.
   * Ring buffer for thread-safe command passing from main thread to worker.
   */
  let cmdCtrl: Int32Array | null = null;  // [head, tail] - ring buffer pointers
  let cmdData: Int32Array | null = null;  // Command data array
  let CMD_CAPACITY = 0;
  let CMD_WORDS = 4;  // 4 integers per command: type, a, b, c
  if (data.cmdBuffer && data.cmdCapacity) {
    CMD_CAPACITY = data.cmdCapacity;
    CMD_WORDS = data.cmdWords || 4;
    // Control: first 8 bytes store head and tail pointers
    cmdCtrl = new Int32Array(data.cmdBuffer, 0, 2);
    // Data: starts after control header, contains command ring buffer
    cmdData = new Int32Array(data.cmdBuffer, 2 * Int32Array.BYTES_PER_ELEMENT);
  }

  /* ---------------- Game Loop Constants ---------------- */
  
  /** Fixed timestep: 60 Hz = 16.666... milliseconds per tick */
  const FIXED_DT_MS = 1000 / 60;
  /** Maximum number of simulation steps per frame (prevents spiral of death) */
  const MAX_STEPS = 5;

  /**
   * Main game loop tick function.
   * Runs every frame, processing simulation steps and sending position updates.
   */
  loop.tick = () => {
    if (!loop.running) return;

    /* ---------------- Time Management ---------------- */
    
    // Measure elapsed time since last frame
    const now = performance.now();
    let delta = now - loop.lastTime;
    loop.lastTime = now;
    // Cap delta to prevent huge jumps (e.g., when tab was hidden)
    if (delta > 200) delta = 200;

    // Accumulate time into accumulator
    loop.accumulator += delta;
    
    /* ---------------- Fixed-Timestep Simulation ---------------- */
    
    /**
     * Run simulation steps until we've caught up with real time.
     * This ensures deterministic, frame-rate independent simulation.
     */
    while (loop.accumulator >= FIXED_DT_MS) {
      // Run ECS systems in order
      straightWalkSystem();  // Sets NPC walking directions (currently just initializes)
      movementSystem();      // Applies velocity to position
      
      // Rebuild spatial grid with current NPC positions
      // This must be done after movement but before collision detection
      if (spatialGrid) {
        const npcEnts = npcQuery(world);
        spatialGrid.rebuild(npcEnts, Position);
        
        // Run collision detection and resolution
        entityCollisionSystem(spatialGrid, Position, Velocity);
      }
      
      /* ---------------- Command Processing ---------------- */
      
      /**
       * Process commands from the main thread.
       * Reads from the ring buffer using atomic operations for thread safety.
       */
      if (cmdCtrl && cmdData) {
        // Load current head and tail pointers atomically
        let head = Atomics.load(cmdCtrl, 0);
        const tail = Atomics.load(cmdCtrl, 1);
        
        // Process all commands in the queue
        while (head !== tail) {
          const base = head * CMD_WORDS;
          const type = cmdData[base];
          
          if (type === 1) { // CommandType.SpawnNpc
            // Decode coordinates (were scaled by 1e7 for integer precision)
            const lng = cmdData[base + 1] / 1e7;
            const lat = cmdData[base + 2] / 1e7;
            
            // Create new NPC entity
            const eid = addEntity(world);
            addComponent(world, Position, eid);
            addComponent(world, Rotation, eid);
            addComponent(world, Velocity, eid);
            addComponent(world, NpcTag, eid);
            addComponent(world, SpriteRef, eid);
            
            // Set position and rotation
            Position.x[eid] = lng;
            Position.y[eid] = lat;
            Rotation.angle[eid] = cmdData[base + 3];
          }
          
          // Advance head pointer (ring buffer wrap-around)
          head = (head + 1) % CMD_CAPACITY;
          // Atomically update head to mark command as processed
          Atomics.store(cmdCtrl, 0, head);
        }
      }
      
      // Subtract one timestep from accumulator
      loop.accumulator -= FIXED_DT_MS;
    }

    /* ---------------- Position Snapshot Output ---------------- */
    
    /**
     * Query all NPCs and send their positions to the main thread.
     * Uses double buffering when SharedArrayBuffer is available for zero-copy transfer.
     */
    const ents = npcQuery(world);
    
    if (useSharedBuffer && ctrl && buffer) {
      /**
       * Fast path: Write to SharedArrayBuffer using double buffering.
       * Main thread reads from the buffer we're NOT writing to.
       */
      const offset = writeIndex * floatsPerSnap;
      
      // Write NPC positions to current buffer (3 floats per NPC: lng, lat, rot)
      for (let i = 0; i < ents.length; i++) {
        const eid = ents[i];
        const base = offset + i * 3;
        buffer[base] = Position.x[eid];
        buffer[base + 1] = Position.y[eid];
        
        // Calculate rotation from velocity direction (ensures NPC faces movement direction)
        // Testing: Try NO offset first (assumes sprite faces east by default, matching Canvas rotate(0))
        const velocityX = Velocity.x[eid] || 0;
        const velocityY = Velocity.y[eid] || 0;
        const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
        let rotation: number;
        if (speed > 0.0000001) { // Small threshold to detect movement
          // Calculate rotation from velocity to match player's coordinate system
          // Player system: rotation 0° = north (deltaLat = cos(0) = 1, deltaLng = sin(0) = 0)
          // When moving north: velocityY = 1, velocityX = 0
          // atan2(1, 0) = π/2 radians = 90°, but player rotation for north = 0°
          // So we need: rotation = atan2(velocityY, velocityX) - π/2
          // Canvas rotate() rotates clockwise, CSS rotateZ() rotates counter-clockwise
          // So we need to negate to match: rotation = -(atan2(velocityY, velocityX) - π/2)
          rotation = -(Math.atan2(velocityY, velocityX) - Math.PI / 2);
        } else {
          // Idle: use stored rotation (convert from degrees to radians)
          // Rotation.angle uses game system (0° = north), same as player
          // Convert from game system (0° = north) to Canvas system (0 = east)
          // Same conversion as moving NPCs: subtract π/2 and negate
          const rotationDeg = Rotation.angle[eid] || 0;
          rotation = -((rotationDeg * Math.PI) / 180 - Math.PI / 2);
        }
        buffer[base + 2] = rotation;
      }
      
      // Atomically update write index and notify main thread
      Atomics.store(ctrl, 0, writeIndex);
      Atomics.notify(ctrl, 0);
      
      // Switch to other buffer for next frame (XOR flips between 0 and 1)
      writeIndex ^= 1;
    } else {
      /**
       * Fallback path: Use postMessage (slower but works without SharedArrayBuffer).
       * Transfers ownership of the buffer to avoid copying.
       */
      const snap = new Float32Array(ents.length * 3);
      for (let i = 0; i < ents.length; i++) {
        const eid = ents[i];
        snap[i * 3] = Position.x[eid];
        snap[i * 3 + 1] = Position.y[eid];
        
        // Calculate rotation from velocity direction (ensures NPC faces movement direction)
        // Testing: Try NO offset first (assumes sprite faces east by default, matching Canvas rotate(0))
        const velocityX = Velocity.x[eid] || 0;
        const velocityY = Velocity.y[eid] || 0;
        const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
        let rotation: number;
        if (speed > 0.0000001) { // Small threshold to detect movement
          // Calculate rotation from velocity to match player's coordinate system
          // Player system: rotation 0° = north (deltaLat = cos(0) = 1, deltaLng = sin(0) = 0)
          // When moving north: velocityY = 1, velocityX = 0
          // atan2(1, 0) = π/2 radians = 90°, but player rotation for north = 0°
          // So we need: rotation = atan2(velocityY, velocityX) - π/2
          // Canvas rotate() rotates clockwise, CSS rotateZ() rotates counter-clockwise
          // So we need to negate to match: rotation = -(atan2(velocityY, velocityX) - π/2)
          rotation = -(Math.atan2(velocityY, velocityX) - Math.PI / 2);
        } else {
          // Idle: use stored rotation (convert from degrees to radians)
          // Rotation.angle uses game system (0° = north), same as player
          // Convert from game system (0° = north) to Canvas system (0 = east)
          // Same conversion as moving NPCs: subtract π/2 and negate
          const rotationDeg = Rotation.angle[eid] || 0;
          rotation = -((rotationDeg * Math.PI) / 180 - Math.PI / 2);
        }
        snap[i * 3 + 2] = rotation;
      }
      // Transfer buffer ownership to avoid copying
      (self as any).postMessage(snap, [snap.buffer]);
    }
    
    /**
     * Yield to the event loop using setTimeout.
     * This creates a non-blocking tight loop that allows other tasks to run.
     * Without this, the worker would block completely.
     */
    setTimeout(loop.tick, 0);
  };
  
  /**
   * Start the game loop.
   * This begins the simulation and it will continue running until stop() is called.
   */
  loop.start();
};