/**
 * Random Walk System - Server Version
 * 
 * Makes NPCs randomly change direction periodically.
 */

import { defineQuery, IWorld } from 'bitecs';
import { Position, Rotation, Velocity, NpcTag } from '@shared/realearthstreetwar';

const BASE_SPEED = 0.000000225;    
const CHANGE_TIMER = 180;  

// Speed variation: each NPC gets a random multiplier between 0.7x and 1.3x
const MIN_SPEED_MULTIPLIER = 0.8;
const MAX_SPEED_MULTIPLIER = 1.9;

// Local timer per entity (sparse array)
const changeCounter: number[] = [];
// Final speed per entity (sparse array) - calculated once at spawn
const npcSpeed: number[] = [];

const npcQuery = defineQuery([NpcTag, Position, Velocity, Rotation]);

/**
 * Initialize speed for a newly spawned NPC
 * Calculates final speed once at spawn time
 */
export function initializeNpcSpeedMultiplier(eid: number): void {
  const multiplier = MIN_SPEED_MULTIPLIER + 
    Math.random() * (MAX_SPEED_MULTIPLIER - MIN_SPEED_MULTIPLIER);
  npcSpeed[eid] = BASE_SPEED * multiplier;
}

/**
 * Get the pre-calculated speed for an NPC
 * Returns BASE_SPEED if NPC speed hasn't been initialized
 */
export function getNpcSpeed(eid: number): number {
  return npcSpeed[eid] || BASE_SPEED;
}

export function randomWalkSystem(world: IWorld): void {
  const ents = npcQuery(world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    
    changeCounter[eid] = (changeCounter[eid] || 0) - 1;
    if (changeCounter[eid] <= 0) {
      changeCounter[eid] = Math.floor(Math.random() * CHANGE_TIMER) + CHANGE_TIMER;
      
      // Generate angle in game coordinates (0° = north, 90° = east)
      const gameAngleDeg = Math.random() * 360;
      Rotation.angle[eid] = gameAngleDeg; // Store directly in game coordinates
      
      // Convert to radians (still in game coordinates)
      const radians = (gameAngleDeg * Math.PI) / 180;
      
      // Use same formula as player: sin for lat/y, cos for lng/x
      // This converts from game coordinates (0° = north) to movement direction
      Velocity.x[eid] = Math.cos(radians) * (npcSpeed[eid] || BASE_SPEED);
      Velocity.y[eid] = Math.sin(radians) * (npcSpeed[eid] || BASE_SPEED);
    }
  }
}

