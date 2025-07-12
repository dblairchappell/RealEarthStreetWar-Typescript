import { Renderable } from "../loop/GameLoop";
import { defineQuery } from "bitecs";
import { world } from "../ecs/world";
import { Position } from "../ecs/world";
import { NpcTag } from "../ecs/components/NpcTag";
import { bridge } from "../sim/SimulationBridge";

export default class NpcLayer implements Renderable {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private query = defineQuery([NpcTag, Position]);

  constructor(private map: any) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.pointerEvents = 'none';
    this.ctx = this.canvas.getContext('2d')!;
    this.map.getContainer().appendChild(this.canvas);

    this.resize();
    this.map.on('resize', () => this.resize());
  }

  private resize() {
    const { clientWidth, clientHeight } = this.map.getContainer();
    this.canvas.width = clientWidth;
    this.canvas.height = clientHeight;
  }

  render(alpha: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const size = Math.max(2, Math.pow(2, this.map.getZoom() - 12));
    ctx.fillStyle = 'rgba(200,0,0,0.6)';

    if (bridge.isWorkerEnabled()) {
      const snap = bridge.getLatestNpcSnapshot();
      if (!snap) return;
      // 3 floats per NPC: lng, lat, rot
      for (let i = 0; i < snap.length; i += 3) {
        const lng = snap[i];
        const lat = snap[i + 1];
        const p = this.map.project({ lng, lat });
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    } else {
      const ents = this.query(world);
      for (let i = 0; i < ents.length; i++) {
        const eid = ents[i];
        const lng = Position.x[eid];
        const lat = Position.y[eid];
        const p = this.map.project({ lng, lat });
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }
  }
} 