// view/MapView.ts
import * as turf from "@turf/turf";
import { HQType } from "../model/GameState";

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
    rotateRight: boolean 
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
  private playerMarker: any = null;
  private playerElement: HTMLElement | null = null;
  private playerPosition: { lng: number; lat: number } | null = null;
  private playerRotation: number = 0;
  private playerBaseSize: number = 0.15;
  
  // Input state tracking
  private inputState = {
    forward: false,
    backward: false,
    left: false,        // Now for strafing left
    right: false,       // Now for strafing right
    rotateLeft: false,  // New: for rotation left (shift+left)
    rotateRight: false  // New: for rotation right (shift+right)
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
      pitch: 0, // tilt for 3-D perspective
      bearing: 0, // slight rotation for depth perception
      antialias: true,
      dragRotate: false, // prevents mouse drag rotation,
      touchZoomRotate: false, // prevents touch zoom rotation
      keyboard: false // Disable built-in keyboard navigation to prevent conflicts
    });

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
      case 'ArrowUp':
        if (!this.inputState.forward) {
          this.inputState.forward = true;
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

    if (inputChanged && this.callbacks) {
      this.callbacks.onPlayerInput(this.inputState);
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    let inputChanged = false;

    switch(e.code) {
      case 'ArrowUp':
        if (this.inputState.forward) {
          this.inputState.forward = false;
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

    if (inputChanged && this.callbacks) {
      this.callbacks.onPlayerInput(this.inputState);
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
    console.log('Found transportation layers:', this.transportLayers);
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
      
      const playerImg = this.playerElement.querySelector('img');
      if (playerImg) {
        if (enableTransition) {
          playerImg.style.transition = 'width 0.1s ease, height 0.1s ease';
        } else {
          playerImg.style.transition = 'none';
        }
        playerImg.style.width = `${playerSize}px`;
        playerImg.style.height = `${playerSize}px`;
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
    console.log('Updating influence area with data:', territoryData);
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
    const baseSize = this.playerBaseSize;
    const size = this.calculateMarkerSize(baseSize);
    
    // Create player element as fixed position overlay
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    el.style.alignItems = 'center';
    el.style.backgroundColor = 'transparent';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';
    el.style.willChange = 'transform';
    
    // Add the player icon
    const img = document.createElement('img');
    img.src = 'icons/player_triangle.svg';
    img.alt = 'player';
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    img.style.pointerEvents = 'none';
    img.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))';
    img.style.transform = `rotate(${rotation}deg)`;
    img.style.transformOrigin = 'center';
    img.style.willChange = 'transform';
    el.appendChild(img);

    // Add to map container (not as MapLibre marker)
    const mapContainer = this.map.getContainer();
    mapContainer.appendChild(el);
    
    // Store references
    this.playerElement = el;
    this.playerPosition = coords;
    this.playerRotation = rotation;
    
    // Update position immediately
    this.updatePlayerScreenPosition();
    
    // Listen for map move/zoom events to update position
    this.map.on('move', () => this.updatePlayerScreenPosition());
    this.map.on('zoom', () => this.updatePlayerScreenPosition());
    
    // Cinematic zoom-in effect
    this.map.easeTo({
      center: coords,
      zoom: 19,
      duration: 3000
    });
  }

  // Add this new method for screen position updates:
  private updatePlayerScreenPosition(): void {
    if (!this.playerElement || !this.playerPosition) return;
    
    // Convert geographic coordinates to screen coordinates
    const point = this.map.project(this.playerPosition);
    
    // Update size based on zoom level
    const size = this.calculateMarkerSize(this.playerBaseSize);
    this.playerElement.style.width = `${size}px`;
    this.playerElement.style.height = `${size}px`;
    
    const img = this.playerElement.querySelector('img');
    if (img) {
      img.style.width = `${size}px`;
      img.style.height = `${size}px`;
    }
    
    // Position using CSS transform (smooth, no jitter)
    this.playerElement.style.transform = `translate(${point.x - size/2}px, ${point.y - size/2}px)`;
  }

  // Replace the updatePlayerPosition method:
  updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    // Store new position and rotation
    this.playerPosition = coords;
    this.playerRotation = rotation;
    
    // Update rotation immediately
    const img = this.playerElement?.querySelector('img');
    if (img) {
      img.style.transform = `rotate(${rotation}deg)`;
    }
    
    // Update screen position
    this.updatePlayerScreenPosition();
    
    // Update camera to follow player
    this.centerCameraOnPlayer();
  }

  // Update the centerCameraOnPlayer method:
  centerCameraOnPlayer(): void {
    if (this.playerPosition) {
      this.map.setCenter([this.playerPosition.lng, this.playerPosition.lat]);
    }
  }
}