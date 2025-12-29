/**
 * Shared animation state management utilities
 * Handles frame advancement using accumulator pattern
 */

import { AnimationType, SPRITE_ANIMATIONS, BASE_NPC_SPEED } from './spriteAnimations';

export interface AnimationState {
  accumulator: number;
  currentFrame: number;
  animType: AnimationType;
}

/**
 * Determines animation type from velocity
 * Used by NPCs
 */
export function determineAnimationFromVelocity(
  velocityX: number,
  velocityY: number,
  threshold: number = 0.0000001
): AnimationType {
  const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
  
  if (speed < threshold) {
    return 'idle';
  }
  
  // For now, assume all moving entities are walking
  // TODO: Add running detection based on speed threshold
  return 'walking';
}

/**
 * Determines animation type from input state
 * Used by player
 */
export function determineAnimationFromInput(input: {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  running: boolean;
}): AnimationType {
  const isMoving = input.forward || input.backward || input.left || input.right;
  
  if (!isMoving) {
    return 'idle';
  }
  
  return input.running ? 'running' : 'walking';
}

/**
 * Advances animation frame using accumulator pattern
 * Handles variable frame rates and frame drops gracefully
 * 
 * @param state - Current animation state
 * @param deltaMs - Time elapsed since last update (milliseconds)
 * @param speedMultiplier - Optional speed multiplier for animation scaling (default: 1.0)
 * @returns Updated animation state
 */
export function advanceAnimationFrame(
  state: AnimationState,
  deltaMs: number,
  speedMultiplier: number = 1.0
): AnimationState {
  const anim = SPRITE_ANIMATIONS[state.animType];
  if (!anim) return state;
  
  // Scale frame rate based on speed multiplier
  const scaledFrameRate = anim.frameRate * speedMultiplier;
  const frameDuration = 1000 / scaledFrameRate;
  
  // Accumulate elapsed time
  let newAccumulator = state.accumulator + deltaMs;
  let newFrame = state.currentFrame;
  
  // Advance frames until caught up (handles frame drops)
  while (newAccumulator >= frameDuration) {
    newFrame = (newFrame + 1) % anim.frames;
    newAccumulator -= frameDuration;
  }
  
  return {
    accumulator: newAccumulator,
    currentFrame: newFrame,
    animType: state.animType
  };
}

/**
 * Creates initial animation state
 */
export function createAnimationState(animType: AnimationType = 'idle'): AnimationState {
  return {
    accumulator: 0,
    currentFrame: 0,
    animType
  };
}

/**
 * Updates animation type, resetting frame if changed
 */
export function updateAnimationType(
  state: AnimationState,
  newAnimType: AnimationType
): AnimationState {
  if (state.animType === newAnimType) {
    return state; // No change
  }
  
  // Reset to first frame when animation changes
  return {
    accumulator: 0,
    currentFrame: 0,
    animType: newAnimType
  };
}

