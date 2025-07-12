// Web Worker that owns the ECS world and runs the fixed-step loop for NPCs.

import { addComponent, addEntity } from 'bitecs';
import { world, Position, Rotation, Velocity } from '../ecs/world';
import { NpcTag } from '../ecs/components/NpcTag';
import { movementSystem as baseMovementSystem } from '../ecs/systems/movementSystem';
import { randomWalkSystem as baseRandomWalkSystem } from '../ecs/systems/randomWalkSystem';
import { defineQuery } from 'bitecs';

let movementSystemFn = baseMovementSystem;
let randomWalkSystemFn = baseRandomWalkSystem;

interface InitMessage {
  type: 'init';
  npcCount: number;
  player: { lng: number; lat: number; rot: number };
  sharedBuffer?: SharedArrayBuffer;
  floatsPerSnap?: number;
  cmdBuffer?: SharedArrayBuffer;
  cmdCapacity?: number;
  cmdWords?: number;
}

// Query to read NPC positions efficiently
const npcQuery = defineQuery([NpcTag, Position, Rotation]);

self.onmessage = (evt: MessageEvent<any>) => {
  const data = evt.data;
  // Legacy 'reloadSystem' message handler removed.
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

  const useSharedBuffer = Boolean(data.sharedBuffer && data.floatsPerSnap);

  // If SAB path: set up views
  let ctrl: Int32Array | null = null;
  let buffer: Float32Array | null = null;
  let floatsPerSnap = 0;
  if (useSharedBuffer) {
    floatsPerSnap = data.floatsPerSnap!;
    const HEADER_SIZE = Int32Array.BYTES_PER_ELEMENT;
    ctrl = new Int32Array(data.sharedBuffer!, 0, 1);
    buffer = new Float32Array(data.sharedBuffer!, HEADER_SIZE);
  }

  let writeIndex = 0; // toggles 0/1 for double buffer

  // Command queue views
  let cmdCtrl: Int32Array | null = null;
  let cmdData: Int32Array | null = null;
  let CMD_CAPACITY = 0;
  let CMD_WORDS = 4;
  if (data.cmdBuffer && data.cmdCapacity) {
    CMD_CAPACITY = data.cmdCapacity;
    CMD_WORDS = data.cmdWords || 4;
    cmdCtrl = new Int32Array(data.cmdBuffer, 0, 2);
    cmdData = new Int32Array(data.cmdBuffer, 2 * Int32Array.BYTES_PER_ELEMENT);
  }

  // Start fixed-step loop (60 Hz)
  const DT_MS = 1000 / 60;
  setInterval(() => {
    randomWalkSystemFn();
    movementSystemFn();

    // ---- process commands after systems (or before, up to design) ----
    if (cmdCtrl && cmdData) {
      let head = Atomics.load(cmdCtrl, 0);
      let tail = Atomics.load(cmdCtrl, 1);
      while (head !== tail) {
        const base = head * CMD_WORDS;
        const type = cmdData[base];
        const a = cmdData[base + 1];
        const b = cmdData[base + 2];
        const c = cmdData[base + 3];

        switch (type) {
          case 1: // SpawnNpc
            const lng = a / 1e7;
            const lat = b / 1e7;
            const eid = addEntity(world);
            addComponent(world, Position, eid);
            addComponent(world, Rotation, eid);
            addComponent(world, Velocity, eid);
            addComponent(world, NpcTag, eid);
            Position.x[eid] = lng;
            Position.y[eid] = lat;
            Rotation.angle[eid] = c;
            Velocity.x[eid] = 0;
            Velocity.y[eid] = 0;
            break;
          case 2: // DestroyEntity
            // not implemented yet
            break;
          case 3: // SetVelocity
            // Interpret a as eid, b,c as vx,vy scaled 1e6
            const eidSet = a;
            if (eidSet !== undefined) {
              Velocity.x[eidSet] = b / 1e6;
              Velocity.y[eidSet] = c / 1e6;
            }
            break;
        }

        head = (head + 1) % CMD_CAPACITY;
        Atomics.store(cmdCtrl, 0, head);
      }
    }

    const ents = npcQuery(world);

    if (useSharedBuffer && ctrl && buffer) {
      const offset = writeIndex * floatsPerSnap;
      for (let i = 0; i < ents.length; i++) {
        const eid = ents[i];
        const base = offset + i * 3;
        buffer[base] = Position.x[eid];
        buffer[base + 1] = Position.y[eid];
        buffer[base + 2] = Rotation.angle[eid];
      }
      Atomics.store(ctrl, 0, writeIndex);
      Atomics.notify(ctrl, 0);
      writeIndex ^= 1; // toggle between 0 and 1
    } else {
      // Fallback copy-based path
      const snap = new Float32Array(ents.length * 3);
      for (let i = 0; i < ents.length; i++) {
        const eid = ents[i];
        snap[i * 3] = Position.x[eid];
        snap[i * 3 + 1] = Position.y[eid];
        snap[i * 3 + 2] = Rotation.angle[eid];
      }
      (self as any).postMessage(snap, [snap.buffer]);
    }
  }, DT_MS);
}; 