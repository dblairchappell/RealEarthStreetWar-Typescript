/**
 * EntityClickHandler - Handles clicking on entities (occupant or NPCs)
 * 
 * Detects clicks on the current occupant or nearby NPCs and triggers
 * appropriate callbacks for showing HUD panels.
 */

import { defineQuery } from 'bitecs';
import { world, Position, Rotation, PlayerTag, NpcTag } from '../ecs/world';
import { calculateDistanceDeg, calculateDistanceMeters } from '@shared/realearthstreetwar';
import { FeatureQuery } from './map/FeatureQuery';

export interface EntityClickResult {
  type: 'occupant' | 'npc' | 'building' | 'none';
  entityId: number | null;
  distance?: number; // Distance in meters (for NPCs)
  building?: BuildingInfo; // Building data (for buildings)
}

export interface EntityInfo {
  entityId: number;
  lng: number;
  lat: number;
  rotation: number;
}

export interface BuildingInfo {
  id: string; // Centroid-based hash ID
  name?: string;
  buildingType?: string;
  height?: number;
  centerLat: number;
  centerLng: number;
  properties: Record<string, any>;
  geometry?: any; // Full GeoJSON geometry from the building feature
}

export class EntityClickHandler {
  private playerQuery = defineQuery([PlayerTag, Position, Rotation]);
  private npcQuery = defineQuery([NpcTag, Position, Rotation]);
  private readonly CLICK_RADIUS_PIXELS = 20; // Click detection radius in pixels

  constructor(
    private map: any,
    private featureQuery: FeatureQuery | null,
    private getCurrentOccupantEid: () => number | null,
    private onOccupantClicked: (eid: number, info: EntityInfo) => void,
    private onNpcClicked: (eid: number, info: EntityInfo, distanceMeters: number) => void,
    private onBuildingClicked: (info: BuildingInfo) => void,
    private onEmptyClick: () => void
  ) {
    this.setupClickHandler();
  }

  /**
   * Set up map click handler
   */
  private setupClickHandler(): void {
    this.map.on('click', (e: any) => {
      const result = this.findEntityAtPoint(e.point);
      
      if (result.type === 'occupant' && result.entityId !== null) {
        const info = this.getEntityInfo(result.entityId);
        if (info) {
          this.onOccupantClicked(result.entityId, info);
        }
      } else if (result.type === 'npc' && result.entityId !== null) {
        const info = this.getEntityInfo(result.entityId);
        if (info && result.distance !== undefined) {
          this.onNpcClicked(result.entityId, info, result.distance);
        }
      } else if (result.type === 'building' && result.building) {
        this.onBuildingClicked(result.building);
      } else {
        // Clicked on empty space
        this.onEmptyClick();
      }
    });
  }

  /**
   * Find entity at screen point
   * Returns click result with entity type and distance
   */
  private findEntityAtPoint(point: { x: number; y: number }): EntityClickResult {
    const currentOccupantEid = this.getCurrentOccupantEid();
    
    // First check if click is on current occupant
    if (currentOccupantEid !== null) {
      const occupantScreenPos = this.getEntityScreenPosition(currentOccupantEid);
      if (occupantScreenPos && this.isPointInRadius(point, occupantScreenPos, this.CLICK_RADIUS_PIXELS)) {
        return { type: 'occupant', entityId: currentOccupantEid };
      }
    }
    
    // Then check NPCs
    const npcs = this.npcQuery(world);
    let closestNpc: { eid: number; distance: number } | null = null;
    let closestDistancePixels = Infinity;
    
    for (const eid of npcs) {
      const npcScreenPos = this.getEntityScreenPosition(eid);
      if (npcScreenPos) {
        const distancePixels = this.calculatePixelDistance(point, npcScreenPos);
        
        if (distancePixels < this.CLICK_RADIUS_PIXELS && distancePixels < closestDistancePixels) {
          closestDistancePixels = distancePixels;
          closestNpc = { eid, distance: distancePixels };
        }
      }
    }
    
    if (closestNpc) {
      // Calculate distance in meters
      const npcInfo = this.getEntityInfo(closestNpc.eid);
      if (npcInfo && currentOccupantEid !== null) {
        const occupantInfo = this.getEntityInfo(currentOccupantEid);
        if (occupantInfo) {
          const distanceMeters = calculateDistanceMeters(
            occupantInfo.lng,
            occupantInfo.lat,
            npcInfo.lng,
            npcInfo.lat
          );
          return { type: 'npc', entityId: closestNpc.eid, distance: distanceMeters };
        }
      }
      // Fallback: if no occupant, just return NPC without distance
      return { type: 'npc', entityId: closestNpc.eid };
    }
    
    // Check for buildings
    if (this.featureQuery) {
      const queryResult = this.featureQuery.query(point);
      if (queryResult.building) {
        const building = queryResult.building;
        let geometry = building.geometry;
        
        // Convert click point to lat/lng for point-in-polygon check
        const clickLngLat = this.map.unproject([point.x, point.y]);
        const clickLng = clickLngLat.lng;
        const clickLat = clickLngLat.lat;
        
        // Extract individual polygon from MultiPolygon if needed
        geometry = this.extractPolygonAtPoint(geometry, clickLng, clickLat);
        
        // Calculate center point of building polygon
        const coords = geometry.coordinates[0]; // Exterior ring
        let centerLng = 0, centerLat = 0;
        for (const coord of coords) {
          centerLng += coord[0];
          centerLat += coord[1];
        }
        centerLng /= coords.length;
        centerLat /= coords.length;
        
        // Generate building ID
        const buildingId = this.generateBuildingId(geometry, centerLat, centerLng);
        
        // Extract building properties
        const props = building.properties || {};
        const buildingInfo: BuildingInfo = {
          id: buildingId,
          name: props.name || undefined,
          buildingType: props.building || props['building:type'] || undefined,
          height: props.render_height ? parseFloat(String(props.render_height)) : undefined,
          centerLat,
          centerLng,
          properties: props,
          geometry: geometry // Store extracted polygon (not MultiPolygon)
        };
        
        return { type: 'building', entityId: null, building: buildingInfo };
      }
    }
    
    return { type: 'none', entityId: null };
  }

