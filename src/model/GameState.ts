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
 * 
 * Architecture:
 * 
 * The GameState class follows a simple data-holder pattern. It doesn't contain
 * business logic (that's in GameController), but serves as the central repository
 * that all systems read from and write to.
 * 
 * Usage Pattern:
 * 
 * ```typescript
 * const state = new GameState();
 * 
 * // Read state
 * const playerPos = state.player;
 * const hqCount = state.hqs.length;
 * 
 * // Modify state (usually done through GameController)
 * state.hqs.push(newHQ);
 * state.money += 100;
 * ```
 * 
 * Note: In a more complex system, you might want to make state mutations more
 * controlled (e.g., through methods or a state management library), but for this
 * prototype, direct property access is acceptable.
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
 * 
 * This is the single source of truth for game state. All systems read from
 * and write to this class. It's instantiated once in main.ts and passed to
 * controllers and views that need access to game data.
 */
export default class GameState {
  /* ----- Persistent Game Data ----- */
  
  /**
   * Array of all placed headquarters.
   * Each HQ generates an influence area that contributes to the player's territory.
   */
  hqs: HQ[] = [];
  
  /**
   * Combined territory polygon representing all HQ influence areas merged together.
   * Uses Turf.js Polygon/MultiPolygon format for geospatial operations.
   * Updated whenever a new HQ is placed.
   */
  playerUnion: Polygon | MultiPolygon | null = null;
  
  /**
   * Current HQ placement mode.
   * Set to a HQType when player clicks a placement button, null when not placing.
   * Used by MapView to determine placement rules and cursor behavior.
   */
  plantingType: HQType | null = null;
  
  /* ----- Player State ----- */
  
  /**
   * Player character state.
   * Tracks position, rotation, and movement status.
   * Position is synchronized with ECS player entity in GameController.
   */
  player: PlayerCharacter = {
    /** Starting longitude: New York City area */
    lng: -74.05682,
    /** Starting latitude: New York City area */
    lat: 40.69337,
    /** Initial rotation: 180 degrees = facing south (toward camera in typical map view) */
    rotation: 180,
    /** Initial movement state */
    isMoving: false
  };

  /* ----- Game Progression ----- */
  
  /**
   * Current in-game date and time.
   * Advances at a rate determined by GAME_TICK_MS and MINUTES_PER_TICK.
   * Used for time-based gameplay mechanics and HUD display.
   */
  gameDate = new Date('2100-01-01T00:00:00');
  
  /**
   * Current commodity count.
   * Represents produced/traded goods. Currently not used in gameplay but
   * displayed in HUD for future expansion.
   */
  commodities = 0;
  
  /**
   * Current money/currency amount.
   * Starting amount for the player. Used for purchasing HQs and other items.
   */
  money = 1000;

  /* ----- Gameplay Constants ----- */
  
  /**
   * Influence radius in kilometers for each HQ.
   * When an HQ is placed, it creates a circular influence area with this radius.
   * All influence areas are merged to form the player's total territory.
   */
  static readonly INFLUENCE_RADIUS_KM = 0.08;
  
  /**
   * Duration of one game tick in milliseconds.
   * Game time advances by MINUTES_PER_TICK every GAME_TICK_MS real-world milliseconds.
   * Currently: 1 game minute per 1 real second.
   */
  static readonly GAME_TICK_MS = 1000;
  
  /**
   * Number of game minutes that pass per tick.
   * Combined with GAME_TICK_MS, determines the time acceleration factor.
   * Currently: 1 game minute per tick = 60x time acceleration.
   */
  static readonly MINUTES_PER_TICK = 1;
  
  /* ----- Player Movement Constants ----- */
  
  /**
   * Normal walking speed in degrees per second.
   * Approximately 0.0000005 degrees per frame at 60 fps.
   * In real-world terms: roughly 1.5 m/s walking speed.
   */
  static readonly PLAYER_MOVE_SPEED = 0.00003;
  
  /**
   * Running speed in degrees per second.
   * Approximately 0.0000012 degrees per frame at 60 fps.
   * Activated by double-tapping the forward arrow key.
   * In real-world terms: roughly 3.6 m/s running speed.
   */
  static readonly PLAYER_RUN_SPEED = 0.000072;
  
  /**
   * Player rotation speed in degrees per second.
   * Approximately 3 degrees per frame at 60 fps.
   * Used when player presses left/right arrow keys to rotate.
   */
  static readonly PLAYER_ROTATION_SPEED = 180;
}