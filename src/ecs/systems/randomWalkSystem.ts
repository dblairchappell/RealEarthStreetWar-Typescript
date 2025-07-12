import { defineQuery } from 'bitecs';
import { world } from '../world';
import { Position, Rotation, Velocity } from '../world';
import { NpcTag } from '../components/NpcTag';

const npcQuery = defineQuery([NpcTag, Position, Velocity, Rotation]);

const SPEED = 0.00002; // degrees per second
const CHANGE_TIMER = 180; // frames (~3s at 60Hz)

// Local timer per entity (sparse array)
const changeCounter: number[] = [];

export function randomWalkSystem(): void {
  const ents = npcQuery(world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    changeCounter[eid] = (changeCounter[eid] || 0) - 1;
    if (changeCounter[eid] <= 0) {
      changeCounter[eid] = Math.floor(Math.random()*CHANGE_TIMER)+CHANGE_TIMER;
      const angleRad = Math.random()*Math.PI*2;
      Rotation.angle[eid] = angleRad * 180 / Math.PI;
      Velocity.x[eid] = Math.cos(angleRad) * SPEED;
      Velocity.y[eid] = Math.sin(angleRad) * SPEED;
    }
  }
} 