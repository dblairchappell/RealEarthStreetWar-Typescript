/**
 * PlayerController - Player Position Management and Rendering Coordination for WebGL
 * 
 * PlayerController acts as the bridge between the game simulation and WebGL rendering
 * for the player character. It handles position reading, coordinate projection,
 * animation state management, and prepares data for efficient GPU rendering.
 * 
 * **Key Responsibilities:**
 * - **Position Retrieval**: Gets player position from ECS world
 * - **Coordinate Projection**: Converts lat/lng coordinates to screen space for rendering
 * - **Animation State**: Tracks animation frames and types for sprite sheet animations
 * - **Rendering Coordination**: Sends pre-calculated screen positions and animation data to NpcInstancedLayer
 * 
 * **Architecture:**
 * - Implements `Renderable` interface, called each frame by GameLoop
 * - Implements `Updatable` interface, called each frame to advance animation frames
 * - Works with `NpcInstancedLayer` which performs the actual WebGL rendering
 * - Reads player position from ECS components directly
 * 
 * **Performance:**
 * - Pre-calculates screen position once per frame
 * - Uses Float32Array for efficient memory layout
 * - Minimal per-frame allocations
 * - Single projection call per frame
 * 
 * **Usage:**
 * Created by MapView and registered with GameLoop as a Renderable and Updatable.
 * Automatically reads player position from ECS when playerEid is set.
 */

import { Renderable, Updatable } from "../loop/GameLoop";
import { world, Position, Rotation, Velocity, PlayerTag } from '../ecs/world';
import { defineQuery } from "bitecs";
import NpcInstancedLayer from "./NpcInstancedLayer";
import maplibregl from "maplibre-gl";
import { calculateRotationFromStored } from "./utils/spriteUtils";
import { determineAnimationFromInput, advanceAnimationFrame, createAnimationState, updateAnimationType, AnimationState } from "./utils/animationSystem";
import { InputState } from "@shared/realearthstreetwar";

/**
 * Controller that manages player position data and coordinates with the WebGL rendering layer.
 * Handles coordinate projection and data preparation for WebGL rendering.
 * Also manages animation state for sprite sheet animations.
 * 
 * Uses stored rotation from ECS (Rotation.angle) - consistent with NPCs and Canvas path.
 */
export default class PlayerController implements Renderable, Updatable {
  // Map instance for coordinate projection
  private map: maplibregl.Map;
  
  // WebGL rendering layer that actually draws the player
  private npcLayer: NpcInstancedLayer;
  
  // ECS query for finding player entity
  // Finds entities that have PlayerTag, Position, and Rotation components
  private query = defineQuery([PlayerTag, Position, Rotation, Velocity]);
  
  // Player entity ID (set when player spawns)
  private playerEid: number | null = null;

  // Animation state (using shared animation system)
  private animationState: AnimationState = createAnimationState('idle');

  // Input state - used to determine animation type
  public inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false
  };

  // Animation definitions: frame counts and playback rates
  // Same as NpcController and CharacterView for consistency
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

  /**
   * Constructs a new PlayerController.
   * 
   * @param map - MapLibre map instance for coordinate projection
   * @param npcLayer - WebGL rendering layer that will draw the player
   */
  constructor(map: maplibregl.Map, npcLayer: NpcInstancedLayer) {
    this.map = map;
    this.npcLayer = npcLayer;
  }

  /**
   * Sets the player entity ID.
   * Called when player spawns or possession transfers.
   * 
   * @param eid - ECS entity ID of the player
   */
  public setPlayerEntity(eid: number): void {
    this.playerEid = eid;
  }

  /**
   * Updates input state.
   * Used to determine animation type.
   * 
   * @param input - Current input state
   */
  public updateInputState(input: InputState): void {
    this.inputState = input;
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
   * Reads player position directly from ECS and projects to screen coordinates.
   * Sends vertex data to WebGL rendering layer.
   * 
   * @param alpha - Interpolation factor (unused - reading directly from ECS)
   */
  render(alpha: number): void {
    // Early exit if player entity not set
    if (this.playerEid === null) {
      this.npcLayer.setPlayerVertexData(null);
      return;
    }

    // Query ECS world for player entity
    const ents = this.query(world);
    if (ents.length === 0 || ents[0] !== this.playerEid) {
      // Player entity not found
      this.npcLayer.setPlayerVertexData(null);
      return;
    }

    const eid = this.playerEid;
    
    // Read position directly from ECS
    const lng = Position.x[eid];
    const lat = Position.y[eid];
    
    // Project lat/lng to screen coordinates
    const screenPos = this.map.project({ lng, lat });
    
    // Round to nearest pixel for crisp rendering
    const screenX = Math.round(screenPos.x);
    const screenY = Math.round(screenPos.y);
    
    // Use stored rotation from ECS (consistent with NPCs and Canvas path)
    const rotationDeg = Rotation.angle[eid] || 0;
    const rotation = calculateRotationFromStored(rotationDeg, this.map.getBearing());
    
    // Get animation state
    const frame = this.animationState.currentFrame;
    const animType = this.animationState.animType;
    
    // Build vertex data: [x, y, frameIndex, animType, rotation] (5 floats)
    const vertexData = new Float32Array(5);
    vertexData[0] = screenX;
    vertexData[1] = screenY;
    vertexData[2] = frame;
    vertexData[3] = this.animTypeToFloat(animType);
    vertexData[4] = rotation;
    
    // Send vertex data to WebGL rendering layer
    this.npcLayer.setPlayerVertexData(vertexData);
    
    // Trigger map repaint to ensure player is rendered
    // Note: NpcController also triggers repaint, but this ensures player data is included
    this.map.triggerRepaint();
  }
}

