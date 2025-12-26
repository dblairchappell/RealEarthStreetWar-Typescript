/**
 * Building Collision System - Entity-to-Building Collision Detection and Resolution
 * 
 * This system detects and resolves collisions between entities (players and NPCs) and buildings.
 * It uses point-in-polygon checks to detect if entities are inside buildings, then pushes
 * them out to the nearest edge.
 * 
 * Supports both 2D (ground entities) and 3D (flying entities) collision detection.
 * 
 * Collision Response:
 * - Entities are pushed out of buildings along the shortest path to the building edge
 * - Velocity is dampened when colliding with buildings
 * - Uses Turf.js for point-in-polygon and distance calculations
 * 
 * Usage:
 * 
 * ```typescript
 * const buildingCollider = new BuildingCollider(buildingLoader);
 * buildingCollisionSystem(entities, buildingCollider, Position, Velocity, Altitude);
 * ```
 */

import * as turf from '@turf/turf';
import type { Feature, Polygon, Point } from 'geojson';

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
   */
  async checkCollision2D(
    lng: number, 
    lat: number
  ): Promise<BuildingFeature | null> {
    const buildings = await this.getBuildingsNearPointInternal(lat, lng, 0.001);
    const point = turf.point([lng, lat]);

    for (const building of buildings) {
      if (turf.booleanPointInPolygon(point, building.geometry)) {
        return building;
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
   * Returns the direction vector (dx, dy) to push the entity.
   */
  findPushDirection(
    lng: number,
    lat: number,
    building: BuildingFeature
  ): { dx: number; dy: number } {
    const point = turf.point([lng, lat]);
    const polygon = building.geometry.geometry;

    // Get building boundary (exterior ring)
    const coords = polygon.coordinates[0]; // First ring is exterior

    // Find closest point on building edge
    let minDist = Infinity;
    let closestPoint: Feature<Point> | null = null;

    for (let i = 0; i < coords.length - 1; i++) {
      const segmentStart = coords[i];
      const segmentEnd = coords[i + 1];
      const segment = turf.lineString([segmentStart, segmentEnd]);
      
      const nearestPoint = turf.nearestPointOnLine(segment, point);
      const dist = turf.distance(point, nearestPoint, { units: 'degrees' });

      if (dist < minDist) {
        minDist = dist;
        closestPoint = nearestPoint;
      }
    }

    if (closestPoint) {
      // Calculate direction vector from entity to nearest edge point
      const dx = closestPoint.geometry.coordinates[0] - lng;
      const dy = closestPoint.geometry.coordinates[1] - lat;
      
      // Normalize and scale by push distance
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        const pushDist = Math.max(minDist + MIN_PUSH_DISTANCE_DEG, MIN_PUSH_DISTANCE_DEG);
        return {
          dx: (dx / dist) * pushDist,
          dy: (dy / dist) * pushDist,
        };
      }
    }

    // Fallback: push north if we can't find a good direction
    return { dx: 0, dy: MIN_PUSH_DISTANCE_DEG };
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
 * Main building collision system.
 * Detects and resolves collisions between entities and buildings.
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
        
        // Still push out slightly to prevent getting stuck inside
        Position.x[eid] += pushDir.dx * 0.3;
        Position.y[eid] += pushDir.dy * 0.3;
      }
    }));
  }
}

