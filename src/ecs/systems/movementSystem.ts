import { defineQuery } from 'bitecs';
import { Position, Velocity, world } from '../world';

const movableQuery = defineQuery([Position, Velocity]);
const DT_SEC = 1 / 60; // fixed step duration

export function movementSystem(): void {
  const ents = movableQuery(world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    Position.x[eid] += Velocity.x[eid] * DT_SEC;
    Position.y[eid] += Velocity.y[eid] * DT_SEC;
  }
} 