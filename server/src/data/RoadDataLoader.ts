/**
 * RoadDataLoader - Loads road/transportation geometry from local PMTiles file
 * 
 * This class provides server-side access to road data stored in PMTiles format.
 * It reads from the local file system and extracts road/transportation line features
 * for NPC pathfinding and movement constraints.
 * 
 * All data is read from local PMTiles file - no remote sources required.
 */

import { PMTiles } from 'pmtiles';
import * as fs from 'fs';
import * as path from 'path';
import * as turf from '@turf/turf';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import type { Feature, LineString, Point } from 'geojson';

/**
 * Road feature with geometry and properties
 */
export interface RoadFeature {
  geometry: Feature<LineString>;
  properties: Record<string, any>;
  // OpenMapTiles properties: class (motorway, primary, secondary, etc.), subclass, etc.
}

/**
 * Node.js file source for PMTiles (reads from local filesystem)
 * Implements the source interface expected by PMTiles
 */
class NodeFileSource {
  private fd: number;
  private path: string;

  constructor(filePath: string) {
    this.path = path.resolve(filePath);
    if (!fs.existsSync(this.path)) {
      throw new Error(`PMTiles file not found: ${this.path}`);
    }
    // Open file for reading
    this.fd = fs.openSync(this.path, 'r');
  }

  getKey(): string {
    return this.path;
  }

  async getBytes(offset: number, length: number): Promise<{ data: ArrayBuffer }> {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.alloc(length);
      fs.read(this.fd, buffer, 0, length, offset, (err, bytesRead) => {
        if (err) {
          reject(err);
          return;
        }
        // Convert Node.js Buffer to ArrayBuffer
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
        resolve({ data: arrayBuffer });
      });
    });
  }

  close(): void {
    if (this.fd !== undefined) {
      fs.closeSync(this.fd);
    }
  }
}

/**
 * Road data loader for server-side PMTiles access
 */
export class RoadDataLoader {
  private pmtiles: PMTiles;
  private roadCache: Map<string, RoadFeature[]> = new Map();
  private fileSource: NodeFileSource;

