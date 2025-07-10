// view/MapView.ts
import * as turf from "@turf/turf";
import { HQType } from "../model/GameState";
import CharacterView from "./CharacterView";
import InputManager from "../input/InputManager";
import { InputState } from "../input/InputTypes";

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
  private lastCameraRotationTime: number = 0;
  private cameraRotationCooldownMs: number = 50; // Throttle camera rotation
  private isCameraRotating: boolean = false; // Flag to prevent movement from interrupting rotation

  // Zoom control state
  private lastZoomTime: number = 0;
  private zoomCooldownMs: number = 100;
  private isCameraZooming: boolean = false;
  private holdZoomActive: boolean = false;

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
      pitch: 55, // tilt for 3-D perspective
      bearing: 0, // slight rotation for depth perception
      antialias: true,
      dragRotate: false, // prevents mouse drag rotation,
      touchZoomRotate: false, // prevents touch zoom rotation
      keyboard: false // Disable built-in keyboard navigation to prevent conflicts
    });

    this.characterView = new CharacterView(this.map);
    this.inputManager = new InputManager();

    // Set up InputManager callbacks
    this.inputManager.setCallbacks({
      onPlayerInput: (input) => this.handlePlayerInput(input),
      onCameraRotateLeft: () => this.rotateCameraLeft(),
      onCameraRotateRight: () => this.rotateCameraRight(),
      onCameraZoomIn: () => this.zoomIn(),
      onCameraZoomOut: () => this.zoomOut(),
      onCameraZoomHold: (direction) => this.handleZoomHold(direction),
      onCameraZoomRelease: (direction) => this.handleZoomRelease(direction)
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
  private rotateCameraLeft(): void {
    const currentTime = Date.now();
    if (currentTime - this.lastCameraRotationTime < this.cameraRotationCooldownMs) {
      return; // Throttle rotation
    }
    
    this.isCameraRotating = true;
    this.cameraBearing = (this.cameraBearing - 45 + 360) % 360;
    this.lastCameraRotationTime = currentTime;
    
    // Rotate around the player's position
    if (this.playerPosition) {
      if (this.characterView) {
        this.characterView.setCameraBearing(this.cameraBearing);
        this.updateCharacterDirectionAfterCameraRotation();
      }

      this.map.easeTo({
        center: [this.playerPosition.lng, this.playerPosition.lat],
        bearing: this.cameraBearing,
        duration: 150 // Smooth rotation animation
      });

      this.map.once('moveend', () => this.isCameraRotating = false);

    } else {
      this.map.setBearing(this.cameraBearing);
      this.isCameraRotating = false;
    }
  }

  private rotateCameraRight(): void {
    const currentTime = Date.now();
    if (currentTime - this.lastCameraRotationTime < this.cameraRotationCooldownMs) {
      return; // Throttle rotation
    }
    
    this.isCameraRotating = true;
    this.cameraBearing = (this.cameraBearing + 45) % 360;
    this.lastCameraRotationTime = currentTime;
    
    // Rotate around the player's position
    if (this.playerPosition) {
      if (this.characterView) {
        this.characterView.setCameraBearing(this.cameraBearing);
        this.updateCharacterDirectionAfterCameraRotation();
      }

      this.map.easeTo({
        center: [this.playerPosition.lng, this.playerPosition.lat],
        bearing: this.cameraBearing,
        duration: 150 // Smooth rotation animation
      });

      this.map.once('moveend', () => this.isCameraRotating = false);

    } else {
      this.map.setBearing(this.cameraBearing);
      this.isCameraRotating = false;
    }
  }

  private zoomIn(): void {
    const currentTime = Date.now();
    if (currentTime - this.lastZoomTime < this.zoomCooldownMs) return;

    this.isCameraZooming = true;
    this.map.easeTo({
        zoom: Math.min(22, this.map.getZoom() + 1),
        duration: 200
    });
    this.lastZoomTime = currentTime;
    this.map.once('moveend', () => this.isCameraZooming = false);
  }

  private zoomOut(): void {
    const currentTime = Date.now();
    if (currentTime - this.lastZoomTime < this.zoomCooldownMs) return;

    this.isCameraZooming = true;
    this.map.easeTo({
        zoom: Math.max(14, this.map.getZoom() - 1),
        duration: 200
    });
    this.lastZoomTime = currentTime;
    this.map.once('moveend', () => this.isCameraZooming = false);
  }

  private handleZoomHold(direction: 'in' | 'out'): void {
    this.holdZoomActive = true;
    
    const continuousZoom = () => {
      if (!this.holdZoomActive) return;

      const zoomFactor = direction === 'in' ? 0.05 : -0.05;
      const currentZoom = this.map.getZoom();
      const newZoom = Math.max(14, Math.min(22, currentZoom + zoomFactor));
      
      this.map.setZoom(newZoom);
      
      requestAnimationFrame(continuousZoom);
    };

    // Wait for the hold threshold before starting the continuous zoom
    const tapDurationThresholdMs = 500; // Local constant
    setTimeout(() => {
      if (this.holdZoomActive) {
        requestAnimationFrame(continuousZoom);
      }
    }, tapDurationThresholdMs);
  }

  private handleZoomRelease(direction: 'in' | 'out'): void {
    this.holdZoomActive = false;
  }

  // Method to update character animation direction after camera rotation
  private updateCharacterDirectionAfterCameraRotation(): void {
    if (this.characterView && this.playerPosition) {
      // Trigger an update with current position and rotation to recalculate direction
      this.characterView.updatePlayerPosition(this.playerPosition, this.playerRotation);
    }
  }

  // Method to update movement state and switch animations
  private updateMovementState(): void {
    // This logic is now handled by CharacterView. We just trigger it.
    if (this.characterView) {
      this.characterView.updateMovementState();
    }
  }

  /**
   * Cleans up resources when the view is destroyed
   */
  public destroy(): void {
    if (this.characterView) {
      this.characterView.destroy();
      this.characterView = null;
    }
    if (this.inputManager) {
      this.inputManager.destroy();
    }
    // Clean up markers
    this.markers.forEach(({ marker }) => marker.remove());
    this.markers = [];
  }
}