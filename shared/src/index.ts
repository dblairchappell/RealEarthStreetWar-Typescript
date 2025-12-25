/**
 * Shared Package - Main entry point
 * 
 * This package contains code shared between the client and server:
 * - ECS components (Position, Rotation, Velocity, PlayerTag, NpcTag, SpriteRef)
 * - Game models (GameState for non-entity state like gameDate)
 * - Input types (InputState)
 * - Systems (collisionSystem)
 * - Utilities (SpatialGrid)
 * 
 * Note: Each side (client/server) maintains its own World instance.
 * Components define the structure, but each World has separate storage arrays.
 * Entity state (positions, rotations) is stored in ECS, not in GameState.
 */

// Components
export * from './components';

// ECS Components
export * from './ecs/components';

// Input
export * from './input';

// Models
export { default as GameState, GameStateConstants } from './model';

// Systems
export * from './systems';

// Utils
export * from './utils';

