/**
 * Collision System - Entity-to-Entity Collision Detection and Resolution
 */

import { SpatialGrid } from '../utils/spatialGrid';

export const CHARACTER_RADIUS_DEG = 0.0000028;
const MAX_COLLISION_DIST_SQ = (CHARACTER_RADIUS_DEG * 2.5) ** 2;
export const SEPARATION_FACTOR = 0.5;
export const VELOCITY_DAMPING = 0.0;
export const MIN_SEPARATION_BUFFER = 0.0;
export const RESTITUTION = 0.0;

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
    const angle = Math.random() * Math.PI * 2;
    const separation = overlap * SEPARATION_FACTOR + MIN_SEPARATION_BUFFER;
    Position.x[eid1] -= Math.cos(angle) * separation;
    Position.y[eid1] -= Math.sin(angle) * separation;
    Position.x[eid2] += Math.cos(angle) * separation;
    Position.y[eid2] += Math.sin(angle) * separation;
    return;
  }
  
  const nx = dx / dist;
  const ny = dy / dist;
  const separation = overlap * SEPARATION_FACTOR + MIN_SEPARATION_BUFFER;
  Position.x[eid1] -= nx * separation;
  Position.y[eid1] -= ny * separation;
  Position.x[eid2] += nx * separation;
  Position.y[eid2] += ny * separation;
  
  const v1x = Velocity.x[eid1];
  const v1y = Velocity.y[eid1];
  const v2x = Velocity.x[eid2];
  const v2y = Velocity.y[eid2];
  
  const relativeVelX = v2x - v1x;
  const relativeVelY = v2y - v1y;
  const velAlongNormal = relativeVelX * nx + relativeVelY * ny;
  
  if (velAlongNormal > 0) return;
  
  if (RESTITUTION > 0) {
    Velocity.x[eid1] -= nx * velAlongNormal * (1 + RESTITUTION);
    Velocity.y[eid1] -= ny * velAlongNormal * (1 + RESTITUTION);
    Velocity.x[eid2] += nx * velAlongNormal * (1 + RESTITUTION);
    Velocity.y[eid2] += ny * velAlongNormal * (1 + RESTITUTION);
  } else {
    Velocity.x[eid1] += nx * velAlongNormal * VELOCITY_DAMPING;
    Velocity.y[eid1] += ny * velAlongNormal * VELOCITY_DAMPING;
    Velocity.x[eid2] -= nx * velAlongNormal * VELOCITY_DAMPING;
    Velocity.y[eid2] -= ny * velAlongNormal * VELOCITY_DAMPING;
  }
}

export function entityCollisionSystem(
  entities: number[],
  grid: SpatialGrid,
  Position: { x: { [key: number]: number }; y: { [key: number]: number } },
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } }
): void {
  const radiusSum = CHARACTER_RADIUS_DEG * 2;
  const radiusSumSq = radiusSum * radiusSum;
  
  for (let i = 0; i < entities.length; i++) {
    const eid1 = entities[i];
    const x1 = Position.x[eid1];
    const y1 = Position.y[eid1];
    
    const nearby = grid.getNearbyEntities(x1, y1);
    
    for (let j = 0; j < nearby.length; j++) {
      const eid2 = nearby[j];
      
      if (eid1 === eid2) continue;
      if (eid1 >= eid2) continue;
      
      const x2 = Position.x[eid2];
      const y2 = Position.y[eid2];
      
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distSq = dx * dx + dy * dy;
      
      if (distSq > MAX_COLLISION_DIST_SQ) continue;
      
      if (distSq < radiusSumSq) {
        const dist = Math.sqrt(distSq);
        const overlap = radiusSum - dist;
        
        if (overlap > 0) {
          resolveCollision(eid1, eid2, overlap, dist, dx, dy, Position, Velocity);
        }
      }
    }
  }
}

