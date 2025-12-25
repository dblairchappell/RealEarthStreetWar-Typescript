/**
 * Spatial Grid Utility - Spatial Partitioning for Efficient Collision Detection
 */

export const DEFAULT_CELL_SIZE_DEG = 0.0006;

export class SpatialGrid {
  private grid: Map<number, number[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number = DEFAULT_CELL_SIZE_DEG) {
    this.cellSize = cellSize;
  }

  private cellKey(lng: number, lat: number): number {
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    return (cx << 16) ^ (cy & 0xffff);
  }

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

  getNearbyEntities(lng: number, lat: number): number[] {
    const entities: number[] = [];
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    
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

  clear(): void {
    this.grid.clear();
  }

  getCellCount(): number {
    return this.grid.size;
  }
}

