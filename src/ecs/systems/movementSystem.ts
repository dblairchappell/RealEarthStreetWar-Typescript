import { defineQuery } from 'bitecs';
import { Position, Velocity, world } from '../world';

const movableQuery = defineQuery([Position, Velocity]);

export function movementSystem(dt: number): void {
  const ents = movableQuery(world);
  const dtSec = dt / 1000;
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    Position.x[eid] += Velocity.x[eid] * dtSec;
    Position.y[eid] += Velocity.y[eid] * dtSec;
  }
} 