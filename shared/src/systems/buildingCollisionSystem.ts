/**
 * Building Collision System - Entity-to-Building Collision Detection and Resolution
 * 
 * This system detects and resolves collisions between entities (players and NPCs) and buildings.
 * It uses circle-polygon intersection checks to detect if entities' collision circles overlap
 * with buildings, preventing any part of the sprite from overlapping building footprints.
 * 
 * Supports both 2D (ground entities) and 3D (flying entities) collision detection.
 * 
 * Collision Response:
 * - Entities are pushed out of buildings along the shortest path to the building edge
 * - Ensures the entity's collision circle no longer overlaps the building polygon
 * - Velocity is dampened when colliding with buildings
 * - Uses optimized point-in-polygon and distance calculations
 * 
 * Usage:
 * 
 * ```typescript
 * const buildingCollider = new BuildingCollider(buildingLoader);
 * buildingCollisionSystem(entities, buildingCollider, Position, Velocity, Altitude);
 * ```
 */

import type { Feature, Polygon } from 'geojson';

/**
 * Character collision radius in degrees (same as entity collision system).
 * Used to create a buffer around entities for building collision detection.
 */
export const CHARACTER_RADIUS_DEG = 0.0000002;

/**
 * Velocity damping when colliding with buildings (0.0 to 1.0).
 * Higher values = entities slow down more when hitting buildings.
 */
export const BUILDING_VELOCITY_DAMPING = 0.5;

/**
 * Minimum push distance when resolving building collisions (in degrees).
 * Ensures entities are pushed far enough to avoid immediate re-collision.
 */
export const MIN_PUSH_DISTANCE_DEG = CHARACTER_RADIUS_DEG * 0.1;

/**
 * Additional buffer around building boundaries (in degrees).
 * Makes buildings effectively larger for collision detection.
 * This prevents entities from getting too close to building edges.
 */
export const BUILDING_BUFFER_DEG = 0.000005; // ~0.11 meters at equator

/**
 * Base NPC speed constant (matches server-side BASE_SPEED).
 * Used when calculating new direction after collision.
 */
const BASE_NPC_SPEED = 0.000000225;

/**
 * Simple point-in-polygon check using ray casting algorithm.
 * Faster than Turf.js booleanPointInPolygon.
 */
function pointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
                     (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Building feature interface (matches BuildingDataLoader)
 */
export type BuildingFeature = {
  geometry: Feature<Polygon>;
  height?: number;        // render_height in meters
  minHeight?: number;     // render_min_height in meters
  properties: Record<string, any>;
};

/**
 * Building Collider - Manages building geometry and collision queries
 * 
 * This is a thin wrapper around BuildingDataLoader that provides collision
 * detection methods. The actual building data loading is handled by BuildingDataLoader
 * on the server side.
 */
export class BuildingCollider {
  /**
   * Get buildings near a point (delegates to BuildingDataLoader)
   * This method signature matches what BuildingDataLoader provides
   */
  getBuildingsNearPoint?: (
    lat: number,
    lng: number,
    radiusDegrees?: number
  ) => Promise<BuildingFeature[]>;

  /**
   * Cache for recently queried buildings (key: "lat,lng", value: buildings)
   */
  private buildingCache: Map<string, BuildingFeature[]> = new Map();
  private cacheTimeout = 1000; // Cache for 1 second
  private cacheTimestamps: Map<string, number> = new Map();

  constructor(
    getBuildingsNearPoint?: (
      lat: number,
      lng: number,
      radiusDegrees?: number
    ) => Promise<BuildingFeature[]>
  ) {
    this.getBuildingsNearPoint = getBuildingsNearPoint;
  }

  /**
   * Check collision with 2D polygon (for ground entities)
   * Uses circle-polygon collision detection to check if the entity's collision circle
   * overlaps with the building polygon, preventing sprite overlap.
   * 
   * Checks two conditions:
   * 1. If entity center is inside building (point-in-polygon)
   * 2. If entity center is within collision radius of building edge (circle-polygon overlap)
   */
  async checkCollision2D(
    lng: number, 
    lat: number
  ): Promise<BuildingFeature | null> {
    const buildings = await this.getBuildingsNearPointInternal(lat, lng, 0.001);

    for (const building of buildings) {
      const polygon = building.geometry.geometry;
      const coords = polygon.coordinates[0]; // Exterior ring
      
      // Check if entity center is inside building (using optimized point-in-polygon)
      if (pointInPolygon(lng, lat, coords)) {
        return building;
      }
      
      // Check if entity's collision circle overlaps building edge
      // Find distance from entity to nearest point on building boundary
      for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const segDx = p2[0] - p1[0];
        const segDy = p2[1] - p1[1];
        const len2 = segDx * segDx + segDy * segDy;
        
        if (len2 === 0) continue;

        // Project point onto line segment
        const t = Math.max(0, Math.min(1,
          ((lng - p1[0]) * segDx + (lat - p1[1]) * segDy) / len2
        ));
        
        const projLng = p1[0] + t * segDx;
        const projLat = p1[1] + t * segDy;
        const dist = Math.sqrt((projLng - lng) ** 2 + (projLat - lat) ** 2);
        
        // Early exit: if distance to edge is less than effective radius (includes buffer), circle overlaps polygon
        const effectiveRadius = CHARACTER_RADIUS_DEG + BUILDING_BUFFER_DEG;
        if (dist < effectiveRadius) {
          return building;
        }
      }
    }

    return null;
  }

  /**
   * Check collision with 3D building (for flying entities)
   */
  async checkCollision3D(
    lng: number,
    lat: number,
    altitude: number // altitude in meters
  ): Promise<BuildingFeature | null> {
    const building = await this.checkCollision2D(lng, lat);
    
    if (!building) {
      return null;
    }

    // Check if entity altitude is within building height range
    const buildingBase = building.minHeight || 0;
    const buildingTop = building.height || 8; // Default 8m if no height data
    
    if (altitude >= buildingBase && altitude <= buildingTop) {
      return building;
    }

    return null;
  }

  /**
   * Find the nearest point on the building edge to push the entity out.
   * Returns the direction vector (dx, dy) to push the entity far enough so
   * the collision circle no longer overlaps the building polygon.
   */
  findPushDirection(
    lng: number,
    lat: number,
    building: BuildingFeature
  ): { dx: number; dy: number } {
    const polygon = building.geometry.geometry;
    const coords = polygon.coordinates[0]; // First ring is exterior

    // Check if entity is inside the building polygon
    const isInside = pointInPolygon(lng, lat, coords);

    // Find closest point on building edge
    let minDist = Infinity;
    let closestPoint: [number, number] | null = null;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const segDx = p2[0] - p1[0];
      const segDy = p2[1] - p1[1];
      const len2 = segDx * segDx + segDy * segDy;
      
      if (len2 === 0) continue;

      // Project point onto line segment
      const t = Math.max(0, Math.min(1,
        ((lng - p1[0]) * segDx + (lat - p1[1]) * segDy) / len2
      ));
      
      const projLng = p1[0] + t * segDx;
      const projLat = p1[1] + t * segDy;
      const dist = Math.sqrt((projLng - lng) ** 2 + (projLat - lat) ** 2);

      if (dist < minDist) {
        minDist = dist;
        closestPoint = [projLng, projLat];
      }
    }

    if (closestPoint) {
      // Calculate direction vector from entity to nearest edge point
      let dx = closestPoint[0] - lng;
      let dy = closestPoint[1] - lat;
      
      // If entity is OUTSIDE the building, reverse direction to push AWAY from building
      if (!isInside) {
        dx = -dx;
        dy = -dy;
      }
      
      // Normalize and scale by push distance
      // Push far enough so the collision circle no longer overlaps the building
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        // Push distance = distance to edge + collision radius + buffer
        // This ensures the entity's collision circle is completely outside the building
        const pushDist = minDist + CHARACTER_RADIUS_DEG + MIN_PUSH_DISTANCE_DEG;
        return {
          dx: (dx / dist) * pushDist,
          dy: (dy / dist) * pushDist,
        };
      }
    }

    // Fallback: push north if we can't find a good direction
    return { dx: 0, dy: CHARACTER_RADIUS_DEG + MIN_PUSH_DISTANCE_DEG };
  }

  /**
   * Project velocity/movement onto wall surface for sliding.
   * Takes the push direction (normal to wall) and projects movement onto the wall.
   */
  projectOntoWall(
    velX: number,
    velY: number,
    pushDx: number,
    pushDy: number
  ): { slideX: number; slideY: number } {
    // Normalize push direction to get wall normal
    const pushLen = Math.sqrt(pushDx * pushDx + pushDy * pushDy);
    if (pushLen === 0) {
      return { slideX: velX, slideY: velY }; // No wall direction, keep original
    }
    
    const normalX = pushDx / pushLen;
    const normalY = pushDy / pushLen;
    
    // Wall direction is perpendicular to normal (rotate 90 degrees)
    const wallDirX = -normalY;  // Rotate normal 90° counterclockwise
    const wallDirY = normalX;
    
    // Project velocity onto wall direction (dot product)
    const dotProduct = velX * wallDirX + velY * wallDirY;
    
    return {
      slideX: wallDirX * dotProduct,
      slideY: wallDirY * dotProduct
    };
  }

  /**
   * Internal method to get buildings with caching
   */
  private async getBuildingsNearPointInternal(
    lat: number,
    lng: number,
    radius: number
  ): Promise<BuildingFeature[]> {
    if (!this.getBuildingsNearPoint) {
      return [];
    }

    // Check cache first
    const cacheKey = `${Math.floor(lat * 10000)}/${Math.floor(lng * 10000)}`;
    const now = Date.now();
    const cached = this.buildingCache.get(cacheKey);
    const timestamp = this.cacheTimestamps.get(cacheKey);

    if (cached && timestamp && (now - timestamp) < this.cacheTimeout) {
      return cached;
    }

    // Load from BuildingDataLoader
    const buildings = await this.getBuildingsNearPoint(lat, lng, radius);
    
    // Update cache
    this.buildingCache.set(cacheKey, buildings);
    this.cacheTimestamps.set(cacheKey, now);

    return buildings;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.buildingCache.clear();
    this.cacheTimestamps.clear();
  }
}

