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
 * - **Rendering Coordination**: Sends pre-calculated screen positions to NpcInstancedLayer
 * 
 * **Architecture:**
 * - Implements `Renderable` interface, called each frame by GameLoop with interpolation alpha
 * - Works with `NpcInstancedLayer` which performs the actual WebGL rendering
 * - Queries ECS world directly for NPC positions
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

import { Renderable } from "../loop/GameLoop";
import { world, Position } from '../ecs/world';
import { NpcTag } from '@shared/realearthstreetwar';
import { defineQuery } from "bitecs";
import NpcInstancedLayer from "./NpcInstancedLayer";
import maplibregl from "maplibre-gl";

/**
 * Controller that manages NPC position data and coordinates with the rendering layer.
 * Handles interpolation, coordinate projection, and data preparation for WebGL rendering.
 */
export default class NpcController implements Renderable {
  // Map instance for coordinate projection
  private map: maplibregl.Map;
  
  // WebGL rendering layer that actually draws the NPCs
  private npcLayer: NpcInstancedLayer;
  
  // ECS query for finding all NPC entities
  // Finds entities that have both NpcTag and Position components
  private query = defineQuery([NpcTag, Position]);

  // Position history for interpolation
  // Format: Float32Array with [lng0, lat0, lng1, lat1, ...] (2 floats per NPC)
  private prevPositions: Float32Array | null = null; // Previous fixed-timestep snapshot
  private currentPositions: Float32Array | null = null; // Current fixed-timestep snapshot
  
  /** Currently selected NPC entity ID (for red outline) */
  private selectedNpcEid: number | null = null;
  
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
    const interpolatedScreenPos = new Float32Array(count * 2); // Screen coordinates [x0, y0, x1, y1, ...]
    
    if (this.prevPositions && this.currentPositions) {
      for (let i = 0; i < count; i++) {
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
        interpolatedScreenPos[i * 2] = Math.round(screenPos.x);
        // TODO: The +100 Y offset is a workaround for sprite anchor point mismatch
        // This should be replaced with a dynamic offset based on sprite size
        interpolatedScreenPos[i * 2 + 1] = Math.round(screenPos.y + 100);
      }
    }

    /* ---------------- Step 4: Send Data to Rendering Layer ---------------- */
    
    // Send interpolated screen positions to WebGL rendering layer
    // NpcInstancedLayer will render all NPCs in a single GPU draw call
    this.npcLayer.setPositionsToRender(interpolatedScreenPos, count);

    /* ---------------- Step 5: Trigger Map Repaint ---------------- */
    
    // Notify MapLibre that custom layer data has changed and needs redrawing
    // This ensures the NPCs are rendered on the next frame
    this.map.triggerRepaint();
  }
} 