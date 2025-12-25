/**
 * Collision System - Entity-to-Entity Collision Detection and Resolution
 * 
 * This system detects and resolves collisions between entities (player and NPCs)
 * using circle-circle collision detection. It uses a spatial grid for efficient
 * collision queries, reducing complexity from O(n²) to O(n) for most cases.
 * 
 * Collision Response:
 * - Entities are pushed apart along the collision normal
 * - Velocity is dampened to prevent jitter
 * - Simple separation algorithm (no complex physics)
 * 
 * Usage:
 * 
 * ```typescript
 * const grid = new SpatialGrid();
 * const entities = npcQuery(world);
 * grid.rebuild(entities, Position);
 * entityCollisionSystem(entities, grid, Position, Velocity);
 * ```
 */

import { SpatialGrid } from '../utils/spatialGrid';

/**
 * Character collision radius in degrees.
 * Approximately 2-3 meters at the equator.
 * This represents the "personal space" around each character.
 */
export const CHARACTER_RADIUS_DEG = 0.0000028; // adjust to effect how close characters have to be to each other before collision takes place

/**
 * Maximum collision distance squared for early exit optimization.
 * Entities beyond this distance are guaranteed not to collide.
 * Set to 2.5x radius to account for spatial grid cell size.
 */
const MAX_COLLISION_DIST_SQ = (CHARACTER_RADIUS_DEG * 2.5) ** 2;

/**
 * Collision response parameters - adjust these to change collision behavior
 */

/**
 * Separation factor: how much entities push apart when colliding (0.0 to 1.0).
 * 0.5 = each entity moves half the overlap distance.
 * Lower values = gentler push, higher values = stronger push.
 */
export const SEPARATION_FACTOR = 0.5;

/**
 * Velocity damping: how much velocity is reduced on collision (0.0 to 1.0).
 * 0.0 = no damping (bouncy), 1.0 = full stop.
 * Lower values = entities bounce off each other, higher values = entities slow down more.
 */
export const VELOCITY_DAMPING = 0.0;

/**
 * Minimum separation buffer: extra space added after separation (in degrees).
 * Prevents immediate re-collision by ensuring entities are pushed slightly further apart.
 * Set to 0.0 to disable, or a small value like 0.0000001 for a buffer.
 */
export const MIN_SEPARATION_BUFFER = 0.0;

/**
 * Restitution: bounce effect when entities collide (0.0 to 1.0).
 * 0.0 = no bounce (damped collision), 1.0 = full bounce.
 * Only effective when VELOCITY_DAMPING is low (near 0.0).
 * Set to 0.0 to use damping-based collision response.
 */
export const RESTITUTION = 0.0;

/**
 * Resolves collision between two entities using simple separation.
 * Moves entities apart along the collision normal and applies velocity damping.
 * 
 * Optimized to reuse pre-calculated distance and delta values.
 * 
 * @param eid1 - First entity ID
 * @param eid2 - Second entity ID
 * @param overlap - Amount of overlap between entities (positive value)
 * @param dist - Pre-calculated distance between entities
 * @param dx - Pre-calculated delta X (eid2.x - eid1.x)
 * @param dy - Pre-calculated delta Y (eid2.y - eid1.y)
 * @param Position - Position component from ECS world (typed array)
 * @param Velocity - Velocity component from ECS world (typed array)
 */
