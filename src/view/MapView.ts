// view/MapView.ts
import { HQType } from "../model/GameState";
import CharacterView from "./CharacterView";
import InputManager from "../input/InputManager";
import { IInputService } from "../input/IInputService";
import { InputState } from "../input/InputTypes";
import { GTA1_STYLE_TOP_DOWN, ENABLE_GLOBE } from "../config";
import { InfluenceLayer, MarkerLayer, CameraController, FeatureQuery } from './map';
import { Position, Rotation } from "../ecs/world";
import { Renderable, Updatable } from "../loop/GameLoop";
import { bridge } from "../sim/SimulationBridge";
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// Callback interface for MapView to communicate with controller
export interface MapViewCallbacks {
  onMapClick: (coords: { lng: number; lat: number }, features: { building?: any, transport?: any }) => void;
  isPlanting: () => boolean;
}

export default class MapView implements Updatable, Renderable {
  private map: any;
  private featureQuery: FeatureQuery | null = null;
  private markerLayer: MarkerLayer | null = null;
  private camera: CameraController | null = null;
  private characterView: CharacterView | null = null;
  private playerPosition: { lng: number; lat: number } | null = null;
  private playerRotation: number = 0;
  private prevPosition: { lng: number; lat: number } | null = null;
  private prevRotation: number = 0;
  private userCameraOverride = false;
  
  // (no per-frame camera state; handled by CameraController)

  // Callbacks for communicating with controller
  private callbacks: MapViewCallbacks | null = null;
  private inputManager: IInputService;
  private createdOwnInputManager: boolean = false;
  private influenceLayer: InfluenceLayer | null = null;

  // ECS player entity id (optional)
  private playerEid: number | null = null;

