/**
 * Shared Systems - Re-export bridge for ECS systems
 */

export { entityCollisionSystem, CHARACTER_RADIUS_DEG, SEPARATION_FACTOR, VELOCITY_DAMPING, MIN_SEPARATION_BUFFER, RESTITUTION } from './collisionSystem';
export { buildingCollisionSystem, BuildingCollider, BUILDING_VELOCITY_DAMPING, MIN_PUSH_DISTANCE_DEG } from './buildingCollisionSystem';
export type { BuildingFeature } from './buildingCollisionSystem';