  /**
   * Get entity screen position from lat/lng
   */
  private getEntityScreenPosition(entityId: number): { x: number; y: number } | null {
    const lng = Position.x[entityId];
    const lat = Position.y[entityId];
    
    try {
      const screenPos = this.map.project([lng, lat]);
      return { x: screenPos.x, y: screenPos.y };
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if point is within radius of another point
   */
  private isPointInRadius(
    point: { x: number; y: number },
    center: { x: number; y: number },
    radius: number
  ): boolean {
    const distance = this.calculatePixelDistance(point, center);
    return distance < radius;
  }

  /**
   * Calculate pixel distance between two points
   */
  private calculatePixelDistance(
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Get entity information from ECS
   */
  private getEntityInfo(entityId: number): EntityInfo | null {
    if (!Position.x[entityId] && Position.x[entityId] !== 0) return null;
    if (!Position.y[entityId] && Position.y[entityId] !== 0) return null;
    
    return {
      entityId,
      lng: Position.x[entityId],
      lat: Position.y[entityId],
      rotation: Rotation.angle[entityId] || 0,
    };
  }

  /**
   * Extract individual polygon from MultiPolygon that contains the click point
   */
  private extractPolygonAtPoint(
    geometry: any,
    clickLng: number,
    clickLat: number
  ): any {
    if (geometry.type === 'Polygon') {
      return geometry;
    }
    
    if (geometry.type === 'MultiPolygon') {
      // Find polygon containing click point
      for (const polygonCoords of geometry.coordinates) {
        const exteriorRing = polygonCoords[0];
        if (this.isPointInPolygon(clickLng, clickLat, exteriorRing)) {
          return {
            type: 'Polygon',
            coordinates: polygonCoords
          };
        }
      }
      // Fallback: return first polygon if point-in-polygon fails
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates[0]
      };
    }
    
    return geometry; // Return as-is if not Polygon or MultiPolygon
  }

  /**
   * Check if a point is inside a polygon using ray casting algorithm
   */
  private isPointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
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
   * Generate stable building ID from centroid and geometry
   * Creates a short, memorable hash-based ID
   * Uses improved hash function to reduce collision risk
   */
  private generateBuildingId(polygon: any, centerLat: number, centerLng: number): string {
    const coords = polygon.coordinates[0]; // Exterior ring
    
    // Create a comprehensive hash string from centroid + multiple coordinate points
    // Include more points and use precise formatting to ensure uniqueness
    const hashParts = [
      centerLat.toFixed(8), // Higher precision for centroid
      centerLng.toFixed(8),
      ...coords.slice(0, 8).map((c: number[]) => `${c[0].toFixed(8)}_${c[1].toFixed(8)}`), // More points
      coords.length.toString() // Include polygon vertex count for additional uniqueness
    ];
    const hashString = hashParts.join('_');
    
    // Improved hash function (FNV-1a variant) for better distribution and collision resistance
    // This provides better avalanche effect - small input changes cause large hash changes
    let hash = 2166136261; // FNV offset basis (32-bit)
    for (let i = 0; i < hashString.length; i++) {
      hash ^= hashString.charCodeAt(i);
      // Multiply by FNV prime (16777619) using bit operations for efficiency
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    
    // Ensure positive 32-bit integer
    hash = hash >>> 0;
    
    // Convert to base36 (0-9, a-z) for shorter, more readable ID
    const base36 = hash.toString(36);
    
    // Take first 8 characters for a short, memorable ID
    return `bld_${base36.substring(0, 8)}`;
  }
}

