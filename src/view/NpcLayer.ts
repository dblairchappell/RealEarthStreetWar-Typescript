/**
 * NpcLayer - Canvas-Based NPC Rendering Layer (Fallback for Globe Projection)
 * 
 * This class provides a Canvas 2D rendering layer for NPCs. It's used as a fallback
 * when the map uses globe projection (ENABLE_GLOBE = true), since the WebGL-based
 * NpcInstancedLayer only works reliably with Mercator projection.
 * 
 * Architecture:
 * 
 * - Creates an HTML5 Canvas element positioned absolutely over the map
 * - Renders NPCs as sprites (reusing player sprite) with rotation support
 * - Uses map.project() to convert lat/lng to screen coordinates (works with any projection)
 * - Queries ECS world directly for NPC positions
 * - Skips rendering if sprite fails to load
 * 
 * Comparison with NpcInstancedLayer:
 * 
 * | Feature              | NpcInstancedLayer | NpcLayer        |
 * |---------------------|-------------------|-----------------|
 * | Technology          | WebGL (GPU)       | Canvas 2D (CPU) |
 * | Performance         | Fast              | Slower          |
 * | Projection Support  | Mercator only     | Any projection  |
 * | Visual Quality      | Sprites           | Sprites         |
 * | Complexity          | High              | Medium          |
 * 
 * Usage:
 * 
 * This layer is automatically used when ENABLE_GLOBE = true in config.ts.
 * It's registered with the game loop as a Renderable and called each frame.
 * 
 * Note: The alpha parameter from Renderable interface is currently unused.
 * Interpolation could be added in the future for smoother movement.
 */

import { Renderable, Updatable } from "../loop/GameLoop";
import { defineQuery } from "bitecs";
import { world } from "../ecs/world";
import { Position, Rotation, Velocity } from "../ecs/world";
import { NpcTag, CHARACTER_RADIUS_DEG } from "@shared/realearthstreetwar";
import { SHOW_COLLISION_BOUNDS } from "../config";

/**
 * Canvas-based NPC rendering layer.
 * 
 * Renders NPCs as sprites on a canvas overlay positioned above the map.
 * Works with any map projection by using map.project() for coordinate conversion.
 * Supports sprite animations (idle, walking, running) similar to player character.
 * Skips rendering if sprite fails to load.
 */
export default class NpcLayer implements Renderable, Updatable {
  /** HTML5 Canvas element for drawing NPCs */
  private canvas: HTMLCanvasElement;
  /** 2D rendering context for the canvas */
  private ctx: CanvasRenderingContext2D;
  /** ECS query to find all NPC entities */
  private query = defineQuery([NpcTag, Position, Rotation, Velocity]);
  
  /** Currently selected NPC entity ID (for red outline) */
  private selectedNpcEid: number | null = null;
  
  // Animation definitions: sprite sheet URLs, frame counts, and playback rates
  // Same as CharacterView for consistency
  private animations = {
    idle: {
      url: 'sprites/brian/brian_idling_31x1.png',
      frames: 31,
      frameRate: 12 // 12 frames per second
    },
    walking: {
      url: 'sprites/brian/brian_walking_forward_31x1.png',
      frames: 31,
      frameRate: 24 // Faster frame rate for walking animation
    },
    running: {
      url: 'sprites/brian/brian_running_forward_23x1.png',
      frames: 23,
      frameRate: 30 // Fastest frame rate for running animation
    }
  };
  
  // Sprite images and loading state (one per animation type)
  private spriteImages: {
    idle: HTMLImageElement | null;
    walking: HTMLImageElement | null;
    running: HTMLImageElement | null;
  } = {
    idle: null,
    walking: null,
    running: null
  };
  
  private spritesLoaded = {
    idle: false,
    walking: false,
    running: false
  };
  
  // Animation frame accumulators (one per animation type)
  // Uses accumulator pattern to advance frames at correct rate
  private frameAccumulators = {
    idle: 0,
    walking: 0,
    running: 0
  };
  
  // Current frame indices (one per animation type)
  private currentFrames = {
    idle: 0,
    walking: 0,
    running: 0
  };
  
