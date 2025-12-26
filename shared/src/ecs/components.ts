/**
 * ECS Components - Component definitions for the Entity Component System
 * 
 * These components define the data structure for entities. They are shared
 * between client and server, but each side maintains its own World instance
 * with separate storage arrays.
 * 
 * Note: The World instance itself is NOT shared - each side creates its own
 * via createWorld() from bitecs.
 */

import { defineComponent, Types } from 'bitecs';

/**
 * Position component: stores longitude (x) and latitude (y) in degrees.
 * Used for all entities (player, NPCs) to track their location on the map.
 */
export const Position = defineComponent({ x: Types.f64, y: Types.f64 }); // x = lng, y = lat

/**
 * Rotation component: stores rotation angle in degrees.
 * 0 = north, 90 = east, 180 = south, 270 = west
 */
export const Rotation = defineComponent({ angle: Types.f32 }); // degrees

/**
 * Velocity component: stores velocity in degrees per second.
 * Used for NPCs and player movement calculations.
 */
export const Velocity = defineComponent({ x: Types.f64, y: Types.f64 }); // units/second in degrees

/**
 * Altitude component: stores altitude/elevation in meters above ground level.
 * Used for flying entities and 3D collision detection with buildings.
 * Default is 0 (ground level).
 */
export const Altitude = defineComponent({ value: Types.f64 }); // meters above ground

/**
 * PlayerTag component: marker component to identify player entities.
 * Entities with this tag are treated as the player character.
 */
export const PlayerTag = defineComponent();

