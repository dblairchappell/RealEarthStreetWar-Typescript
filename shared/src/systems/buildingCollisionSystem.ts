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
export const CHARACTER_RADIUS_DEG = 0.0000028;

/**
 * Velocity damping when colliding with buildings (0.0 to 1.0).
 * Higher values = entities slow down more when hitting buildings.
 */
export const BUILDING_VELOCITY_DAMPING = 0.5;

/**
 * Minimum push distance when resolving building collisions (in degrees).
 * Ensures entities are pushed far enough to avoid immediate re-collision.
 */
export const MIN_PUSH_DISTANCE_DEG = CHARACTER_RADIUS_DEG * 1.5;

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
        
        // Early exit: if distance to edge is less than collision radius, circle overlaps polygon
        if (dist < CHARACTER_RADIUS_DEG) {
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
      const dx = closestPoint[0] - lng;
      const dy = closestPoint[1] - lat;
      
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
 */
export async function buildingCollisionPreventSystem(
  entities: number[],
  buildingCollider: BuildingCollider,
  Position: { x: { [key: number]: number }; y: { [key: number]: number } },
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } },
  Altitude?: { value: { [key: number]: number } }
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
      
      // Check if entity would move (skip if velocity is zero)
      if (velX === 0 && velY === 0) {
        return;
      }
      
      const altitude = Altitude ? Altitude.value[eid] : 0;
      
      // First, check if entity is already colliding with a building
      // If so, zero out velocity to prevent further entry
      const currentBuilding = altitude > 0 && Altitude
        ? await buildingCollider.checkCollision3D(currentLng, currentLat, altitude)
        : await buildingCollider.checkCollision2D(currentLng, currentLat);
      
      if (currentBuilding) {
        // Entity is already inside or touching a building - stop movement
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
        return;
      }
      
      // Calculate intended position after movement
      const intendedLng = currentLng + velX;
      const intendedLat = currentLat + velY;

      // Check collision at intended position (2D or 3D based on Altitude component)
      const intendedBuilding = altitude > 0 && Altitude
        ? await buildingCollider.checkCollision3D(intendedLng, intendedLat, altitude)
        : await buildingCollider.checkCollision2D(intendedLng, intendedLat);
      
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
        // If sliding velocity is very small or would still collide, zero it out
        const slideSpeed = Math.sqrt(slide.slideX * slide.slideX + slide.slideY * slide.slideY);
        const originalSpeed = Math.sqrt(velX * velX + velY * velY);
        
        // If sliding speed is too small (< 10% of original), or if sliding would still collide, stop movement
        if (slideSpeed < originalSpeed * 0.1) {
          Velocity.x[eid] = 0;
          Velocity.y[eid] = 0;
        } else {
          // Check if sliding movement would still cause collision
          const slideLng = currentLng + slide.slideX;
          const slideLat = currentLat + slide.slideY;
          const slideBuilding = altitude > 0 && Altitude
            ? await buildingCollider.checkCollision3D(slideLng, slideLat, altitude)
            : await buildingCollider.checkCollision2D(slideLng, slideLat);
          
          if (slideBuilding) {
            // Sliding would still cause collision - stop movement completely
            Velocity.x[eid] = 0;
            Velocity.y[eid] = 0;
          } else {
            // Safe to slide - update velocity
            Velocity.x[eid] = slide.slideX;
            Velocity.y[eid] = slide.slideY;
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
 */
export async function buildingCollisionSystem(
  entities: number[],
  buildingCollider: BuildingCollider,
  Position: { x: { [key: number]: number }; y: { [key: number]: number } },
  Velocity: { x: { [key: number]: number }; y: { [key: number]: number } },
  Altitude?: { value: { [key: number]: number } }
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

      // Check collision (2D or 3D based on Altitude component)
      const building = altitude > 0 && Altitude
        ? await buildingCollider.checkCollision3D(lng, lat, altitude)
        : await buildingCollider.checkCollision2D(lng, lat);
      
      if (building) {
        // Find direction to push entity out (normal to wall)
        const pushDir = buildingCollider.findPushDirection(lng, lat, building);
        
        // Project velocity onto wall for sliding
        const slide = buildingCollider.projectOntoWall(
          Velocity.x[eid],
          Velocity.y[eid],
          pushDir.dx,
          pushDir.dy
        );
        
        // Update velocity to slide along wall
        Velocity.x[eid] = slide.slideX;
        Velocity.y[eid] = slide.slideY;
        
        // Push out completely to prevent overlap (push distance already accounts for collision radius)
        Position.x[eid] += pushDir.dx;
        Position.y[eid] += pushDir.dy;
      }
    }));
  }
}