  // Velocity threshold for determining animation type
  // Below this threshold: idle, above: walking or running
  private readonly velocityThreshold = 0.0000001; // Small threshold to detect movement
  private readonly runningSpeedMultiplier = 1.5; // Running is 1.5x walking speed
  
  // Base size multiplier (same as CharacterView for consistency)
  private readonly npcBaseSize = 0.075;

  /**
   * Constructor - sets up the canvas overlay.
   * 
   * Creates a canvas element, positions it absolutely over the map,
   * and sets up resize handling to match the map container size.
   * 
   * @param map - MapLibre GL map instance
   */
  constructor(private map: any) {
    // Create canvas element
    this.canvas = document.createElement('canvas');
    
    // Position canvas absolutely over the map
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    
    // Disable pointer events so clicks pass through to the map
    this.canvas.style.pointerEvents = 'none';
    
    // Apply CSS image-rendering for crisp pixel art (matches player sprite styling)
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.imageRendering = '-moz-crisp-edges';
    this.canvas.style.imageRendering = 'crisp-edges';
    
    // Get 2D rendering context
    this.ctx = this.canvas.getContext('2d')!;
    
    // Disable image smoothing for crisp pixel art sprites
    // This prevents blurriness when scaling sprites
    this.ctx.imageSmoothingEnabled = false;
    
    // Add canvas to map container
    this.map.getContainer().appendChild(this.canvas);

    // Initial resize to match map size
    this.resize();
    // Listen for map resize events to keep canvas in sync
    this.map.on('resize', () => this.resize());
    
    // Load all sprite images asynchronously
    this.loadSprites();
  }
  
  /**
   * Loads all sprite images asynchronously (idle, walking, running).
   * Sets spritesLoaded flags when ready.
   */
  private loadSprites(): void {
    // Load idle sprite
    const idleImg = new Image();
    idleImg.onload = () => {
      this.spriteImages.idle = idleImg;
      this.spritesLoaded.idle = true;
    };
    idleImg.onerror = () => {
      console.warn('[NpcLayer] Failed to load idle sprite:', this.animations.idle.url);
    };
    idleImg.src = this.animations.idle.url;
    
    // Load walking sprite
    const walkingImg = new Image();
    walkingImg.onload = () => {
      this.spriteImages.walking = walkingImg;
      this.spritesLoaded.walking = true;
    };
    walkingImg.onerror = () => {
      console.warn('[NpcLayer] Failed to load walking sprite:', this.animations.walking.url);
    };
    walkingImg.src = this.animations.walking.url;
    
    // Load running sprite
    const runningImg = new Image();
    runningImg.onload = () => {
      this.spriteImages.running = runningImg;
      this.spritesLoaded.running = true;
    };
    runningImg.onerror = () => {
      console.warn('[NpcLayer] Failed to load running sprite:', this.animations.running.url);
    };
    runningImg.src = this.animations.running.url;
  }
  
  /**
   * Determines which animation type to use based on velocity.
   * 
   * @param velocityX - Velocity X component
   * @param velocityY - Velocity Y component
   * @returns Animation type: 'idle', 'walking', or 'running'
   */
  private determineAnimationType(velocityX: number, velocityY: number): 'idle' | 'walking' | 'running' {
    // Calculate velocity magnitude
    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    
    if (speed < this.velocityThreshold) {
      return 'idle';
    }
    
    // For now, assume all moving NPCs are walking
    // In the future, we could compare speed to a running threshold
    // const walkingSpeed = 0.000000225; // From straightWalkSystem
    // if (speed > walkingSpeed * this.runningSpeedMultiplier) {
    //   return 'running';
    // }
    
    return 'walking';
  }
  
  /**
   * Updatable implementation – called each frame by GameLoop.
   * 
   * Advances sprite animation frames using an accumulator pattern.
   * This ensures animations play at the correct rate regardless of frame time variations.
   * 
   * @param deltaMs - Time elapsed since last update (milliseconds)
   */
  public update(deltaMs: number): void {
    // Update each animation type independently
    for (const animType of ['idle', 'walking', 'running'] as const) {
      const anim = this.animations[animType];
      const frameRate = anim.frameRate;
      const frameDuration = 1000 / frameRate;
      
      // Accumulate elapsed time
      this.frameAccumulators[animType] += deltaMs;
      
      // Advance frames until caught up (handles frame drops)
      while (this.frameAccumulators[animType] >= frameDuration) {
        // Advance to next frame (wraps around using modulo)
        this.currentFrames[animType] = (this.currentFrames[animType] + 1) % anim.frames;
        
        // Subtract frame duration from accumulator (preserve remainder)
        this.frameAccumulators[animType] -= frameDuration;
      }
    }
  }
  
