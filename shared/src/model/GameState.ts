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
 * Central game state class containing all persistent game data.
 * 
 * This is the single source of truth for non-entity game state. Entity state
 * (positions, rotations, etc.) is managed by the ECS world. This class stores
 * only non-entity state like game time.
 * 
 * It's instantiated once on both client and server and passed to controllers/views
 * that need access to game data.
 */
export default class GameState {
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
  static readonly PLAYER_ROTATION_SPEED = 360;
  
  /**
   * Possession range in meters.
   * The controlling entity must be within this distance to possess an NPC.
   * This is the primary constant - degrees are calculated from this value.
   * 
   * To change the possession range, modify this value only.
   */
  static readonly POSSESSION_RANGE_METERS = 5;
  
  /**
   * Possession range in degrees (calculated from POSSESSION_RANGE_METERS).
   * Calculated using equator value (latitude 0) for consistency.
   * At equator: 1 degree ≈ 111,320 meters
   * 
   * This value is automatically calculated - do not modify directly.
   */
  static readonly POSSESSION_RANGE_DEG = (() => {
    // Using equator (latitude 0) as reference for constant calculation
    // At equator: 1 degree ≈ 111,320 meters
    const metersPerDegreeAtEquator = 111320;
    return GameState.POSSESSION_RANGE_METERS / metersPerDegreeAtEquator;
  })();
}

