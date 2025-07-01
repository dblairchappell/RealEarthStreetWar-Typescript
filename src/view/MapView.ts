// view/MapView.ts
import * as turf from "@turf/turf";

// Callback interface for MapView to communicate with controller
export interface MapViewCallbacks {
  onBuildingClick: (coords: { lng: number; lat: number }) => void;
  isPlantingMode: () => boolean;
}

export default class MapView {
  private map: any;
  
  // HUD elements
  private plantHqBtn!: HTMLElement | null;
  private hqCountEl!: HTMLElement | null;

  // Callbacks for communicating with controller
  private callbacks: MapViewCallbacks | null = null;

  constructor(containerId: string = 'map') {
    // Set up PMTiles protocol for loading .pmtiles files
    let protocol = new (window as any).pmtiles.Protocol();
    (window as any).maplibregl.addProtocol("pmtiles", protocol.tile);

    // MapLibre GL JS doesn't require an access token for open data sources
    this.map = new (window as any).maplibregl.Map({
      container: containerId,
      style: 'offline-map-style.json',
      center: [-74.5, 40], // starting position [lng, lat]
      zoom: 13, // start a bit closer to see details
      pitch: 60, // tilt for 3-D perspective
      bearing: -20, // slight rotation for depth perception
      antialias: true
    });

    // Query HUD elements
    this.queryHudElements();

    // Handle missing images and fonts gracefully
    this.map.on('styleimagemissing', (e: any) => {
      // Create a dummy-placeholder image for any missing icons
      const width = 1;
      const height = 1;
      const data = new Uint8Array([0, 0, 0, 0]);
      if (!this.map.hasImage(e.id)) {
        this.map.addImage(e.id, { width, height, data });
      }
    });

    this.map.on('error', (e: any) => {
      // Suppress harmless tile loading errors
      if (e.error?.message === 'Failed to fetch' && e.source?.url?.includes('pmtiles://')) {
        return;
      }
      console.error('Map error:', e);
    });

    this.map.on('load', () => {
      this.setupLayers();
      this.setupMapEventHandlers();
    });
  }

  private queryHudElements() {
    this.plantHqBtn = document.getElementById('plant-hq-btn');
    this.hqCountEl = document.getElementById('gang-count');
  }

  private setupLayers() {
    // Source and layer to show the HQ's circle of influence
    this.map.addSource('influence-area', { 
      type: 'geojson', 
      data: { type: 'FeatureCollection', features: [] } as any 
    });
    this.map.addLayer({
      id: 'influence-area-fill',
      type: 'fill',
      source: 'influence-area',
      paint: {
        'fill-color': '#007bff',
        'fill-opacity': 0.2
      }
    });
  }

  // Getter to expose the map instance to the controller
  get mapInstance(): any {
    return this.map;
  }

  // Simple HQ count update
  updateHQCount(count: number) {
    if (this.hqCountEl) {
      this.hqCountEl.textContent = count.toString();
    }
  }

  // Getter for HUD elements
  get plantHqButton(): HTMLElement | null { return this.plantHqBtn; }

  // Set callbacks for communication with controller
  setCallbacks(callbacks: MapViewCallbacks) {
    this.callbacks = callbacks;
  }

  private setupMapEventHandlers() {
    // Click handler for placing HQs
    this.map.on('click', (e: any) => {
      if (!this.callbacks?.isPlantingMode()) return;

      const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      
      // Notify controller about click
      this.callbacks?.onBuildingClick(coords);

      // Reset cursor
      this.map.getCanvas().style.cursor = '';
    });

    // Change cursor when in planting mode
    this.map.on('mousemove', (e: any) => {
      if (this.callbacks?.isPlantingMode()) {
        this.map.getCanvas().style.cursor = 'crosshair';
      } else {
        this.map.getCanvas().style.cursor = '';
      }
    });
  }

  // Method to exit planting mode (called from controller)
  exitPlantingMode() {
    if (this.plantHqBtn) {
      this.plantHqBtn.classList.remove('active');
    }
    this.map.getCanvas().style.cursor = '';
  }

  // Method to create HQ marker (called from controller)
  createHQMarker(coords: { lng: number; lat: number }, hqNumber: number): any {
    const el = document.createElement('div');
    el.className = 'gang-marker';
    el.textContent = hqNumber.toString();
    const marker = new (window as any).maplibregl.Marker(el).setLngLat(coords).addTo(this.map);
    return marker;
  }

  // Method to update map sources with game data
  updateInfluenceArea(territoryData: any) {
    (this.map.getSource('influence-area') as any).setData(territoryData);
  }
}