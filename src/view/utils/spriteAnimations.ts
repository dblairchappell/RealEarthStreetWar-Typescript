/**
 * Shared sprite animation definitions
 * Used by player (DOM/Canvas) and NPCs (Canvas/WebGL)
 */

export type AnimationType = 'idle' | 'walking' | 'running';

export interface AnimationDefinition {
  url: string;
  frames: number;
  frameRate: number;
}

export interface SpriteAnimationConfig {
  idle: AnimationDefinition;
  walking: AnimationDefinition;
  running: AnimationDefinition;
}

/**
 * Standard sprite animation configuration
 * All rendering paths use these same definitions for consistency
 */
export const SPRITE_ANIMATIONS: SpriteAnimationConfig = {
  idle: {
    url: '/assets/sprites/brian/brian_idling_31x1.png',
    frames: 31,
    frameRate: 12 // 12 frames per second
  },
  walking: {
    url: '/assets/sprites/brian/brian_walking_forward_31x1.png',
    frames: 31,
    frameRate: 24 // Faster frame rate for walking animation
  },
  running: {
    url: '/assets/sprites/brian/brian_running_forward_23x1.png',
    frames: 23,
    frameRate: 30 // Fastest frame rate for running animation
  }
};

/**
 * Velocity threshold for determining animation type from movement
 * Below this threshold: idle, above: walking or running
 */
export const VELOCITY_THRESHOLD = 0.0000001;

/**
 * Base speed for NPCs (used for animation scaling)
 */
export const BASE_NPC_SPEED = 0.000000225;