/**
 * Helper function to check collision (2D or 3D) based on altitude
 */
function checkCollision(
  buildingCollider: BuildingCollider,
  lng: number,
  lat: number,
  altitude: number,
  hasAltitude: boolean
): Promise<BuildingFeature | null> {
  return hasAltitude && altitude > 0
    ? buildingCollider.checkCollision3D(lng, lat, altitude)
    : buildingCollider.checkCollision2D(lng, lat);
}

/**
 * Helper function to change NPC direction away from a building.
 * Calculates a new direction based on the push direction (away from building)
 * with random variation for natural movement.
 * 
 * @param eid - Entity ID
 * @param pushDir - Push direction vector (dx, dy) away from building
 * @param originalSpeed - Original speed before collision (to preserve NPC speed)
 * @param Velocity - Velocity component to update
 * @param Rotation - Optional rotation component to update
 */
function changeDirectionAwayFromBuilding(
  eid: number,
  pushDir: { dx: number; dy: number },
  originalSpeed: number,
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } },
  Rotation?: { angle: { [key: number]: number } }
): void {
  // Normalize push direction to get angle away from building
  const pushLen = Math.sqrt(pushDir.dx * pushDir.dx + pushDir.dy * pushDir.dy);
  
  if (pushLen > 0) {
    // Calculate angle away from building
    // pushDir is a direction vector: (dx, dy) where dx is lng (east-west), dy is lat (north-south)
    // We want to calculate the game angle where 0° = north
    // 
    // In game coordinates: 0° = north, 90° = east
    // atan2(dx, dy) gives: 0° when (dx=0, dy=1) = north, 90° when (dx=1, dy=0) = east
    const gameAngleRad = Math.atan2(pushDir.dx, pushDir.dy);
    
    // Add randomness (±60 degrees) for natural variation
    const randomOffset = (Math.random() - 0.5) * (Math.PI / 1.5); // ±60 degrees
    const finalGameAngleRad = gameAngleRad + randomOffset;
    
    // Convert to degrees for storage
    let gameAngleDeg = (finalGameAngleRad * 180) / Math.PI;
    if (gameAngleDeg < 0) gameAngleDeg += 360;
    
    // Use original speed if available, otherwise use base NPC speed
    const speed = originalSpeed > 0 ? originalSpeed : BASE_NPC_SPEED;
    
    // Set velocity using same formula as randomWalkSystem
    // gameAngleDeg is in game coordinates (0° = north), convert to radians
    const radians = (gameAngleDeg * Math.PI) / 180;
    Velocity.x[eid] = Math.cos(radians) * speed;
    Velocity.y[eid] = Math.sin(radians) * speed;
    
    // Set rotation to match velocity direction (matching randomWalkSystem)
    if (Rotation) {
      Rotation.angle[eid] = gameAngleDeg;
    }
  } else {
    // Fallback: random direction if push direction is invalid
    const randomAngle = Math.random() * Math.PI * 2;
    const speed = originalSpeed > 0 ? originalSpeed : BASE_NPC_SPEED;
    Velocity.x[eid] = Math.cos(randomAngle) * speed;
    Velocity.y[eid] = Math.sin(randomAngle) * speed;
    
    if (Rotation) {
      // Calculate rotation from velocity direction (matching randomWalkSystem logic)
      const velX = Velocity.x[eid];
      const velY = Velocity.y[eid];
      const gameAngleRad = Math.atan2(velX, velY);
      let gameAngleDeg = (gameAngleRad * 180) / Math.PI;
      if (gameAngleDeg < 0) gameAngleDeg += 360;
      Rotation.angle[eid] = gameAngleDeg;
    }
  }
}

