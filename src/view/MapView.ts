// view/MapView.ts
import * as turf from "@turf/turf";
import { HQType } from "../model/GameState";
import CharacterView from "./CharacterView";

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
  private playerMarker: any = null;
  private playerElement: HTMLElement | null = null;
  private playerPosition: { lng: number; lat: number } | null = null;
  private playerRotation: number = 0;
  private playerBaseSize: number = 0.075;
  
  // Camera properties
  private cameraBearing: number = 0; // Camera rotation in degrees
  private lastCameraRotationTime: number = 0;
  private cameraRotationCooldownMs: number = 50; // Throttle camera rotation
  private isCameraRotating: boolean = false; // Flag to prevent movement from interrupting rotation
  
  // Double-tap running state
  private lastArrowUpPressTime: number = 0;
  private lastArrowUpReleaseTime: number = 0;
  private doubleTapThresholdMs: number = 300; // Threshold for double-tap in ms
  private tapDurationThresholdMs: number = 500; // Max duration of a press to be a "tap"

  // Zoom control state
  private lastZoomTime: number = 0;
  private zoomCooldownMs: number = 100;
  private isCameraZooming: boolean = false;
  private wKeyDownTime: number = 0;
  private sKeyDownTime: number = 0;
  private holdZoomActive: boolean = false;

  // Animation properties
  private currentPlayerDirection: string = 'south';
  private currentFrame: number = 0;
  private animationTimer: number | null = null;
  private frameRate: number = 12; // frames per second
  private playerSprite: HTMLElement | null = null;
  private isPlayerMoving: boolean = false;
  private currentAnimationType: 'idle' | 'walking' | 'running' = 'idle';
  
  // Input state tracking
  private inputState = {
    forward: false,
    backward: false,
    left: false,        // Now for strafing left
    right: false,       // Now for strafing right
    rotateLeft: false,  // New: for rotation left (shift+left)
    rotateRight: false, // New: for rotation right (shift+right)
    running: false      // New: for running (control+movement)
  };

  // HUD elements
  public plantProducerBtn!: HTMLElement | null;
  public plantTraffickerBtn!: HTMLElement | null;
  public plantRetailerBtn!: HTMLElement | null;
  private hqCountEl!: HTMLElement | null;
  private commoditiesCountEl!: HTMLElement | null;
  private moneyCountEl!: HTMLElement | null;
  private gameDateEl!: HTMLElement | null;

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

    // Set up input handlers
    this.setupInputHandlers();

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

  private setupInputHandlers(): void {
    // Focus management - make sure the document can receive key events
    document.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
      e.preventDefault(); // Prevent page scrolling
    });

    document.addEventListener('keyup', (e) => {
      this.handleKeyUp(e);
      e.preventDefault();
    });

    // Make sure the page is focusable
    if (document.body.tabIndex === -1) {
      document.body.tabIndex = 0;
    }
  }

  // Update the key handling methods to reverse the behavior
  private handleKeyDown(e: KeyboardEvent): void {
    let inputChanged = false;

    switch(e.code) {
      case 'KeyD':
        // D key - rotate camera left 45 degrees
        this.rotateCameraLeft();
        break;
      case 'KeyA':
        // A key - rotate camera right 45 degrees
        this.rotateCameraRight();
        break;
      case 'KeyW':
        // W key - zoom in
        if (!this.wKeyDownTime) { // Prevent re-triggering if held
          this.wKeyDownTime = Date.now();
          this.zoomIn(); // Perform initial zoom immediately
          this.handleZoomHold('in');
        }
        break;
      case 'KeyS':
        // S key - zoom out
        if (!this.sKeyDownTime) { // Prevent re-triggering if held
          this.sKeyDownTime = Date.now();
          this.zoomOut(); // Perform initial zoom immediately
          this.handleZoomHold('out');
        }
        break;
      case 'ArrowUp':
        if (!this.inputState.forward) { // Only trigger on initial press
          const currentTime = Date.now();
          const timeSinceLastRelease = currentTime - this.lastArrowUpReleaseTime;
          const lastPressDuration = this.lastArrowUpReleaseTime - this.lastArrowUpPressTime;

          if (timeSinceLastRelease < this.doubleTapThresholdMs && lastPressDuration < this.tapDurationThresholdMs) {
            // Double-tap detected
            this.inputState.running = true;
          }
          
          this.inputState.forward = true;
          this.lastArrowUpPressTime = currentTime; // Record press time
          inputChanged = true;
        }
        break;
      case 'ArrowDown':
        if (!this.inputState.backward) {
          this.inputState.backward = true;
          inputChanged = true;
        }
        break;
      case 'ArrowLeft':
        if (e.shiftKey) {
          // Shift+Left = Strafe left
          if (!this.inputState.left) {
            this.inputState.left = true;
            inputChanged = true;
          }
        } else {
          // Left = Rotate left (default behavior)
          if (!this.inputState.rotateLeft) {
            this.inputState.rotateLeft = true;
            inputChanged = true;
          }
        }
        break;
      case 'ArrowRight':
        if (e.shiftKey) {
          // Shift+Right = Strafe right
          if (!this.inputState.right) {
            this.inputState.right = true;
            inputChanged = true;
          }
        } else {
          // Right = Rotate right (default behavior)
          if (!this.inputState.rotateRight) {
            this.inputState.rotateRight = true;
            inputChanged = true;
          }
        }
        break;
    }

    if (inputChanged) {
      // First, sync state WITH CharacterView
      if (this.characterView) {
        this.characterView.inputState = { ...this.inputState };
      }
      
      // THEN, trigger the update, which uses that state
      this.updateMovementState();
      
      if (this.callbacks) {
        this.callbacks.onPlayerInput(this.inputState);
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    let inputChanged = false;

    switch(e.code) {
      case 'KeyW':
        this.wKeyDownTime = 0;
        this.holdZoomActive = false;
        break;
      case 'KeyS':
        this.sKeyDownTime = 0;
        this.holdZoomActive = false;
        break;
      case 'ArrowUp':
        // On release, stop moving/running, and record times for double-tap check
        if (this.inputState.forward) {
          this.inputState.forward = false;
          this.inputState.running = false; // Always stop running on release
          this.lastArrowUpReleaseTime = Date.now();
          inputChanged = true;
        }
        break;
      case 'ArrowDown':
        if (this.inputState.backward) {
          this.inputState.backward = false;
          inputChanged = true;
        }
        break;
      case 'ArrowLeft':
        // Reset both strafe and rotate for left arrow
        let leftChanged = false;
        if (this.inputState.left) {
          this.inputState.left = false;
          leftChanged = true;
        }
        if (this.inputState.rotateLeft) {
          this.inputState.rotateLeft = false;
          leftChanged = true;
        }
        if (leftChanged) {
          inputChanged = true;
        }
        break;
      case 'ArrowRight':
        // Reset both strafe and rotate for right arrow
        let rightChanged = false;
        if (this.inputState.right) {
          this.inputState.right = false;
          rightChanged = true;
        }
        if (this.inputState.rotateRight) {
          this.inputState.rotateRight = false;
          rightChanged = true;
        }
        if (rightChanged) {
          inputChanged = true;
        }
        break;
    }

    if (inputChanged) {
      // First, sync state WITH CharacterView
      if (this.characterView) {
        this.characterView.inputState = { ...this.inputState };
      }
      
      // THEN, trigger the update, which uses that state
      this.updateMovementState();
      
      if (this.callbacks) {
        this.callbacks.onPlayerInput(this.inputState);
      }
    }
  }

  private queryHudElements() {
    this.plantProducerBtn = document.getElementById('plant-producer-btn');
    this.plantTraffickerBtn = document.getElementById('plant-trafficker-btn');
    this.plantRetailerBtn = document.getElementById('plant-retailer-btn');
    this.hqCountEl = document.getElementById('hq-count');
    this.commoditiesCountEl = document.getElementById('commodities-count');
    this.moneyCountEl = document.getElementById('money-count');
    this.gameDateEl = document.getElementById('game-date');
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

  // Simple stats update
  updateStats(hqCount: number, commodities: number, money: number, gameDate: Date) {
    if (this.hqCountEl) this.hqCountEl.textContent = hqCount.toString();
    if (this.commoditiesCountEl) this.commoditiesCountEl.textContent = commodities.toString();
    if (this.moneyCountEl) this.moneyCountEl.textContent = money.toFixed(2);
    if (this.gameDateEl) {
      this.gameDateEl.textContent = gameDate.toLocaleString('en-US', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    }
  }

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

  // Method to exit planting mode (called from controller)
  exitPlantingMode() {
    this.plantProducerBtn?.classList.remove('active');
    this.plantTraffickerBtn?.classList.remove('active');
    this.plantRetailerBtn?.classList.remove('active');
    this.map.getCanvas().style.cursor = '';
  }

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

    // Update player character size
    if (this.playerElement) {
      const playerBaseSize = this.playerBaseSize;
      const playerSize = this.calculateMarkerSize(playerBaseSize, zoom);
      
      if (enableTransition) {
        this.playerElement.style.transition = 'width 0.1s ease, height 0.1s ease';
      } else {
        this.playerElement.style.transition = 'none';
      }
      
      this.playerElement.style.width = `${playerSize}px`;
      this.playerElement.style.height = `${playerSize}px`;
      
      // Update billboard and screen sizes
      const billboard = this.playerElement.querySelector('div');
      const screen = billboard?.querySelector('div');
      if (billboard) {
        if (enableTransition) {
          billboard.style.transition = 'width 0.1s ease, height 0.1s ease';
        } else {
          billboard.style.transition = 'none';
        }
        billboard.style.width = `${playerSize}px`;
        billboard.style.height = `${playerSize}px`;
      }
      if (screen) {
        if (enableTransition) {
          screen.style.transition = 'width 0.1s ease, height 0.1s ease';
        } else {
          screen.style.transition = 'none';
        }
        screen.style.width = `${playerSize}px`;
        screen.style.height = `${playerSize}px`;
        
        // Update the sprite size too
        const sprite = screen.querySelector('div');
        if (sprite) {
          sprite.style.width = '100%';
          sprite.style.height = '100%';
        }
      }
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

    // Keep a local copy of the position for camera controls, which still live in MapView.
    this.playerPosition = coords;

    // The cinematic zoom effect also stays in MapView.
    this.map.easeTo({
      center: coords,
      zoom: 21.5, // zoom target
      duration: 3000
    });
  }

  // Add this new method for screen position updates:
  private updatePlayerScreenPosition(): void {
    if (!this.playerElement || !this.playerPosition) return;
    
    // Convert geographic coordinates to screen coordinates
    const point = this.map.project(this.playerPosition);
    
    // Update size based on zoom level with a minimum size for better visibility
    const rawSize = this.calculateMarkerSize(this.playerBaseSize);
    const size = Math.max(8, rawSize); // Minimum 8px for visibility when zoomed out
    
    this.playerElement.style.width = `${size}px`;
    this.playerElement.style.height = `${size}px`;
    
    // Update billboard and screen sizes
    const billboard = this.playerElement.querySelector('div');
    const screen = billboard?.querySelector('div');
    if (billboard) {
      billboard.style.width = `${size}px`;
      billboard.style.height = `${size}px`;
    }
    if (screen) {
      screen.style.width = `${size}px`;
      screen.style.height = `${size}px`;
      
      // Update the sprite size and optimize rendering
      const sprite = screen.querySelector('div') as HTMLElement;
      if (sprite) {
        sprite.style.width = '100%';
        sprite.style.height = '100%';
        
        // Adjust image rendering based on size for optimal quality
        if (size < 16) {
          sprite.style.imageRendering = 'auto'; // Smooth scaling for very small sizes
        } else if (size < 32) {
          sprite.style.imageRendering = 'auto'; // Still smooth for small sizes  
        } else {
          sprite.style.imageRendering = 'pixelated'; // Crisp pixels for larger sizes
        }
      }
    }
    
    // Use rounded pixel values for crisp positioning
    const x = Math.round(point.x - size/2);
    const y = Math.round(point.y - size/2);
    this.playerElement.style.transform = `translate(${x}px, ${y}px)`;
  }

  // Replace the updatePlayerPosition method:
  updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    if (!this.characterView) return;

    // Store new position and rotation for MapView's camera logic
    this.playerPosition = coords;
    this.playerRotation = rotation;
    
    // Delegate the actual update logic to CharacterView
    this.characterView.updatePlayerPosition(coords, rotation);
    
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
    setTimeout(() => {
      if ((direction === 'in' && this.wKeyDownTime) || (direction === 'out' && this.sKeyDownTime)) {
        requestAnimationFrame(continuousZoom);
      }
    }, this.tapDurationThresholdMs);
  }

  // Method to update character animation direction after camera rotation
  private updateCharacterDirectionAfterCameraRotation(): void {
    // This logic is now handled by CharacterView. We just trigger it.
    if (this.characterView) {
      // We pass the rotation from MapView because CharacterView doesn't store it.
      this.characterView.updatePlayerPosition(this.playerPosition!, this.playerRotation);
    }
  }

  // Animation methods
  private getDirectionFromRotation(rotation: number): string {
    // Calculate the character's visual direction relative to the camera
    const relativeRotation = rotation - this.cameraBearing;
    
    // Normalize rotation to 0-360
    const normalizedRotation = ((relativeRotation % 360) + 360) % 360;
    
    // Map to 8 directions
    if (normalizedRotation >= 337.5 || normalizedRotation < 22.5) return 'north';
    if (normalizedRotation >= 22.5 && normalizedRotation < 67.5) return 'northeast';
    if (normalizedRotation >= 67.5 && normalizedRotation < 112.5) return 'east';
    if (normalizedRotation >= 112.5 && normalizedRotation < 157.5) return 'southeast';
    if (normalizedRotation >= 157.5 && normalizedRotation < 202.5) return 'south';
    if (normalizedRotation >= 202.5 && normalizedRotation < 247.5) return 'southwest';
    if (normalizedRotation >= 247.5 && normalizedRotation < 292.5) return 'west';
    if (normalizedRotation >= 292.5 && normalizedRotation < 337.5) return 'northwest';
    
    return 'south'; // fallback
  }

  private startDirectionalAnimation(direction: string): void {
    // console.log('startDirectionalAnimation called with direction:', direction, 'animation type:', this.currentAnimationType);
    
    // Stop current animation
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    
    // Map direction to sprite sheet row (based on your layout)
    const rowMap: {[key: string]: number} = {
      'south': 0,      // Row 1
      'southeast': 1,  // Row 2
      'southwest': 2,  // Row 3
      'west': 3,       // Row 4
      'northwest': 4,  // Row 5
      'north': 5,      // Row 6
      'northeast': 6,  // Row 7
      'east': 7        // Row 8
    };
    
    const row = rowMap[direction] || 0;
    this.currentFrame = 0;
    
    // Get frame count based on animation type
    let frameCount: number;
    if (this.currentAnimationType === 'idle') {
      frameCount = 8;
    } else if (this.currentAnimationType === 'running') {
      frameCount = 6; // Running sprite has 6 frames
    } else {
      frameCount = 12; // walking
    }
    
    // console.log('Using row:', row, 'frameCount:', frameCount);
    
    // Set initial frame
    this.updateSpriteFrame(row, this.currentFrame);
    
    // Start animation loop
    this.animationTimer = window.setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % frameCount;
      this.updateSpriteFrame(row, this.currentFrame);
    }, 1000 / this.frameRate);
  }

  private updateSpriteFrame(row: number, frame: number): void {
    if (this.playerSprite) {
      // Calculate background position based on animation type
      let columnCount: number;
      if (this.currentAnimationType === 'idle') {
        columnCount = 8;
      } else if (this.currentAnimationType === 'running') {
        columnCount = 6; // Running sprite has 6 columns
      } else {
        columnCount = 12; // walking
      }
      
      // Convert frame and row to percentages with better precision
      const x = Math.round((frame * 100) / (columnCount - 1) * 100) / 100; // Round to 2 decimal places
      const y = Math.round((row * 100) / (8 - 1) * 100) / 100;             // Round to 2 decimal places
      
      this.playerSprite.style.backgroundPosition = `${x}% ${y}%`;
    }
  }

  private stopPlayerAnimation(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  // Method to check if player is currently moving
  private checkIfPlayerMoving(): boolean {
    return this.inputState.forward || 
           this.inputState.backward || 
           this.inputState.left || 
           this.inputState.right;
  }

  // Method to update movement state and switch animations
  private updateMovementState(): void {
    // This logic is now handled by CharacterView. We just trigger it.
    if (this.characterView) {
      this.characterView.updateMovementState();
    }
  }

  // Method to switch between animation types
  private switchToAnimation(animationType: 'idle' | 'walking' | 'running', forceRestart: boolean = false): void {
    // console.log('switchToAnimation called with:', animationType, 'current direction:', this.currentPlayerDirection);
    
    if (this.currentAnimationType === animationType && !forceRestart) return;
    
    this.currentAnimationType = animationType;
    
    // Update sprite sheet source and configuration
    if (this.playerSprite) {
      if (animationType === 'idle') {
        this.playerSprite.style.backgroundImage = 'url(sprites/isometric_character_pack/isometric_character_idle.png)';
        this.playerSprite.style.backgroundSize = '800% 800%'; // 8 columns, 8 rows
      } else if (animationType === 'running') {
        this.playerSprite.style.backgroundImage = 'url(sprites/isometric_character_pack/isometric_character_run.png)';
        this.playerSprite.style.backgroundSize = '600% 800%'; // 6 columns, 8 rows
      } else {
        this.playerSprite.style.backgroundImage = 'url(sprites/isometric_character_pack/isometric_character_walk.png)';
        this.playerSprite.style.backgroundSize = '1200% 800%'; // 12 columns, 8 rows
      }
    }
    
    // Restart animation with current direction
    this.startDirectionalAnimation(this.currentPlayerDirection);
  }
}