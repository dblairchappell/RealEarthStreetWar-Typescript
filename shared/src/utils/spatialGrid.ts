/**
 * Spatial Grid Utility - Spatial Partitioning for Efficient Collision Detection
 * 
 * This module provides a spatial hash grid implementation for efficiently
 * partitioning entities in 2D space. It's used for collision detection and
 * proximity queries, reducing the complexity from O(n²) to O(n) for most cases.
 * 
 * The grid divides the world into cells of a fixed size. Entities are assigned
 * to cells based on their position, and queries can efficiently find nearby
 * entities by checking only the relevant cells.
 * 
 * Usage:
 * 
 * ```typescript
 * const grid = new SpatialGrid(0.0006); // Cell size in degrees
 * grid.rebuild(allEntities, Position); // Rebuild grid with entities
 * const nearby = grid.getNearbyEntities(lng, lat); // Get entities in 3x3 cell area
 * ```
 */

/**
 * Size of each grid cell in degrees (approximately 66 meters at equator).
 * This is a reasonable size for character collision detection - large enough
 * to contain multiple entities, small enough to minimize unnecessary checks.
 */
export const DEFAULT_CELL_SIZE_DEG = 0.0006;

/**
 * Spatial hash grid for efficient spatial queries.
 * Maps cell keys (integers) to arrays of entity IDs.
 */
export class SpatialGrid {
  private grid: Map<number, number[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number = DEFAULT_CELL_SIZE_DEG) {
    this.cellSize = cellSize;
  }

  /**
   * Generates a unique key for a grid cell based on longitude and latitude.
   * Uses bit manipulation to combine X and Y cell coordinates into a single integer.
   * 
   * @param lng - Longitude in degrees
   * @param lat - Latitude in degrees
   * @returns Unique integer key for the grid cell
   */
  private cellKey(lng: number, lat: number): number {
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    // Combine X and Y into single integer: X in upper 16 bits, Y in lower 16 bits
    return (cx << 16) ^ (cy & 0xffff);
  }

  /**
   * Rebuilds the spatial hash grid with current entity positions.
   * Groups entities by their grid cell for efficient spatial queries.
   * 
   * Should be called after entities move, typically once per frame.
   * 
   * @param entities - Array of entity IDs to add to the grid
   * @param Position - Position component from ECS world (typed array with x and y properties)
   */
  rebuild(entities: number[], Position: { x: { [key: number]: number }; y: { [key: number]: number } }): void {
    this.grid.clear();
    for (let i = 0; i < entities.length; i++) {
      const eid = entities[i];
      const key = this.cellKey(Position.x[eid], Position.y[eid]);
      let arr = this.grid.get(key);
      if (!arr) {
        arr = [];
        this.grid.set(key, arr);
      }
      arr.push(eid);
    }
  }

  /**
   * Gets all entities in a cell and its 8 neighbors (3x3 grid).
   * This ensures we check collisions even when entities are near cell boundaries.
   * 
   * @param lng - Longitude in degrees
   * @param lat - Latitude in degrees
   * @returns Array of entity IDs in nearby cells
   */
  getNearbyEntities(lng: number, lat: number): number[] {
    const entities: number[] = [];
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    
    // Check 3x3 grid of cells (current cell + 8 neighbors)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = ((cx + dx) << 16) ^ ((cy + dy) & 0xffff);
        const cellEntities = this.grid.get(key);
        if (cellEntities) {
          entities.push(...cellEntities);
        }
      }
    }
    return entities;
  }

  /**
   * Clears the grid, removing all entities.
   */
  clear(): void {
    this.grid.clear();
  }

  /**
   * Gets the number of cells currently in use.
   * Useful for debugging and performance monitoring.
   */
  getCellCount(): number {
    return this.grid.size;
  }
}

