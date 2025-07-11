// view/MapView.ts
import * as turf from "@turf/turf";
import { HQType } from "../model/GameState";
import CharacterView from "./CharacterView";
import InputManager from "../input/InputManager";
import { InputState } from "../input/InputTypes";
import { GTA1_STYLE_TOP_DOWN } from "../config";

// Callback interface for MapView to communicate with controller
export interface MapViewCallbacks {
  onMapClick: (coords: { lng: number; lat: number }, features: { building?: any, transport?: any }) => void;
  isPlanting: () => boolean;
  onPlayerInput: (input: { 
    forward: boolean, 
    backward: boolean, 
    left: boolean, 
    right: boolean,
    rotateLeft: boolean,
    rotateRight: boolean,
    running: boolean
  }) => void;
}

// Map HQ types to their icon images (relative to public root)
const ICON_MAP: Record<HQType, string> = {
  producer: 'icons/drug_farm.svg',
  trafficker: 'icons/foot_trafficker.svg',
  retailer: 'icons/trade v3.svg'
};

export default class MapView {
  private map: any;
  // Use only the 2-D footprint polygons for hit-testing
  private buildingLayers: string[] = ['building-footprints'];
  private transportLayers: string[] = [];
  private markers: Array<{ marker: any, element: HTMLElement, baseSize: number }> = [];
  private characterView: CharacterView | null = null;
  private playerPosition: { lng: number; lat: number } | null = null;
  private playerRotation: number = 0;
  
  // Camera properties
  private cameraBearing: number = 0; // Camera rotation in degrees
  private isCameraRotating: boolean = false; // Flag to prevent movement from interrupting rotation

  // Continuous rotation state
  private continuousRotationActive: boolean = false;
  private continuousRotationDirection: 'left' | 'right' | null = null;
  private currentRotationSpeed: number = 0;
  private minRotationSpeed: number = 0.5;
  private maxRotationSpeed: number = 5.0;
  private rotationAcceleration: number = 0.1;

  // Continuous zoom state
  private continuousZoomActive: boolean = false;
  private continuousZoomDirection: 'in' | 'out' | null = null;
  private currentZoomSpeed: number = 0;
  private minZoomSpeed: number = 0.02;
  private maxZoomSpeed: number = 0.15;
  private zoomAcceleration: number = 0.005;
  private isCameraZooming: boolean = false;

  // Callbacks for communicating with controller
  private callbacks: MapViewCallbacks | null = null;
  private inputManager: InputManager;

