// view/map/MarkerLayer.ts
import maplibregl from 'maplibre-gl';

export class MarkerLayer {
  private markers: Array<{
    marker: any;              // MapLibre Marker
    element: HTMLElement;     // Wrapper div we created
    baseSize: number;         // Logical "1.0" before scaling
  }> = [];

  constructor(private map: any) {}

  /** Called by MapView’s zoom listeners */
  resizeAll(enableTransition = false): void {
    const zoom = this.map.getZoom();

    this.markers.forEach(({ element, baseSize }) => {
      const size = this.calculateMarkerSize(baseSize, zoom);
      element.style.transition = enableTransition
        ? "width 0.1s ease, height 0.1s ease"
        : "none";
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;

      const img = element.querySelector("img") as HTMLImageElement | null;
      if (img) {
        const iconSize = size * 0.6;
        img.style.transition = enableTransition
          ? "width 0.1s ease, height 0.1s ease"
          : "none";
        img.style.width = `${iconSize}px`;
        img.style.height = `${iconSize}px`;
      }
    });
  }

  destroy(): void {
    this.markers.forEach(({ marker }) => marker.remove());
    this.markers = [];
  }

  /* ----------------------------------------------------------
   * Helpers
   * -------------------------------------------------------- */
  private calculateMarkerSize(base: number, zoom: number = this.map.getZoom()) {
    const scale = Math.pow(2, (zoom - 10) / 1.2);
    return Math.max(1, Math.min(200, base * scale));
  }
}
