/**
 * Canvas sprite rendering utilities
 * Shared drawing functions for player and NPCs
 */

import { AnimationType, SPRITE_ANIMATIONS } from './spriteAnimations';
import { calculatePitchScale } from './spriteUtils';

export interface SpriteImages {
  idle: HTMLImageElement | null;
  walking: HTMLImageElement | null;
  running: HTMLImageElement | null;
}

export interface SpriteDrawOptions {
  x: number;
  y: number;
  rotation: number;
  size: number;
  animType: AnimationType;
  frame: number;
  cameraPitch?: number; // Optional pitch for vertical scaling
}

/**
 * Draws a sprite frame on canvas
 * 
 * @param ctx - Canvas 2D rendering context
 * @param spriteImages - Loaded sprite images
 * @param options - Sprite drawing options
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  spriteImages: SpriteImages,
  options: SpriteDrawOptions
): void {
  const { x, y, rotation, size, animType, frame, cameraPitch } = options;
  
  const spriteImage = spriteImages[animType];
  if (!spriteImage) {
    console.warn(`[SpriteRenderer] Sprite image not loaded for animation: ${animType}`);
    return;
  }
  
  const anim = SPRITE_ANIMATIONS[animType];
  
  // Calculate source rectangle for this frame
  const frameWidth = spriteImage.width / anim.frames;
  const sx = Math.round(frame * frameWidth);
  const sy = 0;
  const sWidth = Math.round(frameWidth);
  const sHeight = spriteImage.height;
  
  // Round coordinates for crisp pixel art rendering
  const screenX = Math.round(x);
  const screenY = Math.round(y);
  const destSize = Math.round(size);
  const halfSize = destSize / 2;
  
  // Calculate vertical scaling for pitch effect
  const scaleY = cameraPitch !== undefined ? calculatePitchScale(cameraPitch) : 1.0;
  
  // Save context state
  ctx.save();
  
  // Translate to sprite center
  ctx.translate(screenX, screenY);
  
  // Apply vertical scaling to simulate tilt (if pitch provided)
  if (scaleY !== 1.0) {
    ctx.scale(1, scaleY);
  }
  
  // Rotate around center
  ctx.rotate(rotation);
  
  // Draw sprite frame (centered on origin after translate)
  ctx.drawImage(
    spriteImage,
    sx, sy, sWidth, sHeight, // Source rectangle
    -halfSize, -halfSize, destSize, destSize // Destination rectangle
  );
  
  // Restore context state
  ctx.restore();
}

/**
 * Draws an outline/glow around a sprite position
 * Used for selection feedback (green for player, red for selected NPCs)
 * 
 * @param ctx - Canvas 2D rendering context
 * @param x - Screen X coordinate (center)
 * @param y - Screen Y coordinate (center)
 * @param size - Sprite size in pixels
 * @param color - Outline color (e.g., 'rgba(0, 255, 0, 0.8)' for green)
 * @param width - Outline width in pixels (default: 3)
 * @param blur - Shadow blur radius (default: 8)
 */
export function drawSpriteOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  width: number = 3,
  blur: number = 8
): void {
  ctx.save();
  
  const outlineRadius = size / 2 + width;
  
  // Outer glow
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, outlineRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Inner outline for crisp edge
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1.0)'); // Full opacity
  ctx.lineWidth = width - 1;
  ctx.beginPath();
  ctx.arc(x, y, outlineRadius - 1, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.restore();
}

/**
 * Loads sprite images asynchronously
 * 
 * @param onLoad - Callback called when all sprites are loaded
 * @returns Promise that resolves with loaded sprite images
 */
export function loadSpriteImages(
  onLoad?: (images: SpriteImages) => void
): Promise<SpriteImages> {
  const images: SpriteImages = {
    idle: null,
    walking: null,
    running: null
  };
  
  const loadPromises = Object.entries(SPRITE_ANIMATIONS).map(([type, anim]) => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        images[type as AnimationType] = img;
        resolve();
      };
      img.onerror = () => {
        console.error(`[SpriteRenderer] Failed to load sprite: ${anim.url}`);
        reject(new Error(`Failed to load sprite: ${anim.url}`));
      };
      img.src = anim.url;
    });
  });
  
  return Promise.all(loadPromises).then(() => {
    if (onLoad) {
      onLoad(images);
    }
    return images;
  });
}

