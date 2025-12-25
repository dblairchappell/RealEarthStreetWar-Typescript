/**
 * GameState - Central Data Model for Game State
 * 
 * This file defines the core data structures and state management for the game.
 * GameState acts as the single source of truth for all game data, including:
 * - Player position and state
 * - Game time and progression
 * - Gameplay constants (speeds, timing)
 */

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
  /* ----- Player State ----- */
  
  player: PlayerCharacter = {
    lng: -74.05682,
    lat: 40.69337,
    rotation: 180,
    isMoving: false
  };

  /* ----- Game Progression ----- */
  
  gameDate = new Date('2100-01-01T00:00:00');

  /* ----- Gameplay Constants ----- */
  
  static readonly GAME_TICK_MS = 1000;
  static readonly MINUTES_PER_TICK = 1;

  /* ----- Player Movement Constants ----- */
  
  static readonly PLAYER_MOVE_SPEED = 0.00003;
  static readonly PLAYER_RUN_SPEED = 0.000072;
  static readonly PLAYER_ROTATION_SPEED = 180;
}

