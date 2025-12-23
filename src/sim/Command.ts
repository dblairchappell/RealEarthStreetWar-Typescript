/**
 * Command System - Protocol for Main Thread to Worker Communication
 * 
 * This file defines the command protocol used to send instructions from the main thread
 * to the Web Worker simulation. Commands are sent through a thread-safe ring buffer
 * (see SimulationBridge.enqueueCommand) and processed by the worker each simulation tick.
 * 
 * Architecture:
 * - Each command uses exactly 4 integers (32-bit slots) in the ring buffer
 * - Slot 0: Command type (CommandType enum value)
 * - Slots 1-3: Payload parameters (interpreted based on command type)
 * 
 * Command Types:
 * 
 * 1. SpawnNpc: Creates a new NPC entity at a specified location
 *    - a: Longitude (scaled by 1e7 for integer precision)
 *    - b: Latitude (scaled by 1e7 for integer precision)
 *    - c: Initial rotation angle (degrees)
 * 
 * 2. DestroyEntity: Removes an entity from the simulation (not yet implemented)
 *    - a: Entity ID to destroy
 *    - b: (unused)
 *    - c: (unused)
 * 
 * 3. SetVelocity: Sets an entity's velocity (not yet implemented)
 *    - a: Entity ID
 *    - b: Velocity X component (degrees per second)
 *    - c: Velocity Y component (degrees per second)
 * 
 * Usage Example:
 * ```typescript
 * // Spawn an NPC at a location
 * bridge.enqueueCommand(
 *   CommandType.SpawnNpc,
 *   Math.round(lng * 1e7),  // Scale for precision
 *   Math.round(lat * 1e7),
 *   0                        // Initial rotation
 * );
 * ```
 */

/**
 * Enumeration of available command types that can be sent to the simulation worker.
 * Values are integers to match the ring buffer format (4 int32 slots per command).
 */
export enum CommandType {
  /** Spawn a new NPC entity at the specified coordinates */
  SpawnNpc = 1,
  /** Destroy/remove an entity from the simulation (not yet implemented in worker) */
  DestroyEntity = 2,
  /** Set an entity's velocity (not yet implemented in worker) */
  SetVelocity = 3,
}

/**
 * Command structure representing a single instruction to the simulation worker.
 * 
 * Each command occupies exactly four 32-bit integer slots in the ring buffer:
 * - Slot 0: Command type (CommandType enum value)
 * - Slot 1: Parameter 'a' (interpreted based on command type)
 * - Slot 2: Parameter 'b' (interpreted based on command type)
 * - Slot 3: Parameter 'c' (interpreted based on command type)
 * 
 * The payload parameters (a, b, c) are optional in TypeScript but will always be
 * present when serialized into the ring buffer. Their meaning depends on the command type.
 */
export interface Command {
  /** The type of command to execute */
  type: CommandType;
  /** First payload parameter (meaning depends on command type) */
  a?: number;
  /** Second payload parameter (meaning depends on command type) */
  b?: number;
  /** Third payload parameter (meaning depends on command type) */
  c?: number;
} 