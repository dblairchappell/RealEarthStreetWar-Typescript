/**
 * NpcController - NPC Position Management and Rendering Coordination
 * 
 * NpcController acts as the bridge between the game simulation and rendering
 * and the WebGL rendering layer (NpcInstancedLayer). It handles position interpolation,
 * coordinate projection, and prepares data for efficient GPU rendering.
 * 
 * **Key Responsibilities:**
 * - **Position Retrieval**: Gets NPC positions from ECS world
 * - **Position History**: Maintains previous and current position snapshots for interpolation
 * - **Interpolation**: Smoothly interpolates between fixed-timestep positions using alpha
 * - **Coordinate Projection**: Converts lat/lng coordinates to screen space for rendering
 * - **Animation State**: Tracks animation frames and types per NPC for sprite sheet animations
 * - **Rendering Coordination**: Sends pre-calculated screen positions and animation data to NpcInstancedLayer
 * 
 * **Architecture:**
 * - Implements `Renderable` interface, called each frame by GameLoop with interpolation alpha
 * - Implements `Updatable` interface, called each frame to advance animation frames
 * - Works with `NpcInstancedLayer` which performs the actual WebGL rendering
 * - Queries ECS world directly for NPC positions and velocities
 * 
 * **Interpolation Strategy:**
 * Unlike NpcLayer (which interpolates in screen space), NpcController interpolates in
 * lat/lng space before projecting. This provides smoother movement, especially when
 * zooming or when NPCs are near map edges where projection distortion is significant.
 * 
 * **Performance:**
 * - Pre-calculates all screen positions in one pass
 * - Uses Float32Array for efficient memory layout
 * - Minimizes per-frame allocations
 * - Single projection call per NPC (done once per frame)
 * 
 * **Comparison with NpcLayer:**
 * - `NpcLayer`: Canvas-based fallback, simpler, interpolates in screen space
 * - `NpcController`: WebGL-optimized, pre-calculates positions, interpolates in lat/lng space
 * 
 * **Usage:**
 * Created by MapView and registered with GameLoop as a Renderable. Automatically
 * queries ECS world directly for NPC positions.
 */

import { Renderable, Updatable } from "../loop/GameLoop";
import { world, Position, Velocity, Rotation } from '../ecs/world';
import { NpcTag } from '@shared/realearthstreetwar';
import { defineQuery } from "bitecs";
import NpcInstancedLayer from "./NpcInstancedLayer";
import maplibregl from "maplibre-gl";
import { calculateRotationFromStored } from "./utils/spriteUtils";

/**
 * Controller that manages NPC position data and coordinates with the rendering layer.
 * Handles interpolation, coordinate projection, and data preparation for WebGL rendering.
 * Also manages animation state for sprite sheet animations.
 * 
 * Uses stored rotation from ECS (Rotation.angle) - consistent with player and Canvas path.
 */
export default class NpcController implements Renderable, Updatable {
  // Map instance for coordinate projection
  private map: maplibregl.Map;
  
  // WebGL rendering layer that actually draws the NPCs
  private npcLayer: NpcInstancedLayer;
  
  // ECS query for finding all NPC entities
  // Finds entities that have NpcTag, Position, and Velocity components
  private query = defineQuery([NpcTag, Position, Velocity]);

  // Position history removed - reading directly from ECS each frame (like Canvas path)
  // This avoids interpolation issues when server snapshots arrive infrequently
  
  /** Currently selected NPC entity ID (for red outline) */
  private selectedNpcEid: number | null = null;

  // Animation definitions: frame counts and playback rates
  // Same as NpcLayer and PlayerDomView for consistency
  private readonly animations = {
    idle: {
      frames: 31,
      frameRate: 12 // 12 frames per second
    },
    walking: {
      frames: 31,
      frameRate: 24 // Faster frame rate for walking animation
    },
    running: {
      frames: 23,
      frameRate: 30 // Fastest frame rate for running animation
    }
  };

  // Per-NPC animation state (for speed-scaled animations)
  // Maps entity ID to frame accumulator and current frame
  private npcAnimationState: Map<number, {
    accumulator: number;
    currentFrame: number;
    animType: 'idle' | 'walking' | 'running';
  }> = new Map();

  // Velocity threshold for determining animation type
  // Below this threshold: idle, above: walking or running
  private readonly velocityThreshold = 0.0000001; // Small threshold to detect movement

  // Storage for NPC speeds (from server snapshot) - used for animation scaling
  private npcSpeeds: Map<number, number> = new Map();
  private readonly baseSpeed = 0.000000225; // Same as BASE_SPEED on server
  
  /**
   * Constructs a new NpcController.
   * 
   * @param map - MapLibre map instance for coordinate projection
   * @param npcLayer - WebGL rendering layer that will draw the NPCs
   */
  constructor(map: maplibregl.Map, npcLayer: NpcInstancedLayer) {
    this.map = map;
    this.npcLayer = npcLayer;
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
    // if (speed > walkingSpeed * 1.5) {
    //   return 'running';
    // }
    
    return 'walking';
  }

  /**
   * Update NPC speed for animation scaling
   * Called by NetworkStateManager when NPC data is received
   */
  public updateNpcSpeed(eid: number, speed: number): void {
    this.npcSpeeds.set(eid, speed);
  }

  /**
   * Remove NPC speed when NPC is removed
   */
  public removeNpcSpeed(eid: number): void {
    this.npcSpeeds.delete(eid);
  }

  /**
   * Converts animation type to float for shader (0.0 = idle, 1.0 = walking, 2.0 = running)
   */
  private animTypeToFloat(type: 'idle' | 'walking' | 'running'): number {
    return type === 'idle' ? 0.0 : type === 'walking' ? 1.0 : 2.0;
  }
  