  constructor(containerId: string = 'map') {
    // Set up PMTiles protocol for loading .pmtiles files
    let protocol = new (window as any).pmtiles.Protocol();
    (window as any).maplibregl.addProtocol("pmtiles", protocol.tile);

    // MapLibre GL JS doesn't require an access token for open data sources
    this.map = new (window as any).maplibregl.Map({
      container: containerId,
      style: 'offline-map-style.json',
      center: [-74.05682, 40.69337], // starting position [lng, lat]
      zoom: 14, // Start zoomed out for cinematic effect
      pitch: GTA1_STYLE_TOP_DOWN ? 0 : 55,
      bearing: 0, // slight rotation for depth perception
      antialias: true,
      dragRotate: true, // allows mouse drag rotation,
      dragPitch: GTA1_STYLE_TOP_DOWN ? false : true,
      dragPan: true,
      pitchWithRotate: GTA1_STYLE_TOP_DOWN ? false : true,
      touchZoomRotate: GTA1_STYLE_TOP_DOWN ? false : true, // allows touch zoom rotation
      keyboard: false, // Disable built-in keyboard navigation to prevent conflicts
      maxPitch: 50
    });

    this.characterView = new CharacterView(this.map);
    this.inputManager = new InputManager();

    // Set up input callbacks
    this.inputManager.setCallbacks({
      onPlayerInput: (input) => this.handlePlayerInput(input),
      onCameraZoomHold: (direction) => this.handleZoomHold(direction),
      onCameraZoomRelease: () => this.handleZoomRelease(),
      onCameraRotateHold: (direction) => this.handleRotationHold(direction),
      onCameraRotateRelease: () => this.handleRotationRelease()
    });

    // Query HUD elements
    // this.queryHudElements(); // REMOVED

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
      this.map.setProjection({ type: 'globe' });
      this.setupLayers();
      this.identifyInteractiveLayers();
      this.setupMapEventHandlers();
      
      // Use 'zoomend' instead of 'zoom' for smoother performance
      // But also add 'zoom' for real-time updates
      this.map.on('zoom', () => {
        this.updateMarkerSizes(false); // No transition during zoom
      });
      
      this.map.on('zoomend', () => {
        this.updateMarkerSizes(true); // Enable transition when zoom stops
      });
    });
  }

  private handlePlayerInput(input: InputState): void {
    // Sync with CharacterView
    if (this.characterView) {
      this.characterView.inputState = { ...input };
    }
    
    // Update movement state
    this.updateMovementState();
    
    // Notify controller
    if (this.callbacks) {
      this.callbacks.onPlayerInput(input);
    }
  }

  // private queryHudElements() { // REMOVED
  //   this.plantProducerBtn = document.getElementById('plant-producer-btn');
  //   this.plantTraffickerBtn = document.getElementById('plant-trafficker-btn');
  //   this.plantRetailerBtn = document.getElementById('plant-retailer-btn');
  //   this.movementModeBtn = document.getElementById('movement-mode-btn');
  //   this.hqCountEl = document.getElementById('hq-count');
  //   this.commoditiesCountEl = document.getElementById('commodities-count');
  //   this.moneyCountEl = document.getElementById('money-count');
  //   this.gameDateEl = document.getElementById('game-date');
  // }

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

    // Add an invisible fill layer dedicated to hit-testing buildings.
    // This can be added without a 'before' ID, which is safer.
    this.map.addLayer({
      id: 'building-hit',
      type: 'fill',
      source: 'nj-complete',
      'source-layer': 'building',
      paint: { 'fill-opacity': 0 }
    });
  }

  private identifyInteractiveLayers() {
    const layers = this.map.getStyle().layers;
    this.transportLayers = layers
      .filter((layer: any) => {
        const layerId = layer.id || '';
        return layer.type === 'line' && (
          layerId.includes('road') ||
          layerId.includes('street') ||
          layerId.includes('highway') ||
          layerId.includes('transportation') ||
          layerId.includes('waterway')
        );
      })
      .map((layer: any) => layer.id);
    // console.log('Found transportation layers:', this.transportLayers);
  }

  // Getter to expose the map instance to the controller
  get mapInstance(): any {
    return this.map;
  }

  // Simple stats update // REMOVED
  // updateStats(hqCount: number, commodities: number, money: number, gameDate: Date) { // REMOVED
  //   if (this.hqCountEl) this.hqCountEl.textContent = hqCount.toString(); // REMOVED
  //   if (this.commoditiesCountEl) this.commoditiesCountEl.textContent = commodities.toString(); // REMOVED
  //   if (this.moneyCountEl) this.moneyCountEl.textContent = money.toFixed(2); // REMOVED
  //   if (this.gameDateEl) { // REMOVED
  //     this.gameDateEl.textContent = gameDate.toLocaleString('en-US', { // REMOVED
  //       day: 'numeric', month: 'short', year: 'numeric', // REMOVED
  //       hour: '2-digit', minute: '2-digit', hour12: false // REMOVED
  //     }); // REMOVED
  //   } // REMOVED
  // } // REMOVED

  // Update movement mode button appearance // REMOVED
  // updateMovementModeButton(isFreeRotation: boolean) { // REMOVED
  //   if (this.movementModeBtn) { // REMOVED
  //     if (isFreeRotation) { // REMOVED
  //       this.movementModeBtn.textContent = '360° Mode'; // REMOVED
  //       this.movementModeBtn.classList.add('free-rotation'); // REMOVED
  //     } else { // REMOVED
  //       this.movementModeBtn.textContent = '8-Direction Mode'; // REMOVED
  //       this.movementModeBtn.classList.remove('free-rotation'); // REMOVED
  //     } // REMOVED
  //   } // REMOVED
  // } // REMOVED

  setCallbacks(callbacks: MapViewCallbacks) {
    this.callbacks = callbacks;
  }

  private setupMapEventHandlers() {
    // Click handler for placing HQs
    this.map.on('click', (e: any) => {
      if (!this.callbacks?.isPlanting()) return;

      const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      
      const point = e.point;
      const buildingFeatures = this.map.queryRenderedFeatures(point, { layers: this.buildingLayers });
      const transportFeatures = this.map.queryRenderedFeatures(point, { layers: this.transportLayers });

      // Notify controller about click, including any features found
      this.callbacks?.onMapClick(coords, {
        building: buildingFeatures.length > 0 ? buildingFeatures[0] : undefined,
        transport: transportFeatures.length > 0 ? transportFeatures[0] : undefined,
      });

      // Reset cursor
      this.map.getCanvas().style.cursor = '';
    });

    // Change cursor when in planting mode and log building info
    this.map.on('mousemove', (e: any) => {
      this.map.getCanvas().style.cursor = this.callbacks?.isPlanting() ? 'crosshair' : '';
    });

    // Add a listener for map movement to update the character's direction and orientation
    this.map.on('move', () => {
      this.cameraBearing = this.map.getBearing();
      const pitch = this.map.getPitch();
      if (this.characterView) {
        this.characterView.setCameraBearing(this.cameraBearing);
        this.characterView.setCameraPitch(pitch);
        this.characterView.redraw();
      }
    });
  }

  // Method to exit planting mode (called from controller) // REMOVED
  // exitPlantingMode() { // REMOVED
  //   this.plantProducerBtn?.classList.remove('active'); // REMOVED
  //   this.plantTraffickerBtn?.classList.remove('active'); // REMOVED
  //   this.plantRetailerBtn?.classList.remove('active'); // REMOVED
  //   this.map.getCanvas().style.cursor = ''; // REMOVED
  // } // REMOVED

  // Helper function to calculate marker size based on zoom
  private calculateMarkerSize(baseSize: number, zoom?: number): number {
    const currentZoom = zoom ?? this.map.getZoom();
    const scale = Math.pow(2, (currentZoom - 10) / 1.2);
    return Math.max(1, Math.min(200, baseSize * scale));
  }

  private updateMarkerSizes(enableTransition: boolean = false) {
    const zoom = this.map.getZoom();
    
    // Update HQ markers
    this.markers.forEach(({ element, baseSize }) => {
      const size = this.calculateMarkerSize(baseSize, zoom);
      
      // Control transition based on whether we're actively zooming
      if (enableTransition) {
        element.style.transition = 'width 0.1s ease, height 0.1s ease';
      } else {
        element.style.transition = 'none'; // No transition during zoom
      }
      
      // Apply size to element
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;
      
      // Scale the icon inside too
      const img = element.querySelector('img');
      if (img) {
        const iconSize = size * 0.6;
        if (enableTransition) {
          img.style.transition = 'width 0.1s ease, height 0.1s ease';
        } else {
          img.style.transition = 'none';
        }
        img.style.width = `${iconSize}px`;
        img.style.height = `${iconSize}px`;
      }
    });

    // Update player character size through CharacterView
    if (this.characterView) {
      this.characterView.updateCharacterSize(enableTransition);
    }
  }

  // Method to create HQ marker (called from controller)
  createHQMarker(coords: { lng: number; lat: number }, type: HQType): any {
    const baseSize = 1;
    const size = this.calculateMarkerSize(baseSize);
    
    // Create marker element
    const el = document.createElement('div');
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
    el.style.cursor = 'pointer';
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    el.style.alignItems = 'top';
    el.style.clipPath = 'polygon(50% 100%, 15% 60%, 0% 20%, 20% 0%, 80% 0%, 100% 20%, 85% 60%)';
    
    // Set background color based on type
    if (type === 'producer') {
      el.style.backgroundColor = '#4CAF50';
      el.style.border = '4px solid #4CAF50';
    } else if (type === 'trafficker') {
      el.style.backgroundColor = '#FFC107';
      el.style.border = '4px solid #FFC107';
    } else if (type === 'retailer') {
      el.style.backgroundColor = '#2196F3';
      el.style.border = '4px solid #2196F3';
    }

    // Add the icon image
    const img = document.createElement('img');
    img.src = ICON_MAP[type];
    img.alt = type;
    const iconSize = size * 0.6;
    img.style.width = `${iconSize}px`;
    img.style.height = `${iconSize}px`;
    img.style.pointerEvents = 'none';
    el.appendChild(img);

    // Create marker
    const marker = new (window as any).maplibregl.Marker({ 
      element: el, 
      anchor: 'bottom'
    })
      .setLngLat(coords)
      .addTo(this.map);
    
    // Store marker info for zoom-based scaling
    this.markers.push({ marker, element: el, baseSize });
    
    return marker;
  }

  // Method to update map sources with game data
  updateInfluenceArea(territoryData: any) {
    // console.log('Updating influence area with data:', territoryData);
    const geoJsonData = {
      type: 'FeatureCollection',
      features: territoryData ? [{
        type: 'Feature',
        geometry: territoryData,
        properties: {}
      }] : []
    };
    (this.map.getSource('influence-area') as any).setData(geoJsonData);
  }

  // Method to create player character
  createPlayerCharacter(coords: { lng: number; lat: number }, rotation: number = 0): void {
    if (!this.characterView) return;

    // Delegate creation to the CharacterView instance
    this.characterView.createPlayerCharacter(coords, rotation);

    // Store position and rotation for camera controls
    this.playerPosition = this.characterView.getPlayerPosition();
    this.playerRotation = this.characterView.getPlayerRotation();

    // The cinematic zoom effect stays in MapView
    this.map.easeTo({
      center: coords,
      zoom: 21.5, // zoom target
      duration: 3000
    });
  }

  // Replace the updatePlayerPosition method:
  updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    if (!this.characterView) return;

    // Delegate the actual update logic to CharacterView
    this.characterView.updatePlayerPosition(coords, rotation);
    
    // Get updated position and rotation from CharacterView for camera logic
    this.playerPosition = this.characterView.getPlayerPosition();
    this.playerRotation = this.characterView.getPlayerRotation();
    
    // Update camera to follow player (this method still lives in MapView)
    this.centerCameraOnPlayer();
  }

  // Update the centerCameraOnPlayer method:
  centerCameraOnPlayer(): void {
    if (this.isCameraRotating || this.isCameraZooming) return; // Don't recenter if camera is rotating or zooming
    
    if (this.playerPosition) {
      this.map.setCenter([this.playerPosition.lng, this.playerPosition.lat]);
    }
  }

  // Camera rotation methods

  private handleZoomHold(direction: 'in' | 'out'): void {
    this.continuousZoomDirection = direction;
    if (!this.continuousZoomActive) {
      this.isCameraZooming = true; // Set flag to prevent movement conflicts
      this.currentZoomSpeed = this.minZoomSpeed;
      this.continuousZoomActive = true;
      this.continuousZoom();
    }
  }

  private handleZoomRelease(): void {
    this.isCameraZooming = false; // Unset flag
    this.continuousZoomActive = false;
    this.continuousZoomDirection = null;
  }

  private continuousZoom(): void {
    if (!this.continuousZoomActive) return;

    // Accelerate
    if (this.currentZoomSpeed < this.maxZoomSpeed) {
      this.currentZoomSpeed += this.zoomAcceleration;
    }

    // Apply zoom change
    const currentZoom = this.map.getZoom();
    let newZoom;
    
    if (this.continuousZoomDirection === 'in') {
      newZoom = Math.min(22, currentZoom + this.currentZoomSpeed);
      // newZoom = currentZoom + this.currentZoomSpeed;
    } else {
      newZoom = Math.max(5, currentZoom - this.currentZoomSpeed);
      // newZoom = currentZoom - this.currentZoomSpeed;
    }

    // Apply zoom centered on player if available
    if (this.playerPosition) {
      this.map.easeTo({
        center: [this.playerPosition.lng, this.playerPosition.lat],
        zoom: newZoom,
        duration: 0 // Instant update to keep it smooth
      });
    } else {
      this.map.setZoom(newZoom);
    }

    requestAnimationFrame(() => this.continuousZoom());
  }

  private handleRotationHold(direction: 'left' | 'right'): void {
    this.continuousRotationDirection = direction;
    if (!this.continuousRotationActive) {
      this.isCameraRotating = true; // Set flag to prevent zoom conflicts
      this.currentRotationSpeed = this.minRotationSpeed;
      this.continuousRotationActive = true;
      this.continuousRotate();
    }
  }

  private handleRotationRelease(): void {
    this.isCameraRotating = false; // Unset flag
    this.continuousRotationActive = false;
    this.continuousRotationDirection = null;
  }

  private continuousRotate(): void {
    if (!this.continuousRotationActive) return;

    // Accelerate
    if (this.currentRotationSpeed < this.maxRotationSpeed) {
      this.currentRotationSpeed += this.rotationAcceleration;
    }

    // A is for 'left' (counter-clockwise, +bearing), D is for 'right' (clockwise, -bearing)
    if (this.continuousRotationDirection === 'left') { // D key
      this.cameraBearing = (this.cameraBearing - this.currentRotationSpeed + 360) % 360;
    } else { // A key
      this.cameraBearing = (this.cameraBearing + this.currentRotationSpeed) % 360;
    }

    // Ensure rotation is centered on the player
    if (this.playerPosition) {
      this.map.easeTo({
        center: [this.playerPosition.lng, this.playerPosition.lat],
        bearing: this.cameraBearing,
        duration: 0 // Instant update to keep it smooth
      });
    } else {
      this.map.setBearing(this.cameraBearing);
    }

    this.updateCharacterDirectionAfterCameraRotation();

    requestAnimationFrame(() => this.continuousRotate());
  }

  private updateCharacterDirectionAfterCameraRotation(): void {
    if (this.characterView) {
      this.characterView.setCameraBearing(this.cameraBearing);
      this.characterView.redraw();
    }
  }

  // Method to update movement state and switch animations
  private updateMovementState(): void {
    // This logic is now handled by CharacterView. We just trigger it.
    if (this.characterView) {
      this.characterView.updateMovementState();
    }
  }

  public destroy(): void {
    // Clean up map resources and event listeners
    this.inputManager.destroy();
    if (this.map) {
      this.map.remove();
    }
    this.markers.forEach(({ marker }) => marker.remove());
    this.markers = [];
  }
}
