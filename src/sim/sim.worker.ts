// Web Worker that owns the ECS world and runs the fixed-step loop for NPCs.

import { addComponent, addEntity } from 'bitecs';
import { world, Position, Rotation, Velocity } from '../ecs/world';
import { NpcTag } from '../ecs/components/NpcTag';
import { movementSystem } from '../ecs/systems/movementSystem';
import { randomWalkSystem } from '../ecs/systems/randomWalkSystem';
import { defineQuery } from 'bitecs';

interface InitMessage {
  type: 'init';
  npcCount: number;
  player: { lng: number; lat: number; rot: number };
}

// Query to read NPC positions efficiently
const npcQuery = defineQuery([NpcTag, Position, Rotation]);

self.onmessage = (evt: MessageEvent<InitMessage>) => {
  const data = evt.data;
  if (data.type !== 'init') return;
  const { npcCount, player } = data;

  // Spawn requested NPCs near the player – same algorithm as before
  const R = 0.001; // ~100 m radius at equator
  for (let i = 0; i < npcCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * R;
    const lng = player.lng + Math.cos(angle) * dist;
    const lat = player.lat + Math.sin(angle) * dist;
    const eid = addEntity(world);
    addComponent(world, Position, eid);
    addComponent(world, Rotation, eid);
    addComponent(world, Velocity, eid);
    addComponent(world, NpcTag, eid);
    Position.x[eid] = lng;
    Position.y[eid] = lat;
    Rotation.angle[eid] = 0;
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
  }

  // Start fixed-step loop (60 Hz)
  const DT_MS = 1000 / 60;
  setInterval(() => {
    randomWalkSystem();
    movementSystem();

    // Collect snapshot: 3 floats (lng, lat, rot) per NPC
    const ents = npcQuery(world);
    const snap = new Float32Array(ents.length * 3);
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      snap[i * 3] = Position.x[eid];
      snap[i * 3 + 1] = Position.y[eid];
      snap[i * 3 + 2] = Rotation.angle[eid];
    }
    // Post snapshot to UI thread (copy semantics for now)
    (self as any).postMessage(snap, [snap.buffer]);
  }, DT_MS);
}; 