  /**
   * Updatable implementation – called each frame by GameLoop for animation updates.
   * 
   * Advances sprite animation frames using an accumulator pattern.
   * This ensures animations play at the correct rate regardless of frame time variations.
   * 
   * @param deltaMs - Time elapsed since last update (milliseconds)
   */
  public update(deltaMs: number): void {
    // Query ECS world for NPCs to get current animation types
    const ents = this.query(world);
    
    // Update animation frames for each NPC based on their speed
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      
      // Get velocity to determine animation type
      const velocityX = Velocity.x[eid] || 0;
      const velocityY = Velocity.y[eid] || 0;
      const animType = this.determineAnimationType(velocityX, velocityY);
      
      // Get or create animation state for this NPC
      let animState = this.npcAnimationState.get(eid);
      if (!animState) {
        animState = {
          accumulator: 0,
          currentFrame: 0,
          animType: animType
        };
        this.npcAnimationState.set(eid, animState);
      }
      
      // Update animation type if it changed
      if (animState.animType !== animType) {
        animState.animType = animType;
        animState.currentFrame = 0; // Reset to first frame when animation changes
        animState.accumulator = 0;
      }
      
      // Get base frame rate for this animation type
      const anim = this.animations[animType];
      const baseFrameRate = anim.frameRate;
      
      // Scale frame rate based on NPC speed (faster NPCs animate faster)
      const npcSpeed = this.npcSpeeds.get(eid) || this.baseSpeed;
      const speedRatio = npcSpeed / this.baseSpeed;
      const scaledFrameRate = baseFrameRate * speedRatio;
      const frameDuration = 1000 / scaledFrameRate;
      
      // Accumulate elapsed time
      animState.accumulator += deltaMs;
      
      // Advance frames until caught up (handles frame drops)
      while (animState.accumulator >= frameDuration) {
        // Advance to next frame (wraps around using modulo)
        animState.currentFrame = (animState.currentFrame + 1) % anim.frames;
        
        // Subtract frame duration from accumulator (preserve remainder)
        animState.accumulator -= frameDuration;
      }
    }
    
    // Clean up animation state for NPCs that no longer exist
    const existingEids = new Set(ents);
    for (const eid of this.npcAnimationState.keys()) {
      if (!existingEids.has(eid)) {
        this.npcAnimationState.delete(eid);
      }
    }
  }

  /**
   * Renderable implementation – called each frame by GameLoop.
   * 
   * Reads NPC positions directly from ECS (like Canvas path) and projects to screen coordinates.
   * No interpolation - matches Canvas behavior for consistency.
   * 
   * @param alpha - Interpolation factor (unused - reading directly from ECS)
   */
  render(alpha: number): void {
    /* ---------------- Step 1: Get NPC Positions from ECS ---------------- */
    
    // Query ECS world directly for NPC positions (same as Canvas path)
    const ents = this.query(world);
    const count = ents.length;

    // Early exit if no NPCs to render
    if (count === 0) {
      this.npcLayer.setPositionsToRender(new Float32Array(), 0);
      this.map.triggerRepaint();
      return;
    }

    /* ---------------- Step 2: Project to Screen Coordinates and Calculate Rotation ---------------- */
    
    // Build vertex buffer with animation data and rotation
    // Format: [x, y, frameIndex, animType, rotation] per NPC (5 floats per NPC)
    const vertexData = new Float32Array(count * 5);
    
    for (let i = 0; i < count; i++) {
      const eid = ents[i]; // Entity ID for this NPC
      
      // Read position directly from ECS (no interpolation, like Canvas path)
      const lng = Position.x[eid];
      const lat = Position.y[eid];
      
      // Project lat/lng to screen coordinates
      // map.project() handles projection math (Mercator, globe, etc.)
      const screenPos = this.map.project({ lng, lat });
      
      // Round to nearest pixel for crisp rendering
      // WebGL point sprites are centered on the point position
      const screenX = Math.round(screenPos.x);
      const screenY = Math.round(screenPos.y);
      
      // Get velocity to determine animation type
      const velocityX = Velocity.x[eid] || 0;
      const velocityY = Velocity.y[eid] || 0;
      
      // Use stored rotation from ECS (consistent with player and Canvas path)
      // Rotation.angle is stored in degrees (game system: 0° = north)
      // This allows NPCs to face a direction independently of movement,
      // supporting more complex AI behaviors and consistent idle facing
      const rotationDeg = Rotation.angle[eid] || 0;
      const rotation = calculateRotationFromStored(rotationDeg, this.map.getBearing());
      
      // Get animation state for this NPC
      const animState = this.npcAnimationState.get(eid);
      const frame = animState ? animState.currentFrame : 0;
      const animType = animState ? animState.animType : 'idle';
      
      // Store vertex data: [x, y, frameIndex, animType, rotation]
      vertexData[i * 5] = screenX;
      vertexData[i * 5 + 1] = screenY;
      vertexData[i * 5 + 2] = frame;
      vertexData[i * 5 + 3] = this.animTypeToFloat(animType);
      vertexData[i * 5 + 4] = rotation;
    }

    /* ---------------- Step 4: Send Data to Rendering Layer ---------------- */
    
    // Send vertex data (positions + animation data) to WebGL rendering layer
    // NpcInstancedLayer will render all NPCs in a single GPU draw call
    this.npcLayer.setVertexData(vertexData, count);

    /* ---------------- Step 5: Trigger Map Repaint ---------------- */
    
    // Notify MapLibre that custom layer data has changed and needs redrawing
    // This ensures the NPCs are rendered on the next frame
    this.map.triggerRepaint();
  }
} 