/**
 * Pre-movement building collision check.
 * Checks intended positions (current + velocity) and adjusts velocity to prevent
 * movement into buildings. This prevents entities from entering buildings before
 * being corrected.
 * 
 * @param entities - Array of entity IDs to check for collisions
 * @param buildingCollider - BuildingCollider instance with loaded building data
 * @param Position - Position component from ECS world
 * @param Velocity - Velocity component from ECS world (will be modified to prevent collisions)
 * @param Altitude - Optional altitude component for 3D collision (if null, uses 2D)
 * @param Rotation - Optional rotation component (if provided, will update rotation when changing direction)
 * @param NpcTag - Optional NpcTag component (if provided, only NPCs will change direction; players will slide)
 */
export async function buildingCollisionPreventSystem(
  entities: number[],
  buildingCollider: BuildingCollider,
  Position: { x: { [key: number]: number }; y: { [key: number]: number } },
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } },
  Altitude?: { value: { [key: number]: number } },
  Rotation?: { angle: { [key: number]: number } },
  NpcTag?: any // Marker component - check with NpcTag[eid] !== undefined
): Promise<void> {
  // Process entities in batches to avoid blocking
  const batchSize = 10;
  
  for (let i = 0; i < entities.length; i += batchSize) {
    const batch = entities.slice(i, i + batchSize);
    
    // Process batch in parallel
    await Promise.all(batch.map(async (eid) => {
      const currentLng = Position.x[eid];
      const currentLat = Position.y[eid];
      const velX = Velocity.x[eid];
      const velY = Velocity.y[eid];
      const currentSpeed = Math.sqrt(velX * velX + velY * velY);
      
      const altitude = Altitude ? Altitude.value[eid] : 0;
      const hasAltitude = !!Altitude;
      
      // First, check if entity is already colliding with a building
      // If so, push it out and change direction if velocity is zero or too low
      const currentBuilding = await checkCollision(
        buildingCollider,
        currentLng,
        currentLat,
        altitude,
        hasAltitude
      );
      
      if (currentBuilding) {
        // Entity is already inside or touching a building - push it out
        const pushDir = buildingCollider.findPushDirection(currentLng, currentLat, currentBuilding);
        
        // Push entity out immediately
        Position.x[eid] += pushDir.dx;
        Position.y[eid] += pushDir.dy;
        
        // Check if entity is an NPC
        const isNpc = NpcTag ? NpcTag[eid] !== undefined : false;
        
        // If velocity is zero or very low, change direction away from building (NPCs only)
        if (currentSpeed < 0.00000001) {
          if (isNpc && Rotation) {
            // NPC is stuck - give it a new direction away from building
            changeDirectionAwayFromBuilding(eid, pushDir, BASE_NPC_SPEED, Velocity, Rotation);
          }
          // Players with zero velocity will remain stopped (handled by player movement system)
          return;
        }
        
        // Project velocity onto wall for sliding (so entity can escape along the wall)
        const slide = buildingCollider.projectOntoWall(
          velX,
          velY,
          pushDir.dx,
          pushDir.dy
        );
        
        const slideSpeed = Math.sqrt(slide.slideX * slide.slideX + slide.slideY * slide.slideY);
        const dampedSlideSpeed = slideSpeed * BUILDING_VELOCITY_DAMPING;
        const MIN_MOVEMENT_SPEED = BASE_NPC_SPEED //* 0.7; // Minimum speed to consider valid movement (increased threshold)
        
        // NPCs: Change direction if sliding speed is too low
        // Players: Always slide (original behavior)
        if (isNpc && Rotation && (dampedSlideSpeed < currentSpeed * 0.3 || dampedSlideSpeed < MIN_MOVEMENT_SPEED)) {
          // NPC sliding too slowly - change direction away from building
          changeDirectionAwayFromBuilding(eid, pushDir, currentSpeed > 0 ? currentSpeed : BASE_NPC_SPEED, Velocity, Rotation);
        } else {
          // Update velocity to slide along wall with damping (for both players and NPCs)
          Velocity.x[eid] = slide.slideX * BUILDING_VELOCITY_DAMPING;
          Velocity.y[eid] = slide.slideY * BUILDING_VELOCITY_DAMPING;
        }
        
        return;
      }
      
      // If velocity is zero, check for nearby buildings (NPCs only)
      // This handles NPCs that got stuck but aren't currently colliding
      if (velX === 0 && velY === 0) {
        const isNpc = NpcTag ? NpcTag[eid] !== undefined : false;
        if (isNpc && Rotation) {
          // Check if NPC is very close to a building (might be stuck)
          const nearbyCheckRadius = CHARACTER_RADIUS_DEG * 5;
          const nearbyBuilding = await checkCollision(
            buildingCollider,
            currentLng + nearbyCheckRadius,
            currentLat,
            altitude,
            hasAltitude
          ) || await checkCollision(
            buildingCollider,
            currentLng - nearbyCheckRadius,
            currentLat,
            altitude,
            hasAltitude
          ) || await checkCollision(
            buildingCollider,
            currentLng,
            currentLat + nearbyCheckRadius,
            altitude,
            hasAltitude
          ) || await checkCollision(
            buildingCollider,
            currentLng,
            currentLat - nearbyCheckRadius,
            altitude,
            hasAltitude
          );
          
          if (nearbyBuilding) {
            // Found nearby building - change direction away from it
            const pushDir = buildingCollider.findPushDirection(currentLng, currentLat, nearbyBuilding);
            changeDirectionAwayFromBuilding(eid, pushDir, BASE_NPC_SPEED, Velocity, Rotation);
            return;
          }
        }
        return;
      }
      
      // Calculate intended position after movement
      const intendedLng = currentLng + velX;
      const intendedLat = currentLat + velY;

      // Check collision at intended position (2D or 3D based on Altitude component)
      const intendedBuilding = await checkCollision(
        buildingCollider,
        intendedLng,
        intendedLat,
        altitude,
        hasAltitude
      );
      
      if (intendedBuilding) {
        // Movement would cause collision - project velocity onto wall for sliding
        const pushDir = buildingCollider.findPushDirection(intendedLng, intendedLat, intendedBuilding);
        
        // Project velocity onto wall for sliding
        const slide = buildingCollider.projectOntoWall(
          velX,
          velY,
          pushDir.dx,
          pushDir.dy
        );
        
        // Check if sliding would still cause collision
        // NPCs: Change direction if sliding speed is too small
        // Players: Always slide (original behavior)
        const slideSpeed = Math.sqrt(slide.slideX * slide.slideX + slide.slideY * slide.slideY);
        const originalSpeed = Math.sqrt(velX * velX + velY * velY);
        const MIN_MOVEMENT_SPEED = BASE_NPC_SPEED * 0.4; // Minimum speed to consider valid movement (increased threshold)
        const isNpc = NpcTag ? NpcTag[eid] !== undefined : false;
        
        // NPCs: Change direction if sliding speed is too small
        // Players: Always try to slide
        if (isNpc && Rotation && (slideSpeed < originalSpeed * 0.3 || slideSpeed < MIN_MOVEMENT_SPEED)) {
          // NPC sliding too slowly - change direction away from building
          changeDirectionAwayFromBuilding(eid, pushDir, originalSpeed > 0 ? originalSpeed : BASE_NPC_SPEED, Velocity, Rotation);
        } else {
          // Check if sliding movement would still cause collision
          const slideLng = currentLng + slide.slideX;
          const slideLat = currentLat + slide.slideY;
          const slideBuilding = await checkCollision(
            buildingCollider,
            slideLng,
            slideLat,
            altitude,
            hasAltitude
          );
          
          if (slideBuilding) {
            // Sliding would still cause collision
            if (isNpc && Rotation) {
              // NPC: Change direction away from building
              const slidePushDir = buildingCollider.findPushDirection(slideLng, slideLat, slideBuilding);
              changeDirectionAwayFromBuilding(eid, slidePushDir, originalSpeed, Velocity, Rotation);
            } else {
              // Player: Stop movement (handled by player movement system)
              Velocity.x[eid] = 0;
              Velocity.y[eid] = 0;
            }
          } else {
            // Safe to slide - update velocity with damping (for both players and NPCs)
            Velocity.x[eid] = slide.slideX * BUILDING_VELOCITY_DAMPING;
            Velocity.y[eid] = slide.slideY * BUILDING_VELOCITY_DAMPING;
          }
        }
      }
    }));
  }
}

