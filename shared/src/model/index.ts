/**
 * Shared Models - Re-export bridge for game models
 */

export { default } from './GameState';

// Re-export static properties for easier access
import GameStateClass from './GameState';
export const GameStateConstants = {
  PLAYER_MOVE_SPEED: GameStateClass.PLAYER_MOVE_SPEED,
  PLAYER_RUN_SPEED: GameStateClass.PLAYER_RUN_SPEED,
  PLAYER_ROTATION_SPEED: GameStateClass.PLAYER_ROTATION_SPEED,
  MINUTES_PER_TICK: GameStateClass.MINUTES_PER_TICK,
  GAME_TICK_MS: GameStateClass.GAME_TICK_MS,
  POSSESSION_RANGE_DEG: GameStateClass.POSSESSION_RANGE_DEG,
  POSSESSION_RANGE_METERS: GameStateClass.POSSESSION_RANGE_METERS,
};