function resolveCollision(
  eid1: number,
  eid2: number,
  overlap: number,
  dist: number,
  dx: number,
  dy: number,
  Position: { x: { [key: number]: number }; y: { [key: number]: number } },
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } }
): void {
  if (dist === 0) {
    // Entities are exactly on top of each other - random separation
    const angle = Math.random() * Math.PI * 2;
    const separation = overlap * SEPARATION_FACTOR + MIN_SEPARATION_BUFFER;
    Position.x[eid1] -= Math.cos(angle) * separation;
    Position.y[eid1] -= Math.sin(angle) * separation;
    Position.x[eid2] += Math.cos(angle) * separation;
    Position.y[eid2] += Math.sin(angle) * separation;
    return;
  }
  
  // Normalize direction (collision normal)
  const nx = dx / dist;
  const ny = dy / dist;
  
  // Separate entities along collision normal
  // Apply separation factor and optional buffer
  const separation = overlap * SEPARATION_FACTOR + MIN_SEPARATION_BUFFER;
  Position.x[eid1] -= nx * separation;
  Position.y[eid1] -= ny * separation;
  Position.x[eid2] += nx * separation;
  Position.y[eid2] += ny * separation;
  
  // Apply velocity response (damping or restitution)
  // Calculate relative velocity along collision normal
  const v1x = Velocity.x[eid1];
  const v1y = Velocity.y[eid1];
  const v2x = Velocity.x[eid2];
  const v2y = Velocity.y[eid2];
  
  const relativeVelX = v2x - v1x;
  const relativeVelY = v2y - v1y;
  const velAlongNormal = relativeVelX * nx + relativeVelY * ny;
  
  // Only resolve if objects are moving towards each other
  if (velAlongNormal > 0) return;
  
  // Apply collision response based on RESTITUTION setting
  if (RESTITUTION > 0) {
    // Bouncy collision: entities bounce off each other
    // Restitution of 1.0 = perfect bounce, 0.0 = no bounce
    Velocity.x[eid1] -= nx * velAlongNormal * (1 + RESTITUTION);
    Velocity.y[eid1] -= ny * velAlongNormal * (1 + RESTITUTION);
    Velocity.x[eid2] += nx * velAlongNormal * (1 + RESTITUTION);
    Velocity.y[eid2] += ny * velAlongNormal * (1 + RESTITUTION);
  } else {
    // Damped collision: entities slow down when colliding
    // Damping of 1.0 = full stop, 0.0 = no damping
    Velocity.x[eid1] += nx * velAlongNormal * VELOCITY_DAMPING;
    Velocity.y[eid1] += ny * velAlongNormal * VELOCITY_DAMPING;
    Velocity.x[eid2] -= nx * velAlongNormal * VELOCITY_DAMPING;
    Velocity.y[eid2] -= ny * velAlongNormal * VELOCITY_DAMPING;
  }
}

/**
 * Main collision system.
 * Detects and resolves collisions between all entities.
 * 
 * Optimizations:
 * - Uses ordered pair tracking to avoid duplicate checks (each pair checked once)
 * - Reuses distance calculations (no redundant sqrt calls)
 * - Early exit for distant entities (spatial grid optimization)
 * - Accepts entities array directly (avoids grid scanning)
 * 
 * Note: This system is used on the server. On the server, it runs after movementSystem in the fixed update loop.
 * Requires the spatial grid to be rebuilt before calling this function.
 * 
 * @param entities - Array of entity IDs to check for collisions (from ECS query)
 * @param grid - Spatial grid containing entity positions (must be rebuilt before calling)
 * @param Position - Position component from ECS world (typed array)
 * @param Velocity - Velocity component from ECS world (typed array)
 */
export function entityCollisionSystem(
  entities: number[],
  grid: SpatialGrid,
  Position: { x: { [key: number]: number }; y: { [key: number]: number } },
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } }
): void {
  // Radius sum squared for collision detection (avoids recalculating)
  const radiusSum = CHARACTER_RADIUS_DEG * 2;
  const radiusSumSq = radiusSum * radiusSum;
  
  for (let i = 0; i < entities.length; i++) {
    const eid1 = entities[i];
    const x1 = Position.x[eid1];
    const y1 = Position.y[eid1];
    
    // Get nearby entities using spatial grid (3x3 cell area)
    const nearby = grid.getNearbyEntities(x1, y1);
    
    for (let j = 0; j < nearby.length; j++) {
      const eid2 = nearby[j];
      
      // Skip self
      if (eid1 === eid2) continue;
      
      // Only check pairs where eid1 < eid2 to avoid duplicate checks
      // This naturally ensures each pair is checked exactly once without Set lookups
      if (eid1 >= eid2) continue;
      
      const x2 = Position.x[eid2];
      const y2 = Position.y[eid2];
      
      // Calculate delta and distance squared (for early exit)
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distSq = dx * dx + dy * dy;
      
      // Early exit: entities too far apart to collide
      if (distSq > MAX_COLLISION_DIST_SQ) continue;
      
      // Check collision using squared distance (avoids sqrt)
      if (distSq < radiusSumSq) {
        // Calculate actual distance and overlap
        const dist = Math.sqrt(distSq);
        const overlap = radiusSum - dist;
        
        if (overlap > 0) {
          // Resolve collision using pre-calculated values
          resolveCollision(eid1, eid2, overlap, dist, dx, dy, Position, Velocity);
        }
      }
    }
  }
}

