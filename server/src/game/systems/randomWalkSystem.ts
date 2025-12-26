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
const MIN_SPEED_MULTIPLIER = 0.5;
const MAX_SPEED_MULTIPLIER = 1.8;

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
      const angleRad = Math.random() * Math.PI * 2;
      Rotation.angle[eid] = angleRad * 180 / Math.PI;
      
      // Use pre-calculated speed (no multiplication needed)
      Velocity.x[eid] = Math.cos(angleRad) * (npcSpeed[eid] || BASE_SPEED);
      Velocity.y[eid] = Math.sin(angleRad) * (npcSpeed[eid] || BASE_SPEED);
    }
  }
}

