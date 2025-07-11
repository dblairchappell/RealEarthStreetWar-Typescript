// view/map/MarkerLayer.ts
import { HQType } from "../../model/GameState";
import maplibregl from 'maplibre-gl';

/** Maps HQ type → SVG icon (relative to site root) */
const ICON_MAP: Record<HQType, string> = {
  producer: "icons/drug_farm.svg",
  trafficker: "icons/foot_trafficker.svg",
  retailer: "icons/trade v3.svg",
};

export class MarkerLayer {
  private markers: Array<{
    marker: any;              // MapLibre Marker
    element: HTMLElement;     // Wrapper div we created
    baseSize: number;         // Logical “1.0” before scaling
  }> = [];

  constructor(private map: any) {}

  /* ----------------------------------------------------------
   * Public API
   * -------------------------------------------------------- */
  createHQMarker(coords: { lng: number; lat: number }, type: HQType): any {
    const baseSize = 1;
    const size = this.calculateMarkerSize(baseSize);

    // Container div with custom polygon background
    const el = document.createElement("div");
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
    el.style.cursor = "pointer";
    el.style.display = "flex";
    el.style.justifyContent = "center";
    el.style.alignItems = "top";
    el.style.clipPath =
      "polygon(50% 100%, 15% 60%, 0% 20%, 20% 0%, 80% 0%, 100% 20%, 85% 60%)";

    // Colour & border by type
    if (type === "producer") {
      el.style.backgroundColor = "#4CAF50";
      el.style.border = "4px solid #4CAF50";
    } else if (type === "trafficker") {
      el.style.backgroundColor = "#FFC107";
      el.style.border = "4px solid #FFC107";
    } else {
      el.style.backgroundColor = "#2196F3";
      el.style.border = "4px solid #2196F3";
    }

    // Icon image
    const img = document.createElement("img");
    img.src = ICON_MAP[type];
    img.alt = type;
    img.style.pointerEvents = "none";
    // initial size
    img.style.width = `${size * 0.6}px`;
    img.style.height = `${size * 0.6}px`;
    el.appendChild(img);

    // Create MapLibre marker
    const marker = new maplibregl.Marker({
      element: el,
      anchor: "bottom",
    })
      .setLngLat(coords)
      .addTo(this.map);

    this.markers.push({ marker, element: el, baseSize });
    return marker;
  }

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