  constructor(containerId: string = 'map', inputService?: IInputService) {
    // Set up PMTiles protocol for loading .pmtiles files
    const protocol = new Protocol();
    (maplibregl as any).addProtocol("pmtiles", protocol.tile);

    // MapLibre GL JS doesn't require an access token for open data sources
    this.map = new maplibregl.Map({
      container: containerId,
      style: 'offline-map-style.json',
      center: [-74.05682, 40.69337], // starting position [lng, lat]
      zoom: 14, // Start zoomed out for cinematic effect
      minZoom: 1, // Allow zooming out to see the full globe
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
    } as any);

    this.characterView = new CharacterView(this.map);

    // Use injected input service if provided, otherwise create one locally
    if (inputService) {
      this.inputManager = inputService;
      this.createdOwnInputManager = false;
    } else {
      this.inputManager = new InputManager();
      this.createdOwnInputManager = true;
    }

    // Set up input callbacks – MapView cares only about sprite + camera
    this.inputManager.addCallbacks({
      onPlayerInput: (input) => this.handlePlayerInput(input),
      onCameraZoomHold: (direction) => this.camera?.startZoom(direction),
      onCameraZoomRelease: () => this.camera?.stopZoom(),
      onCameraRotateHold: (direction) => this.camera?.startRotate(direction),
      onCameraRotateRelease: () => this.camera?.stopRotate()
    });

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
      // Switch to globe projection for an earth-view experience.
      if (ENABLE_GLOBE) {
        this.map.setProjection({ type: 'globe' });
      }
      // Initialise influence layer (moved out to its own class)
      this.influenceLayer = new InfluenceLayer(this.map);
      this.markerLayer    = new MarkerLayer(this.map);
      this.camera         = new CameraController(this.map, this.characterView);
      this.featureQuery   = new FeatureQuery(this.map);
      this.setupMapEventHandlers();
      
      // Use 'zoomend' instead of 'zoom' for smoother performance
      // But also add 'zoom' for real-time updates
      this.map.on('zoom', () => {
        this.markerLayer?.resizeAll(false);
        this.characterView?.updateCharacterSize(false);
      });

      this.map.on('zoomend', () => {
        this.markerLayer?.resizeAll(true);
        this.characterView?.updateCharacterSize(true);
      });
    });

    this.map.getCanvas().addEventListener('webglcontextlost', (e: WebGLContextEvent) => {
      e.preventDefault();
      console.warn('Context lost – attempting reload');
      this.map.resize();            // triggers style rebuild
    });
  }

  private handlePlayerInput(input: InputState): void {
    // Sync with CharacterView
    if (this.characterView) {
      this.characterView.inputState = { ...input };
    }
    
    // Update movement state
    this.updateMovementState();

    // If player starts moving or rotating, re-enable auto-follow
    if (input.forward || input.backward || input.left || input.right || input.rotateLeft || input.rotateRight) {
      this.disableUserCameraOverride();
    }


  }

  // Getter to expose the map instance to the controller
  get mapInstance(): any {
    return this.map;
  }

  setCallbacks(callbacks: MapViewCallbacks) {
    this.callbacks = callbacks;
  }

  private setupMapEventHandlers() {
    // Click handler for placing HQs
    this.map.on('click', (e: any) => {
      if (!this.callbacks?.isPlanting()) return;

      const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      
      const features = this.featureQuery?.query(e.point) ?? {};
      this.callbacks?.onMapClick(coords, features);

      // Reset cursor
      this.map.getCanvas().style.cursor = '';
    });

    // Change cursor when in planting mode and log building info
    this.map.on('mousemove', (e: any) => {
      this.map.getCanvas().style.cursor = this.callbacks?.isPlanting() ? 'crosshair' : '';
    });

    // Keep character sprite pitch synced with camera pitch
    this.map.on('move', () => {
      if (this.characterView) {
        this.characterView.setCameraPitch(this.map.getPitch());
        this.characterView.setCameraBearing(this.map.getBearing());
        this.characterView.redraw();
      }
    });

    // Detect manual camera drag to override auto-follow – stays until player moves
    this.map.on('dragstart', () => {
      this.enableUserCameraOverride();
    });
  }

  // Delegate HQ marker creation to MarkerLayer
  createHQMarker(coords: { lng: number; lat: number }, type: HQType): any {
    return this.markerLayer?.createHQMarker(coords, type);
  }

  // Forward-compat: keep same public signature used by main.ts
  updateInfluenceArea(territoryData: any) {
    this.influenceLayer?.update(territoryData);
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
      duration: 3000,
      essential: true      // allow user interaction during animation
    } as any);

    // Ensure sprite is visible with correct size immediately
    this.characterView.updateCharacterSize(false);
    this.characterView.redraw();
  }

  // Replace the updatePlayerPosition method:
  updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    if (!this.characterView) return;

    // Delegate the actual update logic to CharacterView
    this.characterView.updatePlayerPosition(coords, rotation);
    
    // Get updated position and rotation from CharacterView for camera logic
    this.playerPosition = this.characterView.getPlayerPosition();
    this.playerRotation = this.characterView.getPlayerRotation();
    
    // Tell camera controller to follow the player unless user is dragging
    if (!this.userCameraOverride) {
      this.camera?.follow(coords);
    }
  }

  // (camera recentering handled inside CameraController)

  // Method to update movement state and switch animations
  private updateMovementState(): void {
    // This logic is now handled by CharacterView. We just trigger it.
    if (this.characterView) {
      this.characterView.updateMovementState();
    }
  }

  /* ------------------------------------------------------------------
   * Updatable implementation – called each GameLoop tick
   * ------------------------------------------------------------------ */
  public update(deltaMs: number): void {
    // Advance animations that live inside CharacterView (and later camera, markers…)
    if (this.characterView) {
      this.characterView.update(deltaMs);
    }

    // Drive camera controller via the central loop
    if (this.camera) {
      this.camera.update(deltaMs);
    }

    if (this.playerEid !== null) {
      let lng: number, lat: number, rot: number;
      if (bridge.isWorkerEnabled()) {
        ({ lng, lat, rot } = bridge.lastPlayer);
      } else {
        lng = Position.x[this.playerEid];
        lat = Position.y[this.playerEid];
        rot = Rotation.angle[this.playerEid];
      }

      this.updatePlayerPosition({ lng, lat }, rot);
      // don't update prevPosition here; handled in render() after interpolation
    }
  }

  /* Renderable interpolation */
  public render(alpha: number): void {
    if (this.playerEid === null || !this.prevPosition) return;
    let currLng: number, currLat: number, currRot: number;
    if (bridge.isWorkerEnabled()) {
      ({ lng: currLng, lat: currLat, rot: currRot } = bridge.lastPlayer);
    } else {
      currLng = Position.x[this.playerEid];
      currLat = Position.y[this.playerEid];
      currRot = Rotation.angle[this.playerEid];
    }

    const lng = this.prevPosition.lng + (currLng - this.prevPosition.lng) * alpha;
    const lat = this.prevPosition.lat + (currLat - this.prevPosition.lat) * alpha;
    const rot = this.prevRotation + (currRot - this.prevRotation) * alpha;

    this.updatePlayerPosition({ lng, lat }, rot);

    // Store as previous for next frame interpolation
    this.prevPosition = { lng: currLng, lat: currLat };
    this.prevRotation = currRot;
  }

  /** Set the ECS entity id representing the player */
  public setPlayerEntity(id: number) {
    this.playerEid = id;
  }

  public destroy(): void {
    // Clean up map resources and event listeners
    if (this.createdOwnInputManager) {
      this.inputManager.destroy();
    }
    if (this.map) {
      this.map.remove();
    }
    this.markerLayer?.destroy();
    this.influenceLayer?.destroy();
    this.camera?.destroy();
  }

  /* ---------------- Camera override handlers ---------------- */
  private enableUserCameraOverride(): void {
    this.userCameraOverride = true;
  }

  private disableUserCameraOverride(): void {
    this.userCameraOverride = false;
  }
}
