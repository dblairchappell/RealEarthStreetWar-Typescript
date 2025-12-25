/**
 * Random Walk System - Server Version
 * 
 * Makes NPCs randomly change direction periodically.
 */

import { defineQuery, IWorld } from 'bitecs';
import { Position, Rotation, Velocity, NpcTag } from '@shared/realearthstreetwar';

const SPEED = 0.000000225;    
const CHANGE_TIMER = 180;  

// Local timer per entity (sparse array)
const changeCounter: number[] = [];

const npcQuery = defineQuery([NpcTag, Position, Velocity, Rotation]);

export function randomWalkSystem(world: IWorld): void {
  const ents = npcQuery(world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    changeCounter[eid] = (changeCounter[eid] || 0) - 1;
    if (changeCounter[eid] <= 0) {
      changeCounter[eid] = Math.floor(Math.random() * CHANGE_TIMER) + CHANGE_TIMER;
      const angleRad = Math.random() * Math.PI * 2;
      Rotation.angle[eid] = angleRad * 180 / Math.PI;
      Velocity.x[eid] = Math.cos(angleRad) * SPEED;
      Velocity.y[eid] = Math.sin(angleRad) * SPEED;
    }
  }
}