  constructor(pmtilesPath: string) {
    // Resolve path relative to project root
    const resolvedPath = path.resolve(process.cwd(), pmtilesPath);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`PMTiles file not found at: ${resolvedPath}`);
    }
    
    // Create Node.js file source
    this.fileSource = new NodeFileSource(resolvedPath);
    
    // PMTiles accepts a source object directly
    this.pmtiles = new PMTiles(this.fileSource as any);
    
    console.log(`[RoadDataLoader] Initialized with PMTiles file: ${resolvedPath}`);
  }

  /**
   * Convert lat/lng to tile coordinates (z/x/y)
   */
  private latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number; z: number } {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y, z: zoom };
  }

  /**
   * Convert tile coordinates to bounding box
   */
  private tileToBBox(x: number, y: number, z: number): [number, number, number, number] {
    const n = Math.pow(2, z);
    const lon1 = (x / n) * 360 - 180;
    const lon2 = ((x + 1) / n) * 360 - 180;
    const lat1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    const lat2 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
    return [lon1, lat2, lon2, lat1]; // [minLng, minLat, maxLng, maxLat]
  }

  /**
   * Load roads from a specific tile (all data from local PMTiles file)
   */
  async loadRoadsFromTile(z: number, x: number, y: number): Promise<RoadFeature[]> {
    const key = `${z}/${x}/${y}`;
    
    // Check cache first
    if (this.roadCache.has(key)) {
      return this.roadCache.get(key)!;
    }

    try {
      // Query local PMTiles file for the tile
      const tile = await this.pmtiles.getZxy(z, x, y);
      if (!tile) {
        return [];
      }

      // Parse vector tile (MVT format) - all local, no network
      const vectorTile = new VectorTile(new Protobuf(tile.data));
      
      // OpenMapTiles uses 'transportation' layer for roads
      const transportationLayer = vectorTile.layers['transportation'];
      
      if (!transportationLayer) {
        return [];
      }

      const roads: RoadFeature[] = [];
      const tileBBox = this.tileToBBox(x, y, z);

      // Extract road features from the tile
      for (let i = 0; i < transportationLayer.length; i++) {
        const feature = transportationLayer.feature(i);
        const geometry = feature.loadGeometry();
        const props = feature.properties;
        
        // Filter for roads suitable for pedestrians (exclude motorways, railways, etc.)
        // OpenMapTiles class values: motorway, trunk, primary, secondary, tertiary, etc.
        const roadClass = props.class;
        if (!roadClass || roadClass === 'motorway' || roadClass === 'rail') {
          continue; // Skip motorways and railways
        }
        
        // Convert MVT geometry to GeoJSON LineString
        const coordinates: number[][] = [];
        for (const ring of geometry) {
          for (const point of ring) {
            // Convert tile-relative coordinates to lat/lng
            // MVT uses 4096 as tile extent
            const lng = tileBBox[0] + (point.x / 4096) * (tileBBox[2] - tileBBox[0]);
            const lat = tileBBox[3] - (point.y / 4096) * (tileBBox[3] - tileBBox[1]);
            coordinates.push([lng, lat]);
          }
        }

        if (coordinates.length >= 2) {
          const lineString = turf.lineString(coordinates);
          
          roads.push({
            geometry: lineString,
            properties: props,
          });
        }
      }

      this.roadCache.set(key, roads);
      return roads;
    } catch (error) {
      console.error(`[RoadDataLoader] Error loading tile ${key}:`, error);
      return [];
    }
  }

  /**
   * Get roads near a lat/lng point (loads relevant tiles from local file)
   */
  async getRoadsNearPoint(
    lat: number, 
    lng: number, 
    radiusDegrees: number = 0.0005 // ~55 meters at equator
  ): Promise<RoadFeature[]> {
    const zoom = 14; // Transportation layer minzoom is 12, use 14 for good detail
    
    // Calculate bounding box
    const bbox: [number, number, number, number] = [
      lng - radiusDegrees,
      lat - radiusDegrees,
      lng + radiusDegrees,
      lat + radiusDegrees,
    ];

    // Get tiles that cover this area
    const minTile = this.latLngToTile(bbox[1], bbox[0], zoom);
    const maxTile = this.latLngToTile(bbox[3], bbox[2], zoom);

    const roads: RoadFeature[] = [];

    // Load all tiles in the bounding box (from local file)
    for (let x = minTile.x; x <= maxTile.x; x++) {
      for (let y = minTile.y; y <= maxTile.y; y++) {
        const tileRoads = await this.loadRoadsFromTile(zoom, x, y);
        roads.push(...tileRoads);
      }
    }

    // Filter to roads actually near the search point
    const point = turf.point([lng, lat]);
    const searchRadius = turf.circle(point, radiusDegrees, { units: 'degrees' });
    
    return roads.filter(road => {
      // Check if road line is within search radius
      const nearestPoint = turf.nearestPointOnLine(road.geometry, point);
      const distance = turf.distance(point, nearestPoint, { units: 'degrees' });
      return distance <= radiusDegrees;
    });
  }

  /**
   * Check if a point is on or near a road/footpath
   * @param lat Latitude
   * @param lng Longitude
   * @param toleranceMeters Tolerance in meters (default: 5 meters)
   * @returns true if point is within tolerance of a road
   */
  async isOnRoad(lat: number, lng: number, toleranceMeters: number = 5): Promise<boolean> {
    // Convert meters to approximate degrees (rough conversion)
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(lat * Math.PI / 180);
    const toleranceDegrees = Math.max(
      toleranceMeters / metersPerDegreeLat,
      toleranceMeters / metersPerDegreeLng
    );
    
    const roads = await this.getRoadsNearPoint(lat, lng, toleranceDegrees * 2);
    if (roads.length === 0) {
      return false;
    }
    
    const point = turf.point([lng, lat]);
    
    // Check distance to nearest road
    for (const road of roads) {
      const nearestPoint = turf.nearestPointOnLine(road.geometry, point);
      const distanceMeters = turf.distance(point, nearestPoint, { units: 'meters' });
      if (distanceMeters <= toleranceMeters) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Find nearest road segment and return direction toward it
   * @param lat Latitude
   * @param lng Longitude
   * @returns Angle in degrees (0-360, 0 = north) and distance in meters, or null if no road found
   */
  async findNearestRoadDirection(lat: number, lng: number): Promise<{ angle: number; distance: number } | null> {
    const roads = await this.getRoadsNearPoint(lat, lng, 0.001); // ~110 meters
    if (roads.length === 0) {
      return null;
    }
    
    const point = turf.point([lng, lat]);
    let nearestDistance = Infinity;
    let nearestPoint: Feature<Point> | null = null;
    
    // Find the nearest point on any road
    for (const road of roads) {
      const roadNearest = turf.nearestPointOnLine(road.geometry, point);
      const distance = turf.distance(point, roadNearest, { units: 'meters' });
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPoint = roadNearest;
      }
    }
    
    if (!nearestPoint || nearestDistance === Infinity) {
      return null;
    }
    
    // Calculate bearing (direction) from current point to nearest road point
    const bearing = turf.bearing(point, nearestPoint.geometry.coordinates);
    // Convert bearing (-180 to 180) to game angle (0-360, 0 = north)
    const angle = ((bearing + 360) % 360);
    
    return { angle, distance: nearestDistance };
  }

  /**
   * Get road direction at a point (for aligning NPC movement with road direction)
   * @param lat Latitude
   * @param lng Longitude
   * @returns Road direction angle in degrees (0-360, 0 = north), or null if no road found
   */
  async getRoadDirection(lat: number, lng: number): Promise<number | null> {
    const roads = await this.getRoadsNearPoint(lat, lng, 0.0005); // ~55 meters
    if (roads.length === 0) {
      return null;
    }
    
    const point = turf.point([lng, lat]);
    let nearestDistance = Infinity;
    let nearestRoad: RoadFeature | null = null;
    let nearestPointOnRoad: Feature<Point> | null = null;
    
    // Find the nearest road segment
    for (const road of roads) {
      const roadNearest = turf.nearestPointOnLine(road.geometry, point);
      const distance = turf.distance(point, roadNearest, { units: 'meters' });
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestRoad = road;
        nearestPointOnRoad = roadNearest;
      }
    }
    
    if (!nearestRoad || !nearestPointOnRoad || nearestDistance > 10) {
      return null; // Too far from road
    }
    
    // Get the road segment direction by finding the segment containing the nearest point
    const coords = nearestRoad.geometry.geometry.coordinates;
    let segmentIndex = 0;
    let minDist = Infinity;
    
    // Find which segment of the road line is closest to the nearest point
    // We'll use the segment that contains the nearest point (or is closest to it)
    for (let i = 0; i < coords.length - 1; i++) {
      const segStart = turf.point(coords[i]);
      const segEnd = turf.point(coords[i + 1]);
      // Calculate distance from nearest point to this segment
      const segLine = turf.lineString([coords[i], coords[i + 1]]);
      const distToSegment = turf.pointToLineDistance(nearestPointOnRoad, segLine, { units: 'meters' });
      if (distToSegment < minDist) {
        minDist = distToSegment;
        segmentIndex = i;
      }
    }
    
    // Calculate bearing along the road segment
    const segStart = turf.point(coords[segmentIndex]);
    const segEnd = turf.point(coords[segmentIndex + 1]);
    const bearing = turf.bearing(segStart, segEnd);
    // Convert bearing (-180 to 180) to game angle (0-360, 0 = north)
    const angle = ((bearing + 360) % 360);
    
    return angle;
  }

  /**
   * Clear the road cache (useful for memory management)
   */
  clearCache(): void {
    this.roadCache.clear();
  }

  /**
   * Cleanup: close file handle
   */
  close(): void {
    this.fileSource.close();
  }
}

