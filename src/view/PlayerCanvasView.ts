/**
 * PlayerCanvasView - Canvas-Based Player Rendering Layer
 * 
 * This class provides a Canvas 2D rendering layer for the player character.
 * It's used when PLAYER_RENDER_PATH = 'canvas' in config.ts. This rendering path
 * is consistent with NPC rendering and works with any map projection.
 * 
 * Architecture:
 * 
 * - Creates an HTML5 Canvas element positioned absolutely over the map
 * - Renders player sprite with rotation support
 * - Uses map.project() to convert lat/lng to screen coordinates (works with any projection)
 * - Reads player position from ECS or accepts explicit updates
 * - Supports sprite animations (idle, walking, running) driven by input state
 * - Always displays green outline to indicate player possession
 * 
 * Comparison with PlayerDomView (DOM path):
 * 
 * | Feature              | PlayerDomView (DOM) | PlayerCanvasView (Canvas) |
 * |---------------------|---------------------|----------------------------|
 * | Technology          | DOM + CSS           | Canvas 2D                  |
 * | Performance         | Good (1 sprite)     | Good (1 sprite)            |
 * | Projection Support  | Any                 | Any                        |
 * | Visual Effects      | CSS transforms      | Canvas API                 |
 * | Consistency         | Different from NPCs | Same as NPCs               |
 * | Code Reuse          | Low                 | High (shared utils)        |
 * 
 * Usage:
 * 
 * This layer is automatically used when PLAYER_RENDER_PATH = 'canvas' in config.ts.
 * It's registered with the game loop as a Renderable and Updatable.
 */

import { Renderable, Updatable } from "../loop/GameLoop";
import { world, Position, Rotation, Velocity, PlayerTag } from "../ecs/world";
import { defineQuery } from "bitecs";
import { InputState } from "@shared/realearthstreetwar";
import { SPRITE_ANIMATIONS } from "./utils/spriteAnimations";
import { determineAnimationFromInput, advanceAnimationFrame, createAnimationState, updateAnimationType, AnimationState } from "./utils/animationSystem";
import { calculateSpriteSize, calculateRotationFromVelocity, calculateRotationFromStored } from "./utils/spriteUtils";
import { drawSprite, drawSpriteOutline, loadSpriteImages, SpriteImages } from "./utils/spriteRenderer";

/**
 * Canvas-based player rendering layer.
 * 
 * Renders player sprite on a canvas overlay positioned above the map.
 * Works with any map projection by using map.project() for coordinate conversion.
 * Supports sprite animations (idle, walking, running) driven by input state.
 * Always displays green outline to indicate player possession.
 */
export default class PlayerCanvasView implements Renderable, Updatable {
  /** HTML5 Canvas element for drawing player */
  private canvas: HTMLCanvasElement;
  /** 2D rendering context for the canvas */
  private ctx: CanvasRenderingContext2D;
  /** ECS query to find player entity */
  private query = defineQuery([PlayerTag, Position, Rotation, Velocity]);
  
  /** Player entity ID (set when player spawns) */
  private playerEid: number | null = null;
  
  /** Player position (lat/lng) - can be set explicitly or read from ECS */
  private playerPosition: { lng: number; lat: number } | null = null;
  /** Player rotation in radians */
  private playerRotation: number = 0;
  
  /** Camera state */
  private cameraBearing = 0; // Camera rotation angle (degrees)
  private cameraPitch = 0; // Camera pitch angle (degrees)
  
