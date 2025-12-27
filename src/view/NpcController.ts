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
import { world, Position, Velocity } from '../ecs/world';
import { NpcTag } from '@shared/realearthstreetwar';
import { defineQuery } from "bitecs";
import NpcInstancedLayer from "./NpcInstancedLayer";
import maplibregl from "maplibre-gl";

/**
 * Controller that manages NPC position data and coordinates with the rendering layer.
 * Handles interpolation, coordinate projection, and data preparation for WebGL rendering.
 * Also manages animation state for sprite sheet animations.
 */
export default class NpcController implements Renderable, Updatable {
  // Map instance for coordinate projection
  private map: maplibregl.Map;
  
  // WebGL rendering layer that actually draws the NPCs
  private npcLayer: NpcInstancedLayer;
  
  // Sprite size constants (must match NpcInstancedLayer)
  private static readonly BASE_SIZE_PX = 72;
  
  // ECS query for finding all NPC entities
  // Finds entities that have NpcTag, Position, and Velocity components
  private query = defineQuery([NpcTag, Position, Velocity]);

  // Position history for interpolation
  // Format: Float32Array with [lng0, lat0, lng1, lat1, ...] (2 floats per NPC)
  private prevPositions: Float32Array | null = null; // Previous fixed-timestep snapshot
  private currentPositions: Float32Array | null = null; // Current fixed-timestep snapshot
  
  /** Currently selected NPC entity ID (for red outline) */
  private selectedNpcEid: number | null = null;

  // Animation definitions: frame counts and playback rates
  // Same as NpcLayer and CharacterView for consistency
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
   * Renderable implementation – called each frame by GameLoop for smooth interpolation.
   * 
   * Process:
   * 1. Retrieve latest NPC positions from ECS world
   * 2. Update position history (previous → current)
   * 3. Interpolate between previous and current positions in lat/lng space
   * 4. Project interpolated coordinates to screen space
   * 5. Send screen positions to rendering layer
   * 
   * Interpolation happens in lat/lng space (before projection) for smoother movement,
   * especially when zooming or near map edges where projection distortion occurs.
   * 
   * @param alpha - Interpolation factor (0.0 to 1.0) representing position between
   *                previous fixed update and current fixed update
   */
  render(alpha: number): void {
    /* ---------------- Step 1: Get Latest Position Data ---------------- */
    
    // Query ECS world directly for NPC positions
    // Uses bitecs query to find all entities with NpcTag and Position components
    const ents = this.query(world);
    const count = ents.length;
    const latestLngLat = new Float32Array(count * 2);
    
    // Extract positions from ECS components
    for (let i = 0; i < count; i++) {
      const eid = ents[i]; // Entity ID
      latestLngLat[i * 2] = Position.x[eid];     // lng (stored in Position.x)
      latestLngLat[i * 2 + 1] = Position.y[eid]; // lat (stored in Position.y)
    }

    // Early exit if no NPCs to render
    if (count === 0) {
      this.npcLayer.setPositionsToRender(new Float32Array(), 0);
      this.map.triggerRepaint();
      return;
    }

    /* ---------------- Step 2: Manage Position History for Interpolation ---------------- */
    
    // Position history is needed to interpolate between fixed-timestep snapshots
    // We maintain two snapshots: previous (from last fixed update) and current (from this fixed update)
    
    if (!this.currentPositions || this.currentPositions.length !== latestLngLat.length) {
      // First frame, or number of NPCs changed (spawned/despawned)
      // Initialize both snapshots with current data (no interpolation on first frame)
      this.currentPositions = new Float32Array(latestLngLat);
      this.prevPositions = new Float32Array(latestLngLat);
    } else if (this.currentPositions && this.prevPositions) {
      // Normal frame: shift history forward
      // Previous snapshot becomes the old current snapshot
      this.prevPositions.set(this.currentPositions);
      // Current snapshot gets updated with latest authoritative data
      this.currentPositions.set(latestLngLat);
    }

    /* ---------------- Step 3: Interpolate and Project to Screen Coordinates ---------------- */
    
    // Interpolate between previous and current positions in lat/lng space
    // This provides smoother movement than interpolating in screen space, especially
    // when zooming or when NPCs are near map edges (where projection distortion occurs)
    // 
    // Build vertex buffer with animation data
    // Format: [x, y, frameIndex, animType] per NPC (4 floats per NPC)
    const vertexData = new Float32Array(count * 4);
    
    if (this.prevPositions && this.currentPositions) {
      for (let i = 0; i < count; i++) {
        const eid = ents[i]; // Entity ID for this NPC
        
        // Get previous position (from last fixed update)
        const prevLng = this.prevPositions[i * 2];
        const prevLat = this.prevPositions[i * 2 + 1];

        // Get current position (from this fixed update)
        const currentLng = this.currentPositions[i * 2];
        const currentLat = this.currentPositions[i * 2 + 1];

        // Linear interpolation in lat/lng space
        // alpha = 0: use previous position
        // alpha = 1: use current position
        // alpha = 0.5: halfway between (typical case)
        const lng = prevLng + (currentLng - prevLng) * alpha;
        const lat = prevLat + (currentLat - prevLat) * alpha;
        
        // Project interpolated lat/lng to screen coordinates
        // map.project() handles projection math (Mercator, globe, etc.)
        const screenPos = this.map.project({ lng, lat });
        
        // Round to nearest pixel for crisp rendering
        // WebGL point sprites are centered on the point position
        const screenX = Math.round(screenPos.x);
        const screenY = Math.round(screenPos.y);
        
        // Get animation state for this NPC
        const animState = this.npcAnimationState.get(eid);
        const frame = animState ? animState.currentFrame : 0;
        const animType = animState ? animState.animType : 'idle';
        
        // Store vertex data: [x, y, frameIndex, animType]
        vertexData[i * 4] = screenX;
        vertexData[i * 4 + 1] = screenY;
        vertexData[i * 4 + 2] = frame;
        vertexData[i * 4 + 3] = this.animTypeToFloat(animType);
      }
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