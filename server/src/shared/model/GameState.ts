/**
 * GameState - Central Data Model for Game State
 * 
 * This file defines the core data structures and state management for the game.
 * GameState acts as the single source of truth for all game data, including:
 * - Player position and state
 * - Headquarters (HQs) and territory
 * - Resources (money, commodities)
 * - Game time and progression
 * - Gameplay constants (speeds, radii, timing)
 */

import * as turf from '@turf/turf';
import { Polygon, MultiPolygon } from 'geojson';

/**
 * Type of headquarters that can be placed in the game.
 * Each type has different placement rules and gameplay effects.
 */
export type HQType = 'producer' | 'trafficker' | 'retailer';

/**
 * Headquarters (HQ) structure representing a placed building.
 * HQs generate influence areas and are the core strategic element of the game.
 */
export interface HQ { 
  /** Unique identifier for this HQ */
  id: string;
  /** Longitude coordinate (degrees) */
  lng: number; 
  /** Latitude coordinate (degrees) */
  lat: number;
  /** Type of HQ (determines placement rules and function) */
  type: HQType;
}

/**
 * Player character state structure.
 * Tracks the player's position, rotation, and movement status.
 */
export interface PlayerCharacter {
  /** Longitude coordinate (degrees) */
  lng: number;
  /** Latitude coordinate (degrees) */
  lat: number;
  /** Rotation angle in degrees: 0 = north, 90 = east, 180 = south, 270 = west */
  rotation: number;
  /** Whether the player is currently moving */
  isMoving: boolean;
}

/**
 * Central game state class containing all persistent game data.
 */
export default class GameState {
  /* ----- Persistent Game Data ----- */
  
  hqs: HQ[] = [];
  playerUnion: Polygon | MultiPolygon | null = null;
  plantingType: HQType | null = null;

  /* ----- Player State ----- */
  
  player: PlayerCharacter = {
    lng: -74.05682,
    lat: 40.69337,
    rotation: 180,
    isMoving: false
  };

  /* ----- Game Progression ----- */
  
  gameDate = new Date('2100-01-01T00:00:00');
  commodities = 0;
  money = 1000;

  /* ----- Gameplay Constants ----- */
  
  static readonly INFLUENCE_RADIUS_KM = 0.08;
  static readonly GAME_TICK_MS = 1000;
  static readonly MINUTES_PER_TICK = 1;

  /* ----- Player Movement Constants ----- */
  
  static readonly PLAYER_MOVE_SPEED = 0.00003;
  static readonly PLAYER_RUN_SPEED = 0.000072;
  static readonly PLAYER_ROTATION_SPEED = 180;
}

