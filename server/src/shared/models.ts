/**
 * Shared Models - Re-export bridge for game models
 * 
 * This file re-exports game models from local copies.
 */

export { default } from './model/GameState';
export type { HQ, HQType, PlayerCharacter } from './model/GameState';

// Re-export static properties for easier access
import GameStateClass from './model/GameState';
export const GameStateConstants = {
  PLAYER_MOVE_SPEED: GameStateClass.PLAYER_MOVE_SPEED,
  PLAYER_RUN_SPEED: GameStateClass.PLAYER_RUN_SPEED,
  PLAYER_ROTATION_SPEED: GameStateClass.PLAYER_ROTATION_SPEED,
  MINUTES_PER_TICK: GameStateClass.MINUTES_PER_TICK,
  GAME_TICK_MS: GameStateClass.GAME_TICK_MS,
  INFLUENCE_RADIUS_KM: GameStateClass.INFLUENCE_RADIUS_KM,
};

