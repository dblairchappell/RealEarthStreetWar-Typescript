/**
 * BuildingDataLoader - Loads building geometry from local PMTiles file
 * 
 * This class provides server-side access to building data stored in PMTiles format.
 * It reads from the local file system and extracts building polygons with height data
 * for collision detection.
 * 
 * All data is read from local PMTiles file - no remote sources required.
 */

import { PMTiles } from 'pmtiles';
import * as fs from 'fs';
import * as path from 'path';
import * as turf from '@turf/turf';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import type { Feature, Polygon } from 'geojson';

/**
 * Building feature with geometry and height information
 */
export interface BuildingFeature {
  geometry: Feature<Polygon>;
  height?: number;        // render_height in meters
  minHeight?: number;     // render_min_height in meters
  properties: Record<string, any>;
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
 * Building data loader for server-side PMTiles access
 */
export class BuildingDataLoader {
  private pmtiles: PMTiles;
  private buildingCache: Map<string, BuildingFeature[]> = new Map();
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
    
    console.log(`[BuildingDataLoader] Initialized with PMTiles file: ${resolvedPath}`);
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
   * Load buildings from a specific tile (all data from local PMTiles file)
   */
  async loadBuildingsFromTile(z: number, x: number, y: number): Promise<BuildingFeature[]> {
    const key = `${z}/${x}/${y}`;
    
    // Check cache first
    if (this.buildingCache.has(key)) {
      return this.buildingCache.get(key)!;
    }

    try {
      // Query local PMTiles file for the tile
      const tile = await this.pmtiles.getZxy(z, x, y);
      if (!tile) {
        return [];
      }

      // Parse vector tile (MVT format) - all local, no network
      const vectorTile = new VectorTile(new Protobuf(tile.data));
      const buildingLayer = vectorTile.layers['building'];
      
      if (!buildingLayer) {
        return [];
      }

      const buildings: BuildingFeature[] = [];
      const tileBBox = this.tileToBBox(x, y, z);

      // Extract building features from the tile
      for (let i = 0; i < buildingLayer.length; i++) {
        const feature = buildingLayer.feature(i);
        const geometry = feature.loadGeometry();
        
        // Convert MVT geometry to GeoJSON Polygon
        const coordinates: number[][][] = [];
        for (const ring of geometry) {
          const ringCoords: number[][] = [];
          for (const point of ring) {
            // Convert tile-relative coordinates to lat/lng
            // MVT uses 4096 as tile extent
            const lng = tileBBox[0] + (point.x / 4096) * (tileBBox[2] - tileBBox[0]);
            const lat = tileBBox[3] - (point.y / 4096) * (tileBBox[3] - tileBBox[1]);
            ringCoords.push([lng, lat]);
          }
          coordinates.push(ringCoords);
        }

        if (coordinates.length > 0) {
          const polygon = turf.polygon(coordinates);
          
          // Extract height properties
          const props = feature.properties;
          const height = props.render_height ? parseFloat(String(props.render_height)) : undefined;
          const minHeight = props.render_min_height ? parseFloat(String(props.render_min_height)) : undefined;
          
          buildings.push({
            geometry: polygon,
            height,
            minHeight,
            properties: props,
          });
        }
      }

      this.buildingCache.set(key, buildings);
      return buildings;
    } catch (error) {
      console.error(`[BuildingDataLoader] Error loading tile ${key}:`, error);
      return [];
    }
  }

  /**
   * Get buildings near a lat/lng point (loads relevant tiles from local file)
   */
  async getBuildingsNearPoint(
    lat: number, 
    lng: number, 
    radiusDegrees: number = 0.001
  ): Promise<BuildingFeature[]> {
    const zoom = 14; // Building layer minzoom is 13, use 14 for good detail
    
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

    const buildings: BuildingFeature[] = [];

    // Load all tiles in the bounding box (from local file)
    for (let x = minTile.x; x <= maxTile.x; x++) {
      for (let y = minTile.y; y <= maxTile.y; y++) {
        const tileBuildings = await this.loadBuildingsFromTile(zoom, x, y);
        buildings.push(...tileBuildings);
      }
    }

    // Filter to buildings actually intersecting with the search circle
    const point = turf.point([lng, lat]);
    const circle = turf.circle(point, radiusDegrees, { units: 'degrees' });
    
    return buildings.filter(building => 
      turf.booleanIntersects(building.geometry, circle)
    );
  }

  /**
   * Clear the building cache (useful for memory management)
   */
  clearCache(): void {
    this.buildingCache.clear();
  }

  /**
   * Cleanup: close file handle
   */
  close(): void {
    this.fileSource.close();
  }
}

