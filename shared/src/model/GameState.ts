/**
 * GameState - Central Data Model for Game State
 * 
 * This file defines the core data structures and state management for the game.
 * GameState acts as the single source of truth for all game data, including:
 * - Player position and state
 * - Game time and progression
 * - Gameplay constants (speeds, timing)
 * 
 * Architecture:
 * 
 * The GameState class follows a simple data-holder pattern. It doesn't contain
 * business logic (that's in GameController/GameWorld), but serves as the central repository
 * that all systems read from and write to.
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
 * 
 * This is the single source of truth for game state. All systems read from
 * and write to this class. It's instantiated once on both client and server
 * and passed to controllers/views that need access to game data.
 */
export default class GameState {
  /* ----- Player State ----- */
  
  /**
   * Player character state.
   * Tracks position, rotation, and movement status.
   * Position is synchronized with ECS player entity.
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
  
  /* ----- Gameplay Constants ----- */
  
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