  /** Input state - used to determine animation type */
  public inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false
  };
  
  /** Animation state */
  private animationState: AnimationState = createAnimationState('idle');
  
  /** Sprite images */
  private spriteImages: SpriteImages = {
    idle: null,
    walking: null,
    running: null
  };
  
  private spritesLoaded = {
    idle: false,
    walking: false,
    running: false
  };
  
  /** Base size multiplier (same as PlayerDomView for consistency) */
  private readonly playerBaseSize = 0.06;
  
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
    
    // Apply CSS image-rendering for crisp pixel art
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.imageRendering = '-moz-crisp-edges';
    this.canvas.style.imageRendering = 'crisp-edges';
    
    // Get 2D rendering context
    this.ctx = this.canvas.getContext('2d')!;
    
    // Disable image smoothing for crisp pixel art sprites
    this.ctx.imageSmoothingEnabled = false;
    
    // Add canvas to map container
    this.map.getContainer().appendChild(this.canvas);

    // Initial resize to match map size
    this.resize();
    // Listen for map resize events to keep canvas in sync
    this.map.on('resize', () => this.resize());
    
    // Load all sprite images asynchronously
    loadSpriteImages((images) => {
      this.spriteImages = images;
      this.spritesLoaded.idle = images.idle !== null;
      this.spritesLoaded.walking = images.walking !== null;
      this.spritesLoaded.running = images.running !== null;
    }).catch((error) => {
      console.error('[PlayerCanvasView] Failed to load sprites:', error);
    });
  }
  
  /**
   * Resize canvas to match map container dimensions.
   * 
   * Called on initialization and whenever the map is resized.
   * Ensures the canvas always covers the entire map viewport.
   * 
   * Accounts for device pixel ratio to prevent blurriness on high-DPI displays.
   */
  private resize(): void {
    const { clientWidth, clientHeight } = this.map.getContainer();
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas internal resolution (scaled by device pixel ratio)
    this.canvas.width = clientWidth * dpr;
    this.canvas.height = clientHeight * dpr;
    
    // Set canvas CSS size to match display size
    this.canvas.style.width = `${clientWidth}px`;
    this.canvas.style.height = `${clientHeight}px`;
    
    // Reset transform and scale the context to account for device pixel ratio
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    // Re-apply image smoothing setting (lost when canvas is resized)
    this.ctx.imageSmoothingEnabled = false;
  }
  
  /**
   * Set player entity ID
   * Called when player spawns or possession transfers
   */
  public setPlayerEntity(eid: number): void {
    this.playerEid = eid;
  }
  
  /**
   * Update player position and rotation explicitly
   * Alternative to reading from ECS (for compatibility with PlayerDomView interface)
   */
  public updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    this.playerPosition = coords;
    this.playerRotation = rotation;
  }
  
  /**
   * Update input state
   * Used to determine animation type
   */
  public updateInputState(input: InputState): void {
    this.inputState = input;
  }
  
  /**
   * Set camera bearing (rotation) angle
   */
  public setCameraBearing(bearing: number): void {
    this.cameraBearing = bearing;
  }
  
  /**
   * Set camera pitch (vertical angle)
   */
  public setCameraPitch(pitch: number): void {
    this.cameraPitch = pitch;
  }
  
  /**
   * Get current player position
   */
  public getPlayerPosition(): { lng: number; lat: number } | null {
    return this.playerPosition;
  }
  
  /**
   * Get current player rotation
   */
  public getPlayerRotation(): number {
    return this.playerRotation;
  }
  
  /**
   * Force a redraw (called when camera moves but position hasn't changed)
   */
  public redraw(): void {
    // Position will be updated in render() method
  }
  
  /**
   * Update character sprite size based on current zoom level
   * Called by MapView during zoom events
   */
  public updateCharacterSize(enableTransition: boolean = false): void {
    // Size is calculated dynamically in render() based on zoom
    // No need to store size separately
  }
  
  /**
   * Updatable implementation – called each frame by GameLoop.
   * 
   * Advances sprite animation frames using an accumulator pattern.
   * 
   * @param deltaMs - Time elapsed since last update (milliseconds)
   */
  public update(deltaMs: number): void {
    // Determine animation type from input state
    const targetAnim = determineAnimationFromInput(this.inputState);
    
    // Update animation type if changed
    this.animationState = updateAnimationType(this.animationState, targetAnim);
    
    // Advance animation frame
    this.animationState = advanceAnimationFrame(this.animationState, deltaMs);
  }
  
  /**
   * Renderable implementation – called each frame by GameLoop.
   * 
   * Renders player sprite on canvas at current position.
   * 
   * @param alpha - Interpolation factor (currently unused)
   */
  public render(alpha: number): void {
    // Ensure image smoothing is disabled
    this.ctx.imageSmoothingEnabled = false;
    
    // Clear the entire canvas before redrawing
    const { clientWidth, clientHeight } = this.map.getContainer();
    this.ctx.clearRect(0, 0, clientWidth, clientHeight);
    
    // Get player position (from ECS or stored position)
    let lng: number, lat: number, rotationDeg: number;
    
    if (this.playerEid !== null) {
      // Read from ECS (preferred method)
      const playerEnts = this.query(world);
      if (playerEnts.length > 0 && playerEnts[0] === this.playerEid) {
        lng = Position.x[this.playerEid];
        lat = Position.y[this.playerEid];
        rotationDeg = Rotation.angle[this.playerEid];
      } else {
        // Player entity not found in ECS, use stored position
        if (!this.playerPosition) return;
        lng = this.playerPosition.lng;
        lat = this.playerPosition.lat;
        rotationDeg = (this.playerRotation * 180) / Math.PI;
      }
    } else {
      // No entity ID set, use stored position
      if (!this.playerPosition) return;
      lng = this.playerPosition.lng;
      lat = this.playerPosition.lat;
      rotationDeg = (this.playerRotation * 180) / Math.PI;
    }
    
    // Project lat/lng to screen coordinates
    const screenPos = this.map.project({ lng, lat });
    
    // Calculate sprite size based on zoom
    const zoom = this.map.getZoom();
    const spriteSize = calculateSpriteSize(this.playerBaseSize, zoom);
    
    // Calculate rotation
    // For now, use stored rotation (could also use velocity like NPCs)
    const rotation = calculateRotationFromStored(rotationDeg, this.cameraBearing);
    
    // Check if sprites are loaded
    const animType = this.animationState.animType;
    if (!this.spritesLoaded[animType] || !this.spriteImages[animType]) {
      return; // Skip rendering if sprite not loaded
    }
    // Draw sprite
    
    drawSprite(this.ctx, this.spriteImages, {
      x: screenPos.x,
      y: screenPos.y,
      rotation: -rotation + Math.PI / 2,
      size: spriteSize,
      animType: this.animationState.animType,
      frame: this.animationState.currentFrame,
      cameraPitch: this.cameraPitch
    });
    
    // Draw green outline (always visible for player)
    drawSpriteOutline(
      this.ctx,
      screenPos.x,
      screenPos.y,
      spriteSize,
      'rgba(0, 255, 0, 0.8)', // Green color for player
      3, // Width
      8  // Blur
    );
  }
  
  /**
   * Clean up resources
   */
  public destroy(): void {
    // Remove canvas from DOM
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    
    // Reset state
    this.playerEid = null;
    this.playerPosition = null;
  }
}