  /**
   * Calculates sprite size in pixels based on map zoom level.
   * Uses the same formula as CharacterView for consistency.
   * 
   * Formula: size = baseSize * 2^((zoom - 10) / 1.2)
   * - At zoom 10: size = baseSize
   * - Zooming in: size increases exponentially
   * - Zooming out: size decreases exponentially
   * - Clamped between 1px (min) and 200px (max) to prevent extreme sizes
   * 
   * @param zoom - Current map zoom level
   * @returns Sprite size in pixels
   */
  private calculateSpriteSize(zoom: number): number {
    const scale = Math.pow(2, (zoom - 10) / 1.2); // Same formula as CharacterView
    return Math.max(1, Math.min(200, this.npcBaseSize * scale));
  }

  /**
   * Calculates collision radius in screen pixels for a given NPC position.
   * 
   * The collision radius is stored in degrees (CHARACTER_RADIUS_DEG).
   * To accurately convert to screen pixels, we project two points:
   * - The NPC center position
   * - A point offset by the collision radius (to the east/north)
   * Then measure the screen distance between them.
   * 
   * This approach correctly handles:
   * - Map projection (Mercator, Globe, etc.)
   * - Latitude scaling (Mercator stretches at higher latitudes)
   * - Zoom level (automatically handled by map.project())
   * 
   * @param lng - NPC longitude in degrees
   * @param lat - NPC latitude in degrees
   * @returns Collision radius in screen pixels
   */
  private calculateCollisionRadiusPx(lng: number, lat: number): number {
    // Project the NPC center position to screen coordinates
    const center = this.map.project({ lng, lat });
    
    // Project a point offset by the collision radius to the east
    // Using east direction for simplicity (works at all latitudes)
    const offsetPoint = this.map.project({ 
      lng: lng + CHARACTER_RADIUS_DEG, 
      lat: lat 
    });
    
    // Calculate screen distance between center and offset point
    const dx = offsetPoint.x - center.x;
    const dy = offsetPoint.y - center.y;
    const radiusPx = Math.sqrt(dx * dx + dy * dy);
    
    return radiusPx;
  }

