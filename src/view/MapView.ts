// view/MapView.ts
import * as turf from "@turf/turf";

// Callback interface for MapView to communicate with controller
export interface MapViewCallbacks {
  onBuildingClick: (coords: { lng: number; lat: number }, buildingFeature: any) => void;
  isPlantingMode: () => boolean;
  isBuildingAllowed: (point: [number, number]) => boolean;
}

export default class MapView {
  private map: any;
  public roadLayers: string[] = [];
  public buildingLayers: string[] = ['building-hit'];
  
  // HUD elements
  private infoPanel!: HTMLElement | null;
  private roadNameEl!: HTMLElement | null;
  private roadTypeEl!: HTMLElement | null;
  private roadIdEl!: HTMLElement | null;
  private plantHqBtn!: HTMLElement | null;
  private refreshBtn!: HTMLElement | null;
  private buildingCountEl!: HTMLElement | null;
  private bankBalanceEl!: HTMLElement | null;
  private residentCountEl!: HTMLElement | null;
  private dateEl!: HTMLElement | null;
  private wageSlider!: HTMLElement | null;
  private wageDisplayEl!: HTMLElement | null;
  private gangCountEl!: HTMLElement | null;
  private gangMaxEl!: HTMLElement | null;

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
      antialias: true // Using any cast above to avoid type issues
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
        console.warn('Tile not available (normal for PMTiles):', e.tile);
        return;
      }
      console.error('Map error:', e);
    });

    this.map.on('load', () => {
      this.setupLayers();
      this.identifyRoadLayers();
      this.setupMapEventHandlers();
    });
  }

  private queryHudElements() {
    this.infoPanel = document.getElementById('info-panel');
    this.roadNameEl = document.getElementById('road-name');
    this.roadTypeEl = document.getElementById('road-type');
    this.roadIdEl = document.getElementById('road-id');
    this.plantHqBtn = document.getElementById('plant-hq-btn');
    this.refreshBtn = document.getElementById('refresh-map-btn');
    this.buildingCountEl = document.getElementById('building-count');
    this.bankBalanceEl = document.getElementById('bank-balance');
    this.residentCountEl = document.getElementById('resident-count');
    this.dateEl = document.getElementById('game-date');
    this.wageSlider = document.getElementById('wage-slider');
    this.wageDisplayEl = document.getElementById('wage-display');
    this.gangCountEl = document.getElementById('gang-count');
    this.gangMaxEl = document.getElementById('gang-max');
  }

  private setupLayers() {
    // Find a reliable anchor layer from the style to insert our custom layers before.
    const allMapLayers = this.map.getStyle().layers;
    let anchorLayerId;
    const topLabelLayerIds = ['place-labels-major', 'road-labels', 'water-labels'];
    for (const id of topLabelLayerIds) {
      if (allMapLayers.some((l: any) => l.id.startsWith(id))) {
        anchorLayerId = allMapLayers.find((l: any) => l.id.startsWith(id))?.id;
        break;
      }
    }
    if (!anchorLayerId) {
      const firstSymbol = allMapLayers.find((l: any) => l.type === 'symbol');
      anchorLayerId = firstSymbol ? firstSymbol.id : undefined;
    }
    console.log(`Using anchor layer for custom layers: ${anchorLayerId}`);

    // Add an invisible fill layer dedicated to hit-testing buildings using PMTiles data
    this.map.addLayer({
      id: 'building-hit',
      type: 'fill',
      source: 'nj-complete',
      'source-layer': 'building',
      paint: { 'fill-opacity': 0 }
    });
    console.log('Building hit-testing layer added using PMTiles source');

    // Add sources and layers for game features
    this.map.addSource('selected-road', {
      'type': 'geojson',
      'data': { type: 'FeatureCollection', features: [] } as any
    });

    this.map.addLayer({
      'id': 'selected-road-line',
      'type': 'line',
      'source': 'selected-road',
      'layout': {
        'line-join': 'round',
        'line-cap': 'round'
      },
      'paint': {
        'line-color': '#fa9005',
        'line-width': 7
      }
    });

    // Highlight selected building
    this.map.addSource('selected-building', { 
      type: 'geojson', 
      data: { type: 'FeatureCollection', features: [] } as any 
    });
    this.map.addLayer({
      id: 'selected-building-fill',
      type: 'fill',
      source: 'selected-building',
      paint: {
        'fill-color': '#ffeb3b',
        'fill-opacity': 0
      }
    });

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

    // Source and layer to show the road segments controlled by the HQ
    this.map.addSource('controlled-roads', { 
      type: 'geojson', 
      data: { type: 'FeatureCollection', features: [] } as any 
    });
    this.map.addLayer({
      id: 'controlled-roads-lines',
      type: 'line',
      source: 'controlled-roads',
      paint: {
        'line-color': '#fa9005',
        'line-width': 5
      }
    });

    // Source and layer for controlled buildings labels
    this.map.addSource('controlled-buildings', { 
      type: 'geojson', 
      data: { type: 'FeatureCollection', features: [] } as any 
    });
    this.map.addLayer({
      id: 'controlled-building-labels',
      type: 'symbol',
      source: 'controlled-buildings',
      layout: {
        'text-field': ['to-string', ['get', 'pop_est']],
        'text-size': 12,
        'text-font': ["Noto Sans Regular"]
      },
      paint: {
        'text-color': '#111',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1
      },
      minzoom: 15
    });

    // Hide previously defined label layer if exists (from earlier version)
    if (this.map.getLayer('hq-building-gang-labels')) {
      this.map.setLayoutProperty('hq-building-gang-labels', 'visibility', 'none');
    }
  }

  private identifyRoadLayers() {
    // Find all the road layers to make them interactive
    this.roadLayers = this.map.getStyle().layers
      .filter((layer: any) =>
        layer.type === 'line' &&
        layer.source && // has a source
        layer['source-layer'] &&
        (layer['source-layer'].includes('road') || 
         layer['source-layer'].includes('transportation') || 
         layer['source-layer'].includes('bridge') ||
         layer.id.includes('road') ||
         layer.id.includes('street') ||
         layer.id.includes('highway')) &&
        !layer.id.includes('casing') &&
        !layer.id.includes('label')
      )
      .map((layer: any) => layer.id);
    
    console.log('Road layers found:', this.roadLayers);
  }

  // Getter to expose the map instance to the controller
  get mapInstance(): any {
    return this.map;
  }

  // HUD update methods
  updateHud(stats: {
    wageOffer: number;
    maxGangMembers: number;
    hqCount: number;
    totalResidents: number;
    bankBalance: number;
    gameDate: Date;
    buildingCount: number;
  }) {
    if (this.wageDisplayEl) this.wageDisplayEl.textContent = stats.wageOffer.toString();
    if (this.gangMaxEl) this.gangMaxEl.textContent = stats.maxGangMembers.toString();
    if (this.gangCountEl) this.gangCountEl.textContent = stats.hqCount.toString();
    if (this.residentCountEl) this.residentCountEl.textContent = stats.totalResidents.toString();
    if (this.bankBalanceEl) this.bankBalanceEl.textContent = stats.bankBalance.toFixed(2);
    if (this.dateEl) {
      this.dateEl.textContent = stats.gameDate.toLocaleDateString('en-US', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    }
    if (this.buildingCountEl) this.buildingCountEl.textContent = stats.buildingCount.toString();
  }

  // Getters for HUD elements (for event listeners)
  get plantHqButton(): HTMLElement | null { return this.plantHqBtn; }
  get refreshButton(): HTMLElement | null { return this.refreshBtn; }
  get wageSliderElement(): HTMLElement | null { return this.wageSlider; }

  // Get initial wage from slider
  getInitialWage(): number {
    return parseInt((this.wageSlider as HTMLInputElement)?.value || '50', 10);
  }

  // Set callbacks for communication with controller
  setCallbacks(callbacks: MapViewCallbacks) {
    this.callbacks = callbacks;
  }

  private setupMapEventHandlers() {
    // Building placement mousemove handler
    this.map.on('mousemove', (e: any) => {
      if (!this.callbacks?.isPlantingMode()) {
        return;
      }
      const hits = this.map.queryRenderedFeatures(e.point, { layers: this.buildingLayers });
      if (hits.length > 0) {
        // Use mouse position for more intuitive distance checking
        const mousePos = e.lngLat;
        const checkPoint: [number, number] = [mousePos.lng, mousePos.lat];
        const allowed = this.callbacks?.isBuildingAllowed(checkPoint) || false;
        
        this.map.getCanvas().style.cursor = allowed ? 'crosshair' : '';
      } else {
        this.map.getCanvas().style.cursor = '';
      }
    });

    // Building placement click handler
    this.map.on('click', (e: any) => {
      if (!this.callbacks?.isPlantingMode()) return;

      // Require a building under the cursor
      const buildings = this.map.queryRenderedFeatures(e.point, { layers: this.buildingLayers });
      if (buildings.length === 0) {
        return;
      }
      const buildingFeature = buildings[0];
      const checkPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (!this.callbacks?.isBuildingAllowed(checkPoint)) {
        return; // outside current territory
      }
      
      // Update selected building visualization
      (this.map.getSource('selected-building') as any).setData(buildingFeature);

      // Use the exact click position instead of building centroid for better accuracy
      const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      
      // Notify controller about building click
      this.callbacks?.onBuildingClick(coords, buildingFeature);

      // Reset cursor and plant button state
      this.map.getCanvas().style.cursor = '';
      if (this.plantHqBtn) {
        this.plantHqBtn.classList.remove('active');
      }
    });

    // Road hover handler
    this.map.on('mousemove', this.roadLayers, (e: any) => {
      if (this.callbacks?.isPlantingMode()) return; // keep crosshair during placement mode
      this.map.getCanvas().style.cursor = (e.features && e.features.length > 0) ? 'pointer' : '';
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

  updateControlledRoads(roadFeatures: any[]) {
    (this.map.getSource('controlled-roads') as any).setData({
      type: 'FeatureCollection',
      features: roadFeatures
    });
  }

  updateControlledBuildings(buildingFeatures: any[]) {
    (this.map.getSource('controlled-buildings') as any).setData({
      type: 'FeatureCollection', 
      features: buildingFeatures
    });
  }
}