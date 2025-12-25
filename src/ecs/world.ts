/**
 * Client World Instance
 * 
 * This file creates the client-side ECS world instance. Each side (client/server)
 * maintains its own World instance with separate storage arrays.
 * 
 * Component definitions (Position, Rotation, Velocity, etc.) are imported from
 * the shared package, but the World instance itself is created here.
 */

import { createWorld } from 'bitecs';
import { Position, Rotation, Velocity, PlayerTag } from '@shared/realearthstreetwar';
import { NpcTag, SpriteRef } from '@shared/realearthstreetwar';

// Create the client's world instance
export const world = createWorld();

// Re-export components for convenience (they're imported from shared package)
export { Position, Rotation, Velocity, PlayerTag };
export { NpcTag, SpriteRef };
