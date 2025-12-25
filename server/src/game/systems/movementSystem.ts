/**
 * Movement System - Server Version
 * 
 * Applies velocity to position for all entities with Position and Velocity components.
 */

import { defineQuery, IWorld } from 'bitecs';
import { Position, Velocity } from '@shared/realearthstreetwar';

const movableQuery = defineQuery([Position, Velocity]);

export function movementSystem(world: IWorld): void {
  const ents = movableQuery(world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    Position.x[eid] += Velocity.x[eid];
    Position.y[eid] += Velocity.y[eid];
  }
}

