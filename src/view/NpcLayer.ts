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
 * - Renders NPCs as small red squares (3px) for simple visualization
 * - Uses map.project() to convert lat/lng to screen coordinates (works with any projection)
 * - Supports both worker mode and main-thread simulation
 * 
 * Comparison with NpcInstancedLayer:
 * 
 * | Feature              | NpcInstancedLayer | NpcLayer        |
 * |---------------------|-------------------|-----------------|
 * | Technology          | WebGL (GPU)       | Canvas 2D (CPU) |
 * | Performance         | Fast              | Slower          |
 * | Projection Support  | Mercator only     | Any projection  |
 * | Visual Quality      | Sprites           | Simple squares  |
 * | Complexity          | High              | Low             |
 * 
 * Usage:
 * 
 * This layer is automatically used when ENABLE_GLOBE = true in config.ts.
 * It's registered with the game loop as a Renderable and called each frame.
 * 
 * Note: The alpha parameter from Renderable interface is currently unused.
 * Interpolation could be added in the future for smoother movement.
 */

import { Renderable } from "../loop/GameLoop";
import { defineQuery } from "bitecs";
import { world } from "../ecs/world";
import { Position } from "../ecs/world";
import { NpcTag } from "../ecs/components/NpcTag";
import { bridge } from "../sim/SimulationBridge";

/**
 * Canvas-based NPC rendering layer.
 * 
 * Renders NPCs as small red squares on a canvas overlay positioned above the map.
 * Works with any map projection by using map.project() for coordinate conversion.
 */
export default class NpcLayer implements Renderable {
  /** HTML5 Canvas element for drawing NPCs */
  private canvas: HTMLCanvasElement;
  /** 2D rendering context for the canvas */
  private ctx: CanvasRenderingContext2D;
  /** ECS query to find all NPC entities (used in main-thread mode) */
  private query = defineQuery([NpcTag, Position]);

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
    
    // Get 2D rendering context
    this.ctx = this.canvas.getContext('2d')!;
    
    // Add canvas to map container
    this.map.getContainer().appendChild(this.canvas);

    // Initial resize to match map size
    this.resize();
    // Listen for map resize events to keep canvas in sync
    this.map.on('resize', () => this.resize());
  }

  /**
   * Resize canvas to match map container dimensions.
   * 
   * Called on initialization and whenever the map is resized.
   * Ensures the canvas always covers the entire map viewport.
   */
  private resize() {
    const { clientWidth, clientHeight } = this.map.getContainer();
    this.canvas.width = clientWidth;
    this.canvas.height = clientHeight;
  }

  /**
   * Render NPCs on the canvas.
   * 
   * Called each frame by the game loop. Clears the canvas and redraws
   * all NPCs as small red squares at their current positions.
   * 
   * Supports two data sources:
   * - Worker mode: Reads positions from SimulationBridge snapshot
   * - Main thread: Queries ECS world directly
   * 
   * Note: The alpha parameter is currently unused but could be used
   * for interpolation between fixed timesteps in the future.
   * 
   * @param alpha - Interpolation factor (0.0 to 1.0), currently unused
   */
  render(alpha: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    /**
     * Clear the entire canvas before redrawing.
     * This ensures NPCs don't leave trails when they move.
     */
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    /**
     * NPC visualization: small red squares.
     * Size is constant in screen pixels (3px) so NPCs remain visible
     * at all zoom levels but don't cover the map.
     */
    const size = 3; // constant size in screen pixels
    ctx.fillStyle = 'rgba(200,0,0,0.6)';  // Semi-transparent red

    /**
     * Get NPC positions from appropriate source based on simulation mode.
     */
    if (bridge.isWorkerEnabled()) {
      /**
       * Worker mode: Read positions from simulation bridge snapshot.
       * The snapshot contains 3 floats per NPC: lng, lat, rot.
       */
      const snap = bridge.getLatestNpcSnapshot();
      if (!snap) return;
      
      // Iterate through snapshot (3 floats per NPC)
      for (let i = 0; i < snap.length; i += 3) {
        const lng = snap[i];      // Longitude
        const lat = snap[i + 1];   // Latitude
        // Rotation (snap[i + 2]) is available but not used for simple squares
        
        // Project lat/lng to screen coordinates (works with any projection)
        const p = this.map.project({ lng, lat });
        
        // Draw square centered on NPC position
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    } else {
      /**
       * Main thread mode: Query ECS world directly.
       * Uses bitecs query to find all entities with NpcTag and Position components.
       */
      const ents = this.query(world);
      for (let i = 0; i < ents.length; i++) {
        const eid = ents[i];
        const lng = Position.x[eid];
        const lat = Position.y[eid];
        
        // Project lat/lng to screen coordinates
        const p = this.map.project({ lng, lat });
        
        // Draw square centered on NPC position
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }
  }
} 