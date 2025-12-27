/**
 * Shared sprite utility functions
 * Size calculation, rotation, coordinate conversion
 */

/**
 * Calculates sprite size in pixels based on map zoom level
 * Uses exponential scaling to maintain consistent visual size
 * 
 * Formula: size = baseSize * 2^((zoom - referenceZoom) / scaleFactor)
 * 
 * @param baseSize - Base size multiplier
 * @param zoom - Current map zoom level
 * @param referenceZoom - Zoom level where sprite is at baseSize (default: 10)
 * @param scaleFactor - Scaling factor (default: 1.2)
 * @param minSize - Minimum size in pixels (default: 1)
 * @param maxSize - Maximum size in pixels (default: 200)
 * @returns Calculated size in pixels
 */
export function calculateSpriteSize(
  baseSize: number,
  zoom: number,
  referenceZoom: number = 10,
  scaleFactor: number = 1.2,
  minSize: number = 1,
  maxSize: number = 200
): number {
  const scale = Math.pow(2, (zoom - referenceZoom) / scaleFactor);
  return Math.max(minSize, Math.min(maxSize, baseSize * scale));
}

/**
 * Calculates rotation angle from velocity direction
 * Accounts for game coordinate system (0° = north)
 * 
 * @param velocityX - Velocity X component (longitude direction)
 * @param velocityY - Velocity Y component (latitude direction)
 * @param cameraBearing - Camera bearing in degrees (for relative rotation)
 * @returns Rotation angle in radians (for Canvas rotate() or WebGL)
 */
export function calculateRotationFromVelocity(
  velocityX: number,
  velocityY: number,
  cameraBearing: number = 0
): number {
  const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
  
  if (speed < 0.0000001) {
    return 0; // No rotation if not moving
  }
  
  // Calculate base rotation from velocity
  // Game system: 0° = north, velocity (0, 1) = moving north
  // atan2(velocityY, velocityX) gives angle from east
  // Need to convert to game system (north = 0°)
  const baseRotation = -(Math.atan2(velocityY, velocityX) - Math.PI / 2);
  
  // Account for camera bearing (convert to radians)
  const cameraBearingRad = (cameraBearing * Math.PI) / 180;
  
  return baseRotation - cameraBearingRad;
}

/**
 * Calculates rotation angle from stored rotation (for idle entities)
 * 
 * @param rotationDeg - Stored rotation in degrees (game system: 0° = north)
 * @param cameraBearing - Camera bearing in degrees
 * @returns Rotation angle in radians
 */
export function calculateRotationFromStored(
  rotationDeg: number,
  cameraBearing: number = 0
): number {
  // Convert from game system (0° = north) to Canvas/WebGL system
  const baseRotation = -((rotationDeg * Math.PI) / 180 - Math.PI / 2);
  
  // Account for camera bearing
  const cameraBearingRad = (cameraBearing * Math.PI) / 180;
  
  return baseRotation - cameraBearingRad;
}

/**
 * Calculates camera pitch scaling factor for vertical compression
 * Simulates 3D tilt effect in 2D rendering
 * 
 * @param pitchDeg - Camera pitch in degrees (0 = horizontal, 90 = straight down)
 * @returns Vertical scale factor (1.0 = full height, 0.0 = completely flat)
 */
export function calculatePitchScale(pitchDeg: number): number {
  const pitchRad = (pitchDeg * Math.PI) / 180;
  return Math.cos(pitchRad);
}