  /**
   * Draws a collision circle around an NPC position.
   * 
   * @param ctx - Canvas 2D context
   * @param x - Screen X coordinate (center of circle)
   * @param y - Screen Y coordinate (center of circle)
   * @param radiusPx - Circle radius in pixels
   */
  private drawCollisionCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radiusPx: number
  ): void {
    ctx.save();
    
    // Draw circle outline
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)'; // Semi-transparent red
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]); // Dashed line for visibility
    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    
    // Optional: Draw center point
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }

  /**
   * Resize canvas to match map container dimensions.
   * 
   * Called on initialization and whenever the map is resized.
   * Ensures the canvas always covers the entire map viewport.
   * 
   * Accounts for device pixel ratio to prevent blurriness on high-DPI displays.
   * The canvas internal resolution is scaled up, but CSS size matches display size.
   */
  private resize() {
    const { clientWidth, clientHeight } = this.map.getContainer();
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas internal resolution (scaled by device pixel ratio)
    this.canvas.width = clientWidth * dpr;
    this.canvas.height = clientHeight * dpr;
    
    // Set canvas CSS size to match display size (not internal resolution)
    this.canvas.style.width = `${clientWidth}px`;
    this.canvas.style.height = `${clientHeight}px`;
    
    // Reset transform and scale the context to account for device pixel ratio
    // This ensures 1 canvas unit = 1 CSS pixel
    // Note: Setting canvas.width/height resets the context, so we need to re-apply settings
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    // Re-apply image smoothing setting (lost when canvas is resized)
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * Render NPCs on the canvas.
   * 
   * Called each frame by the game loop. Clears the canvas and redraws
   * all NPCs as sprites at their current positions with rotation.
   * 
   * Queries ECS world directly for NPC positions and renders them.
   * Skips rendering if sprite is not loaded.
   * 
   * Note: The alpha parameter is currently unused but could be used
   * for interpolation between fixed timesteps in the future.
   * 
   * @param alpha - Interpolation factor (0.0 to 1.0), currently unused
   */
  render(alpha: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // Ensure image smoothing is disabled (may be reset by browser)
    // This is critical for crisp pixel art rendering
    ctx.imageSmoothingEnabled = false;

    /**
     * Clear the entire canvas before redrawing.
     * This ensures NPCs don't leave trails when they move.
     * 
     * Note: clearRect uses the current coordinate system (after transform).
     * Since we scale by devicePixelRatio, we need to clear in CSS pixels,
     * not canvas pixels. The transform will scale it correctly.
     */
    const { clientWidth, clientHeight } = this.map.getContainer();
    ctx.clearRect(0, 0, clientWidth, clientHeight);
    
    // Get current zoom for size calculation
    const zoom = this.map.getZoom();
    const spriteSize = this.calculateSpriteSize(zoom);

    /**
     * Query ECS world directly for NPC positions.
     * Uses bitecs query to find all entities with NpcTag, Position, and Rotation components.
     */
    const ents = this.query(world);
    for (let i = 0; i < ents.length; i++) {
        const eid = ents[i];
        const lng = Position.x[eid];
        const lat = Position.y[eid];
        
        // Get velocity to determine animation type and rotation
        const velocityX = Velocity.x[eid] || 0;
        const velocityY = Velocity.y[eid] || 0;
        const animType = this.determineAnimationType(velocityX, velocityY);
        
        // Calculate rotation from velocity direction (ensures NPC faces movement direction)
        // 
        // Coordinate system analysis:
        // - Player movement: rotation 0° = north (deltaLat = cos(0) = 1, deltaLng = sin(0) = 0)
        // - Velocity (0, 1) = moving north → atan2(velocityY, velocityX) = atan2(1, 0) = π/2 radians
        // - Canvas rotate(): rotates clockwise from positive X axis (east)
        //   - rotate(0) = facing east
        //   - rotate(π/2) = facing south (clockwise)
        //   - rotate(-π/2) = facing north (counter-clockwise)
        //   - rotate(π) = facing west
        // - To match player system (0° = north), we need: canvasRotation = gameRotation - π/2
        // - But atan2 already gives us the angle from east, so we need to subtract π/2 to get north=0
        // - However, if sprite faces east by default, no offset needed
        // - If sprite faces north by default, need -π/2 offset
        // 
        // Testing: Try NO offset first (assumes sprite faces east like Canvas default)
        let rotation: number;
        const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
        if (speed > this.velocityThreshold) {
          // Calculate rotation from velocity to match player's coordinate system
          // Player system: rotation 0° = north (deltaLat = cos(0) = 1, deltaLng = sin(0) = 0)
          // When moving north: velocityY = 1, velocityX = 0
          // atan2(1, 0) = π/2 radians = 90°, but player rotation for north = 0°
          // So we need: rotation = atan2(velocityY, velocityX) - π/2
          // Canvas rotate() rotates clockwise, CSS rotateZ() rotates counter-clockwise
          // So we need to negate to match: rotation = -(atan2(velocityY, velocityX) - π/2)
          const baseRotation = -(Math.atan2(velocityY, velocityX) - Math.PI / 2);
          
          // Account for camera bearing (same as player sprite does)
          // Player uses: rotateZ(${this.playerRotation - this.cameraBearing}deg)
          // So we subtract camera bearing from rotation (convert bearing from degrees to radians)
          const cameraBearingRad = (this.map.getBearing() * Math.PI) / 180;
          rotation = baseRotation - cameraBearingRad;
        } else {
          // Idle: use stored rotation (stored in degrees, convert to radians)
          // Rotation.angle uses game system (0° = north), same as player
          // Convert from game system (0° = north) to Canvas system (0 = east)
          // Same conversion as moving NPCs: subtract π/2 and negate
          const rotationDeg = Rotation.angle[eid] || 0;
          const baseRotation = -((rotationDeg * Math.PI) / 180 - Math.PI / 2);
          
          // Account for camera bearing (same as player sprite does)
          const cameraBearingRad = (this.map.getBearing() * Math.PI) / 180;
          rotation = baseRotation - cameraBearingRad;
        }
        
        // Project lat/lng to screen coordinates
        const p = this.map.project({ lng, lat });
        
        // Draw sprite (skip rendering if sprite not loaded)
        if (this.spritesLoaded[animType] && this.spriteImages[animType]) {
          const frame = this.currentFrames[animType];
          this.drawSprite(ctx, p.x, p.y, rotation, spriteSize, animType, frame);
        }

        // Draw selection outline if this NPC is selected (red outline)
        if (this.selectedNpcEid === eid) {
          this.drawSelectionOutline(ctx, p.x, p.y, spriteSize);
        }

        // Draw collision bounds if enabled
        if (SHOW_COLLISION_BOUNDS) {
          const radiusPx = this.calculateCollisionRadiusPx(lng, lat);
          this.drawCollisionCircle(ctx, p.x, p.y, radiusPx);
        }
      }
  }
  
  /**
   * Draws a sprite at the given position with rotation.
   * Extracts a single frame from the sprite sheet based on animation type.
   * 
   * @param ctx - Canvas 2D context
   * @param x - Screen X coordinate
   * @param y - Screen Y coordinate
   * @param rotation - Rotation in radians
   * @param size - Sprite size in pixels
   * @param animType - Animation type ('idle', 'walking', or 'running')
   * @param frame - Frame index (0-based) from sprite sheet
   */
  private drawSprite(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rotation: number,
    size: number,
    animType: 'idle' | 'walking' | 'running',
    frame: number
  ): void {
    const spriteImage = this.spriteImages[animType];
    if (!spriteImage) return;
    
    const anim = this.animations[animType];
    
    // Calculate source rectangle for this frame
    // Round to integers to prevent sub-pixel sampling (causes blurriness)
    const frameWidth = spriteImage.width / anim.frames;
    const sx = Math.round(frame * frameWidth);
    const sy = 0;
    const sWidth = Math.round(frameWidth);
    const sHeight = spriteImage.height;
    
    // Round coordinates to prevent sub-pixel blurring
    const screenX = Math.round(x);
    const screenY = Math.round(y);
    
    // Round destination size to integer for crisp rendering
    const destSize = Math.round(size);
    const halfSize = destSize / 2;
    
    // Save context state
    ctx.save();
    
    // Translate to sprite center, rotate, then translate back
    ctx.translate(screenX, screenY);
    ctx.rotate(rotation); // Rotate around center
    
    // Draw sprite frame (centered on origin after translate)
    // Use integer coordinates for crisp pixel art rendering
    ctx.drawImage(
      spriteImage,
      sx, sy, sWidth, sHeight, // Source rectangle (from sprite sheet, integer coordinates)
      -halfSize, -halfSize, destSize, destSize // Destination rectangle (centered, integer size)
    );
    
    // Restore context state
    ctx.restore();
  }
  
  /**
   * Draws a selection outline around an NPC (red outline for selected NPCs).
   * 
   * @param ctx - Canvas 2D context
   * @param x - Screen X coordinate (center of sprite)
   * @param y - Screen Y coordinate (center of sprite)
   * @param spriteSize - Sprite size in pixels
   */
  private drawSelectionOutline(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    spriteSize: number
  ): void {
    ctx.save();
    
    // Draw red outline/glow around sprite
    const outlineWidth = 3;
    const glowRadius = spriteSize / 2 + outlineWidth;
    
    // Outer glow
    ctx.shadowColor = 'rgba(220, 53, 69, 0.8)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(220, 53, 69, 0.9)';
    ctx.lineWidth = outlineWidth;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner outline for crisp edge
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(220, 53, 69, 1.0)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius - 1, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.restore();
  }
  
  /**
   * Set the selected NPC entity ID (for red outline)
   */
  public setSelectedNpc(eid: number | null): void {
    const changed = this.selectedNpcEid !== eid;
    this.selectedNpcEid = eid;
    
    if (changed) {
      console.log('[NpcLayer] Selection changed:', eid);
      // Trigger a repaint to show the selection outline immediately
      // The render() method will be called by the game loop, but triggering repaint ensures immediate update
      if (this.map) {
        this.map.triggerRepaint();
      }
    }
  }
  
} 