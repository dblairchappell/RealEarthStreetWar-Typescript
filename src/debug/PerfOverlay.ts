import { Updatable } from "../loop/GameLoop";

export default class PerfOverlay implements Updatable {
  private el: HTMLDivElement;

  private visible = true;

  private frameCount = 0;
  private timeAccum = 0;

  constructor() {
    // Create DOM element
    this.el = document.createElement('div');
    this.el.id = 'perf-overlay';
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      padding: '2px 6px',
      background: 'rgba(0,0,0,0.6)',
      color: '#0f0',
      font: '12px monospace',
      zIndex: '9999',
      pointerEvents: 'none',
      userSelect: 'none',
    } as CSSStyleDeclaration);
    document.body.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      // Ctrl+Shift+F1 toggles overlay
      if (e.code === 'F1' && e.ctrlKey && e.shiftKey) {
        this.visible = !this.visible;
        this.el.style.display = this.visible ? 'block' : 'none';
      }
    });
  }

  update(deltaMs: number): void {
    this.frameCount++;
    this.timeAccum += deltaMs;
    if (this.timeAccum >= 1000) {
      const fps = (this.frameCount * 1000) / this.timeAccum;
      const avgMs = this.timeAccum / this.frameCount;
      this.el.textContent = `${fps.toFixed(1)} fps | ${avgMs.toFixed(2)} ms`; // simple average
      this.frameCount = 0;
      this.timeAccum = 0;
    }
  }

  destroy(): void {
    this.el.remove();
  }
} 