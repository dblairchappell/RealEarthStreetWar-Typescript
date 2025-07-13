import { defineQuery } from 'bitecs';
import { Position, Velocity, world } from '../world';

const movableQuery = defineQuery([Position, Velocity]);

let debugCounter = 0;

export function movementSystem(): void {
  const ents = movableQuery(world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    
    // Debug first NPC every 60 frames
    if (i === 0 && debugCounter % 60 === 0) {
      const oldX = Position.x[eid];
      const oldY = Position.y[eid];
      
      Position.x[eid] += Velocity.x[eid];
      Position.y[eid] += Velocity.y[eid];
      
      console.log(`Movement: ${oldX.toFixed(9)} -> ${Position.x[eid].toFixed(9)} (Δ${(Position.x[eid] - oldX).toFixed(9)})`);
    } else {
      Position.x[eid] += Velocity.x[eid];
      Position.y[eid] += Velocity.y[eid];
    }
  }
  debugCounter++;
} 