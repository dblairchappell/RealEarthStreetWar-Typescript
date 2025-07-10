// model/GameState.ts
import * as turf from '@turf/turf';
import { Polygon, MultiPolygon } from 'geojson';

export type HQType = 'producer' | 'trafficker' | 'retailer';

export interface HQ { 
  id: string;
  lng: number; 
  lat: number;
  type: HQType;
}

export interface PlayerCharacter {
  lng: number;
  lat: number;
  rotation: number; // degrees, 0 = north, 90 = east, 180 = south, 270 = west
  isMoving: boolean;
}

export default class GameState {
  /* ----- persistent data ----- */
  hqs: HQ[] = [];
  playerUnion: Polygon | MultiPolygon | null = null;
  plantingType: HQType | null = null;
  
  // Player character state
  player: PlayerCharacter = {
    lng: -74.05682,
    lat: 40.69337,
    rotation: 180, // Start facing south (toward camera)
    isMoving: false
  };

  // Movement mode toggle
  freeRotationMode: boolean = false; // false = 8-direction, true = 360-degree

  gameDate = new Date('2100-01-01T00:00:00');
  commodities = 0;
  money = 1000; // Start with some cash

  /* ----- constants ----- */
  static readonly INFLUENCE_RADIUS_KM = 0.08;
  static readonly GAME_TICK_MS = 1000; // 1 second per game tick
  static readonly MINUTES_PER_TICK = 15; // 15 game minutes per tick
  
  // Player movement constants
  static readonly PLAYER_MOVE_SPEED = 0.0000004; // degrees per frame
  static readonly PLAYER_RUN_SPEED = 0.0000010; // degrees per frame (2x walking speed)
  static readonly PLAYER_ROTATION_SPEED = 0.5; // degrees per frame
  static readonly PLAYER_FREE_ROTATION_SPEED = 2.0; // degrees per frame for 360-degree mode
  
  // 8-direction system constants
  static readonly VALID_DIRECTIONS = [
    0,    // North
    45,   // Northeast
    90,   // East
    135,  // Southeast
    180,  // South
    225,  // Southwest
    270,  // West
    315   // Northwest
  ];
  
  // Helper method to snap rotation to nearest valid direction
  static snapToValidDirection(rotation: number): number {
    // Normalize rotation to 0-360
    const normalizedRotation = ((rotation % 360) + 360) % 360;
    
    // Find the closest valid direction
    let closestDirection = GameState.VALID_DIRECTIONS[0];
    let closestDistance = Math.abs(normalizedRotation - closestDirection);
    
    for (const direction of GameState.VALID_DIRECTIONS) {
      const distance = Math.min(
        Math.abs(normalizedRotation - direction),
        Math.abs(normalizedRotation - direction - 360),
        Math.abs(normalizedRotation - direction + 360)
      );
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestDirection = direction;
      }
    }
    
    return closestDirection;
  }
  
  // Helper method to get next direction when rotating
  static getNextDirection(currentDirection: number, clockwise: boolean): number {
    const currentIndex = GameState.VALID_DIRECTIONS.indexOf(currentDirection);
    if (currentIndex === -1) {
      // If current direction is not valid, snap to nearest
      return GameState.snapToValidDirection(currentDirection);
    }
    
    if (clockwise) {
      return GameState.VALID_DIRECTIONS[(currentIndex + 1) % GameState.VALID_DIRECTIONS.length];
    } else {
      return GameState.VALID_DIRECTIONS[(currentIndex - 1 + GameState.VALID_DIRECTIONS.length) % GameState.VALID_DIRECTIONS.length];
    }
  }
}