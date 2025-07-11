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

  // Camera settings

  gameDate = new Date('2100-01-01T00:00:00');
  commodities = 0;
  money = 1000; // Start with some cash

  /* ----- constants ----- */
  static readonly INFLUENCE_RADIUS_KM = 0.08;
  static readonly GAME_TICK_MS = 1000; // 1 second per game tick
  static readonly MINUTES_PER_TICK = 1; // 1 game minute per tick
  
  // Player movement constants
  static readonly PLAYER_MOVE_SPEED = 0.0000005; // degrees per frame
  static readonly PLAYER_RUN_SPEED = 0.0000012; // degrees per frame (2x walking speed)
  static readonly PLAYER_ROTATION_SPEED = 3.0; // degrees per frame
}