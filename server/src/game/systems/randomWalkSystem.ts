/**
 * Random Walk System - Server Version
 * 
 * Makes NPCs randomly change direction periodically.
 * Constrains NPCs to walk on roads/footpaths using a constraint-based approach.
 */

import { defineQuery, IWorld } from 'bitecs';
import { Position, Rotation, Velocity, NpcTag } from '@shared/realearthstreetwar';
import type { RoadDataLoader } from '../data/RoadDataLoader';

const BASE_SPEED = 0.000000225;    
const CHANGE_TIMER = 180;  

// Speed variation: each NPC gets a random multiplier between 0.7x and 1.3x
const MIN_SPEED_MULTIPLIER = 0.8;
const MAX_SPEED_MULTIPLIER = 1.9;

// Road constraint settings
const ROAD_CHECK_INTERVAL = 3; // Check road every N direction changes (to avoid performance hit)
const ROAD_TOLERANCE_METERS = 5; // How close NPC needs to be to a road (5 meters)

// Local timer per entity (sparse array)
const changeCounter: number[] = [];
// Final speed per entity (sparse array) - calculated once at spawn
const npcSpeed: number[] = [];
// Road check counter per entity (sparse array) - tracks when to check road
const roadCheckCounter: number[] = [];
// Cached road direction per entity (sparse array) - angle in degrees, or null
const cachedRoadDirection: (number | null)[] = [];
// Cached "on road" status per entity (sparse array) - true if on road, false if not
const cachedOnRoad: boolean[] = [];

// Road loader reference (set by GameWorld)
let roadLoader: RoadDataLoader | null = null;

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

/**
 * Set road loader reference (called by GameWorld)
 */
export function setRoadLoader(loader: RoadDataLoader | null): void {
  roadLoader = loader;
}

/**
 * Clean up NPC data when entity is removed
 * This prevents memory leaks from accumulating in sparse arrays
 * 
 * @param eid - Entity ID to clean up
 */
export function cleanupNpcData(eid: number): void {
  delete changeCounter[eid];
  delete npcSpeed[eid];
  delete roadCheckCounter[eid];
  delete cachedRoadDirection[eid];
  delete cachedOnRoad[eid];
}

/**
 * Choose a new direction for an NPC, constrained to roads if road loader is available
 */
async function chooseConstrainedDirection(eid: number, lat: number, lng: number): Promise<number> {
  if (!roadLoader) {
    // No road loader - use random direction
    return Math.random() * 360;
  }
  
  // Check if we need to update road status (periodic check to avoid performance hit)
  roadCheckCounter[eid] = (roadCheckCounter[eid] || 0) + 1;
  const needsRoadCheck = (roadCheckCounter[eid] % ROAD_CHECK_INTERVAL) === 0;
  
  if (needsRoadCheck) {
    // Update cached road status
    try {
      cachedOnRoad[eid] = await roadLoader.isOnRoad(lat, lng, ROAD_TOLERANCE_METERS);
      
      if (cachedOnRoad[eid]) {
        // On road - get road direction for alignment
        const roadDir = await roadLoader.getRoadDirection(lat, lng);
        cachedRoadDirection[eid] = roadDir;
      } else {
        // Not on road - find direction toward nearest road
        const nearestRoad = await roadLoader.findNearestRoadDirection(lat, lng);
        if (nearestRoad) {
          cachedRoadDirection[eid] = nearestRoad.angle;
        } else {
          cachedRoadDirection[eid] = null;
        }
      }
    } catch (error) {
      // If road check fails, fall back to random direction
      console.error(`[randomWalkSystem] Error checking road for NPC ${eid}:`, error);
      cachedOnRoad[eid] = false;
      cachedRoadDirection[eid] = null;
    }
  }
  
  const isOnRoad = cachedOnRoad[eid] ?? false;
  const roadDir = cachedRoadDirection[eid];
  
  if (isOnRoad && roadDir !== null) {
    // On road - prefer directions aligned with road (with some randomness)
    // Bias toward road direction ± 45 degrees
    const roadDirRad = (roadDir * Math.PI) / 180;
    const biasAngle = roadDirRad + (Math.random() - 0.5) * (Math.PI / 2); // ±45 degrees
    const gameAngleDeg = ((biasAngle * 180) / Math.PI + 360) % 360;
    return gameAngleDeg;
  } else if (roadDir !== null) {
    // Not on road but we know direction to nearest road - bias toward it
    // Add some randomness so NPCs don't all move in exact same direction
    const roadDirRad = (roadDir * Math.PI) / 180;
    const biasAngle = roadDirRad + (Math.random() - 0.5) * (Math.PI / 3); // ±60 degrees
    const gameAngleDeg = ((biasAngle * 180) / Math.PI + 360) % 360;
    return gameAngleDeg;
  } else {
    // No road information available - use random direction
    return Math.random() * 360;
  }
}

export async function randomWalkSystem(world: IWorld): Promise<void> {
  const ents = npcQuery(world);
  
  // Collect NPCs that need direction changes
  const npcsNeedingUpdate: Array<{ eid: number; lat: number; lng: number }> = [];
  
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    
    changeCounter[eid] = (changeCounter[eid] || 0) - 1;
    if (changeCounter[eid] <= 0) {
      changeCounter[eid] = Math.floor(Math.random() * CHANGE_TIMER) + CHANGE_TIMER;
      npcsNeedingUpdate.push({
        eid,
        lat: Position.y[eid],
        lng: Position.x[eid],
      });
    }
  }
  
  // Batch road checks for all NPCs that need updates
  const directionPromises = npcsNeedingUpdate.map(({ eid, lat, lng }) => 
    chooseConstrainedDirection(eid, lat, lng)
  );
  
  // Wait for all direction choices (they run in parallel)
  const directions = await Promise.all(directionPromises);
  
  // Apply directions to NPCs
  for (let i = 0; i < npcsNeedingUpdate.length; i++) {
    const { eid } = npcsNeedingUpdate[i];
    const gameAngleDeg = directions[i];
    
    Rotation.angle[eid] = gameAngleDeg; // Store directly in game coordinates
    
    // Convert to radians (still in game coordinates)
    const radians = (gameAngleDeg * Math.PI) / 180;
    
    // Use same formula as player: sin for lat/y, cos for lng/x
    // This converts from game coordinates (0° = north) to movement direction
    Velocity.x[eid] = Math.cos(radians) * (npcSpeed[eid] || BASE_SPEED);
    Velocity.y[eid] = Math.sin(radians) * (npcSpeed[eid] || BASE_SPEED);
  }
}

