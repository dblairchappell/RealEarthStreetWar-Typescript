/**
 * EntityClickHandler - Handles clicking on entities (occupant or NPCs)
 * 
 * Detects clicks on the current occupant or nearby NPCs and triggers
 * appropriate callbacks for showing HUD panels.
 */

import { defineQuery } from 'bitecs';
import { world, Position, Rotation, PlayerTag, NpcTag } from '../ecs/world';
import { calculateDistanceDeg, calculateDistanceMeters } from '@shared/realearthstreetwar';

export interface EntityClickResult {
  type: 'occupant' | 'npc' | 'none';
  entityId: number | null;
  distance?: number; // Distance in meters (for NPCs)
}

export interface EntityInfo {
  entityId: number;
  lng: number;
  lat: number;
  rotation: number;
}

export class EntityClickHandler {
  private playerQuery = defineQuery([PlayerTag, Position, Rotation]);
  private npcQuery = defineQuery([NpcTag, Position, Rotation]);
  private readonly CLICK_RADIUS_PIXELS = 20; // Click detection radius in pixels

  constructor(
    private map: any,
    private getCurrentOccupantEid: () => number | null,
    private onOccupantClicked: (eid: number, info: EntityInfo) => void,
    private onNpcClicked: (eid: number, info: EntityInfo, distanceMeters: number) => void,
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
}

