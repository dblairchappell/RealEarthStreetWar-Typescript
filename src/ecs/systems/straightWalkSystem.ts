import { defineQuery } from 'bitecs';
import { world } from '../world';
import { Position, Rotation, Velocity } from '../world';
import { NpcTag } from '../components/NpcTag';

const npcQuery = defineQuery([NpcTag, Position, Velocity, Rotation]);

// Walking speed - realistic pace
const WALK_SPEED = 0.000000225;  // ~1.5 m/s walking speed

/**
 * Initialize NPCs with random directions radiating outward from a center point
 */
export function initializeStraightWalkNpcs(centerLng: number, centerLat: number): void {
  const ents = npcQuery(world);
  
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    
    // Calculate direction from center to NPC
    const npcLng = Position.x[eid];
    const npcLat = Position.y[eid];
    
    const deltaLng = npcLng - centerLng;
    const deltaLat = npcLat - centerLat;
    
    // Calculate angle from center to NPC (outward direction)
    let angleRad = Math.atan2(deltaLat, deltaLng);
    
    // Add some randomness to the angle (±30 degrees)
    const randomOffset = (Math.random() - 0.5) * (Math.PI / 3);
    angleRad += randomOffset;
    
    // Set rotation for visual display
    Rotation.angle[eid] = (angleRad * 180) / Math.PI;
    
    // Set velocity in the chosen direction
    Velocity.x[eid] = Math.cos(angleRad) * WALK_SPEED;
    Velocity.y[eid] = Math.sin(angleRad) * WALK_SPEED;
  }
}

/**
 * Simple straight-line walking system - NPCs continue in their set direction
 */
export function straightWalkSystem(): void {
  // NPCs just walk straight - no direction changes needed
  // The movement system handles position updates automatically
}