/**
 * Main building collision system.
 * Detects and resolves collisions between entities and buildings.
 * This is a corrective system that runs AFTER movement to fix any entities
 * that are already inside buildings (shouldn't happen if preventSystem runs first).
 * 
 * Supports both 2D (ground) and 3D (flying) collision detection.
 * 
 * @param entities - Array of entity IDs to check for collisions
 * @param buildingCollider - BuildingCollider instance with loaded building data
 * @param Position - Position component from ECS world
 * @param Velocity - Velocity component from ECS world
 * @param Altitude - Optional altitude component for 3D collision (if null, uses 2D)
 * @param Rotation - Optional rotation component (if provided, will update rotation when changing direction)
 * @param NpcTag - Optional NpcTag component (if provided, only NPCs will change direction; players will slide)
 */
export async function buildingCollisionSystem(
  entities: number[],
  buildingCollider: BuildingCollider,
  Position: { x: { [key: number]: number }; y: { [key: number]: number } },
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } },
  Altitude?: { value: { [key: number]: number } },
  Rotation?: { angle: { [key: number]: number } },
  NpcTag?: any // Marker component - check with NpcTag[eid] !== undefined
): Promise<void> {
  // Process entities in batches to avoid blocking
  const batchSize = 10;
  
  for (let i = 0; i < entities.length; i += batchSize) {
    const batch = entities.slice(i, i + batchSize);
    
    // Process batch in parallel
    await Promise.all(batch.map(async (eid) => {
      const lng = Position.x[eid];
      const lat = Position.y[eid];
      const altitude = Altitude ? Altitude.value[eid] : 0;
      const hasAltitude = !!Altitude;

      // Get current velocity first
      const velX = Velocity.x[eid];
      const velY = Velocity.y[eid];
      const currentSpeed = Math.sqrt(velX * velX + velY * velY);
      
      // Check collision (2D or 3D based on Altitude component)
      const building = await checkCollision(
        buildingCollider,
        lng,
        lat,
        altitude,
        hasAltitude
      );
      
      if (building) {
        // Find direction to push entity out (normal to wall)
        const pushDir = buildingCollider.findPushDirection(lng, lat, building);
        
        // Check if entity is an NPC
        const isNpc = NpcTag ? NpcTag[eid] !== undefined : false;
        
        // If velocity is zero or very low, change direction immediately (NPCs only)
        if (currentSpeed < 0.00000001) {
          if (isNpc && Rotation) {
            // NPC is stuck - give it a new direction away from building
            changeDirectionAwayFromBuilding(eid, pushDir, BASE_NPC_SPEED, Velocity, Rotation);
          }
          // Players with zero velocity will remain stopped (handled by player movement system)
          return;
        }
        
        // Project velocity onto wall for sliding
        const slide = buildingCollider.projectOntoWall(
          velX,
          velY,
          pushDir.dx,
          pushDir.dy
        );
        
        // Apply damping and check if sliding speed is too low
        const slideSpeed = Math.sqrt(slide.slideX * slide.slideX + slide.slideY * slide.slideY);
        const dampedSlideSpeed = slideSpeed * BUILDING_VELOCITY_DAMPING;
        const MIN_MOVEMENT_SPEED = BASE_NPC_SPEED * 0.4; // Minimum speed to consider valid movement (increased threshold)
        
        // NPCs: Change direction if sliding speed after damping is too low
        // Players: Always slide (original behavior)
        if (isNpc && Rotation && (dampedSlideSpeed < currentSpeed * 0.3 || dampedSlideSpeed < MIN_MOVEMENT_SPEED)) {
          // NPC sliding too slowly - change direction away from building
          changeDirectionAwayFromBuilding(eid, pushDir, currentSpeed > 0 ? currentSpeed : BASE_NPC_SPEED, Velocity, Rotation);
        } else {
          // Update velocity to slide along wall with damping (for both players and NPCs)
          Velocity.x[eid] = slide.slideX * BUILDING_VELOCITY_DAMPING;
          Velocity.y[eid] = slide.slideY * BUILDING_VELOCITY_DAMPING;
        }
      } else if (currentSpeed < 0.00000001) {
        // NPC is stuck but not colliding - might be right next to building
        // Only check for NPCs, not players
        const isNpc = NpcTag ? NpcTag[eid] !== undefined : false;
        if (isNpc && Rotation) {
          // Check a few nearby positions to see if there's a building close by
          const checkRadius = CHARACTER_RADIUS_DEG * 3;
          const checkPositions = [
            [lng + checkRadius, lat],
            [lng - checkRadius, lat],
            [lng, lat + checkRadius],
            [lng, lat - checkRadius],
          ];
          
          for (const [checkLng, checkLat] of checkPositions) {
            const nearbyBuilding = await checkCollision(
              buildingCollider,
              checkLng,
              checkLat,
              altitude,
              hasAltitude
            );
            
            if (nearbyBuilding) {
              // Found a nearby building - change direction away from it
              const pushDir = buildingCollider.findPushDirection(lng, lat, nearbyBuilding);
              changeDirectionAwayFromBuilding(eid, pushDir, BASE_NPC_SPEED, Velocity, Rotation);
              break;
            }
          }
        }
      }
    }));
  }
}

