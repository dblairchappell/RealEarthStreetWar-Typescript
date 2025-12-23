import { Renderable } from "../loop/GameLoop";
import { bridge } from "../sim/SimulationBridge";
import { world, Position } from '../ecs/world';
import { NpcTag } from '../ecs/components/NpcTag';
import { defineQuery } from "bitecs";
import NpcInstancedLayer from "./NpcInstancedLayer";
import maplibregl from "maplibre-gl";

export default class NpcController implements Renderable {
  private map: maplibregl.Map;
  private npcLayer: NpcInstancedLayer;
  private query = defineQuery([NpcTag, Position]);

  // State for interpolation
  private prevPositions: Float32Array | null = null;
  private currentPositions: Float32Array | null = null;
  
  constructor(map: maplibregl.Map, npcLayer: NpcInstancedLayer) {
    this.map = map;
    this.npcLayer = npcLayer;
  }

  render(alpha: number): void {
    // 1. Get the latest data from the simulation
    let latestLngLat: Float32Array;
    let count: number;

    if (bridge.isWorkerEnabled()) {
      const snap = bridge.getLatestNpcSnapshot();
      if (!snap) return;
      count = snap.length / 3;
      latestLngLat = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        latestLngLat[i * 2] = snap[i * 3];     // lng
        latestLngLat[i * 2 + 1] = snap[i * 3 + 1]; // lat
      }
    } else {
      const ents = this.query(world);
      count = ents.length;
      latestLngLat = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const eid = ents[i];
        latestLngLat[i * 2] = Position.x[eid];
        latestLngLat[i * 2 + 1] = Position.y[eid];
      }
    }

    if (count === 0) {
      this.npcLayer.setPositionsToRender(new Float32Array(), 0);
      this.map.triggerRepaint();
      return;
    }

    // 2. Manage position history for interpolation
    if (!this.currentPositions || this.currentPositions.length !== latestLngLat.length) {
      // First frame, or number of NPCs changed
      this.currentPositions = new Float32Array(latestLngLat);
      this.prevPositions = new Float32Array(latestLngLat);
    } else if (this.currentPositions && this.prevPositions) {
      // Shift history: current becomes previous
      this.prevPositions.set(this.currentPositions);
      // Update current with the latest data
      this.currentPositions.set(latestLngLat);
    }

    // 3. Interpolate and project to screen coordinates
    const interpolatedScreenPos = new Float32Array(count * 2);
    if (this.prevPositions && this.currentPositions) {
        for (let i = 0; i < count; i++) {
            const prevLng = this.prevPositions[i * 2];
            const prevLat = this.prevPositions[i * 2 + 1];

            const currentLng = this.currentPositions[i * 2];
            const currentLat = this.currentPositions[i * 2 + 1];

            // Linear interpolation
            const lng = prevLng + (currentLng - prevLng) * alpha;
            const lat = prevLat + (currentLat - prevLat) * alpha;
            
            // Project to screen and round to nearest pixel
            const screenPos = this.map.project({ lng, lat });
            interpolatedScreenPos[i * 2] = Math.round(screenPos.x);
            interpolatedScreenPos[i * 2 + 1] = Math.round(screenPos.y + 100);
        }
    }

    // 4. Send the final, smoothed data to the rendering layer
    this.npcLayer.setPositionsToRender(interpolatedScreenPos, count);

    // 5. Trigger a repaint to draw the layer with the new data
    this.map.triggerRepaint();
  }
} 