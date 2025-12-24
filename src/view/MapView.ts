/**
 * MapView - Main View Component for Map Rendering and Interaction
 * 
 * MapView is the central view component that manages the MapLibre GL map instance and coordinates
 * all visual elements displayed on the map. It acts as the orchestrator for multiple specialized
 * sub-components, handling the integration between the game logic (controller) and the visual
 * representation (view).
 * 
 * **Key Responsibilities:**
 * - **Map Management**: Initializes and manages the MapLibre GL map instance
 * - **Component Coordination**: Delegates to specialized components (CharacterView, CameraController,
 *   MarkerLayer, InfluenceLayer, FeatureQuery)
 * - **Input Handling**: Receives input events and routes them to appropriate components
 * - **Player Tracking**: Updates player position and rotation, manages camera following
 * - **Map Events**: Handles clicks, drags, zoom, and other map interactions
 * - **Game Loop Integration**: Implements Updatable and Renderable for frame-based updates
 * 
 * **Architecture:**
 * - **MVC Pattern**: Acts as the View layer, communicating with Controller via callbacks
 * - **Delegation**: Delegates specific responsibilities to specialized components:
 *   - `CharacterView`: Player sprite rendering and animation
 *   - `CameraController`: Camera following, zoom, and rotation
 *   - `MarkerLayer`: HQ markers and other map markers
 *   - `InfluenceLayer`: Territory influence visualization
 *   - `FeatureQuery`: Building/transport feature detection
 * 
 * **Game Loop Integration:**
 * - `update(deltaMs)`: Called each fixed timestep to advance animations and camera logic
 * - `render(alpha)`: Called each frame for smooth interpolation between fixed updates
 * 
 * **Player Position Management:**
 * - Tracks player position from ECS (via `playerEid`)
 * - Queries ECS world directly for NPC positions
 * - Handles interpolation for smooth rendering between fixed updates
 * 
 * **Camera Behavior:**
 * - Auto-follows player unless user manually drags camera
 * - User camera override is disabled when player starts moving
 * - Delegates camera logic to CameraController for continuous zoom/rotation
 */

// view/MapView.ts
import { HQType } from "../model/GameState";
import CharacterView from "./CharacterView";
import InputManager from "../input/InputManager";
import { IInputService } from "../input/IInputService";
import { InputState } from "../input/InputTypes";
import { GTA1_STYLE_TOP_DOWN, ENABLE_GLOBE, MAP_PROJECTION } from "../config";
import { InfluenceLayer, MarkerLayer, CameraController, FeatureQuery } from './map';
import { Position, Rotation } from "../ecs/world";
import { Renderable, Updatable } from "../loop/GameLoop";
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

/**
 * Callback interface for MapView to communicate with the game controller.
 * This allows MapView to notify the controller of user interactions without
 * creating a direct dependency on the controller implementation.
 */
export interface MapViewCallbacks {
  /** Called when user clicks on the map (e.g., to place an HQ) */
  onMapClick: (coords: { lng: number; lat: number }, features: { building?: any, transport?: any }) => void;
  /** Returns true if the game is currently in "planting" mode (placing HQs) */
  isPlanting: () => boolean;
}

/**
 * Main view component that manages the map and all visual elements.
 * Implements Updatable and Renderable for integration with the game loop.
 */
export default class MapView implements Updatable, Renderable {
  // Core map instance (MapLibre GL JS map object)
  private map: any;
  
  // Specialized sub-components (initialized after map loads)
  private featureQuery: FeatureQuery | null = null; // Queries map features (buildings, transport) at click points
  private markerLayer: MarkerLayer | null = null; // Manages HQ markers and other map markers
  private camera: CameraController | null = null; // Handles camera following, zoom, and rotation
  private characterView: CharacterView | null = null; // Renders and animates the player character sprite
  private influenceLayer: InfluenceLayer | null = null; // Visualizes territory influence areas
  
  // Player state tracking
  private playerPosition: { lng: number; lat: number } | null = null; // Current player position (lat/lng)
  private playerRotation: number = 0; // Current player rotation (radians)
  
  // Previous frame state for interpolation (used in render())
  private prevPosition: { lng: number; lat: number } | null = null;
  private prevRotation: number = 0;
  
  // Camera control state
  private userCameraOverride = false; // When true, camera doesn't auto-follow player (user is manually dragging)
  // Note: Per-frame camera state is handled by CameraController, not MapView

  // Communication with game controller (set via setCallbacks())
  private callbacks: MapViewCallbacks | null = null;
  
  // Input management
  private inputManager: IInputService; // Handles keyboard input and dispatches to registered callbacks
  private createdOwnInputManager: boolean = false; // True if we created InputManager, false if injected

  // ECS integration: player entity ID (set via setPlayerEntity())
  // When set, MapView reads player position/rotation from ECS components
  private playerEid: number | null = null;

  /**
   * Constructs a new MapView instance.
   * 
   * Initialization process:
   * 1. Sets up PMTiles protocol for offline map tile loading
   * 2. Creates MapLibre map instance with initial configuration
   * 3. Creates CharacterView for player sprite rendering
   * 4. Sets up input manager (injected or created locally)
   * 5. Registers input callbacks for player movement and camera controls
   * 6. Sets up map event handlers (load, error, WebGL context loss)
   * 7. Initializes sub-components after map loads (via 'load' event)
   * 
   * @param containerId - HTML element ID where the map will be rendered (default: 'map')
   * @param inputService - Optional input service to inject (for testing or shared input)
   */
  constructor(containerId: string = 'map', inputService?: IInputService) {
    // Set up PMTiles protocol handler for loading .pmtiles files
    // PMTiles is an efficient single-file format for map tiles (used for offline maps)
    const protocol = new Protocol();
    (maplibregl as any).addProtocol("pmtiles", protocol.tile);

    // Create MapLibre GL JS map instance
    // MapLibre GL JS doesn't require an access token for open data sources
    
    // Build projection configuration based on config
    // Note: MapLibre GL JS v5.6.1 only supports: 'mercator', 'globe', 'vertical-perspective'
    let projectionConfig: any = undefined;
    if (ENABLE_GLOBE) {
      projectionConfig = { type: 'globe' };
    } else if (MAP_PROJECTION !== 'mercator') {
      // Only 'globe' and 'vertical-perspective' are supported (besides 'mercator')
      projectionConfig = { type: MAP_PROJECTION };
    }
    // Mercator is the default, so no need to set projectionConfig
    
    if (projectionConfig) {
      console.log(`[MapView] Setting projection to: ${projectionConfig.type}`, projectionConfig);
    } else {
      console.log('[MapView] Using default Mercator projection');
    }
    
    this.map = new maplibregl.Map({
      container: containerId, // HTML element to render map into
      style: 'offline-map-style.json', // Map style configuration (defines layers, sources, etc.)
      center: [-74.05682, 40.69337], // Starting position [lng, lat] (New York area)
      zoom: 14, // Start zoomed out for cinematic effect (will zoom in when player spawns)
      minZoom: 1, // Allow zooming out to see the full globe
      pitch: GTA1_STYLE_TOP_DOWN ? 0 : 55, // Camera angle: 0 = top-down, 55 = angled view
      bearing: 0, // Map rotation (0 = north up)
      antialias: true, // Enable antialiasing for smoother rendering
      dragRotate: true, // Allow mouse drag to rotate map
      dragPitch: GTA1_STYLE_TOP_DOWN ? false : true, // Allow mouse drag to change pitch (disabled in top-down mode)
      dragPan: true, // Allow mouse drag to pan map
      pitchWithRotate: GTA1_STYLE_TOP_DOWN ? false : true, // Change pitch when rotating (disabled in top-down)
      touchZoomRotate: GTA1_STYLE_TOP_DOWN ? false : true, // Allow touch gestures for zoom/rotate (disabled in top-down)
      keyboard: false, // Disable built-in keyboard navigation to prevent conflicts with game controls
      maxPitch: 90, // Maximum camera pitch angle (90 = looking straight down)
      projection: projectionConfig // Set projection at initialization (required for proper reprojection)
    } as any);

    // Create CharacterView for player sprite rendering (created early, before map loads)
    this.characterView = new CharacterView(this.map);

    // Use injected input service if provided (for testing or shared input), otherwise create one locally
    if (inputService) {
      this.inputManager = inputService;
      this.createdOwnInputManager = false;
    } else {
      this.inputManager = new InputManager();
      this.createdOwnInputManager = true;
    }

    // Register input callbacks – MapView handles player input and camera controls
    // Note: Camera controller is created after map loads, so callbacks use optional chaining (?)
    this.inputManager.addCallbacks({
      onPlayerInput: (input) => this.handlePlayerInput(input), // Player movement/rotation input
      onCameraZoomHold: (direction) => this.camera?.startZoom(direction), // Start continuous zoom
      onCameraZoomRelease: () => this.camera?.stopZoom(), // Stop continuous zoom
      onCameraRotateHold: (direction) => this.camera?.startRotate(direction), // Start continuous rotation
      onCameraRotateRelease: () => this.camera?.stopRotate() // Stop continuous rotation
    });

    // Handle missing images gracefully (prevents errors when map style references missing icons)
    // Creates a transparent 1x1 pixel placeholder for any missing images
    this.map.on('styleimagemissing', (e: any) => {
      const width = 1;
      const height = 1;
      const data = new Uint8Array([0, 0, 0, 0]); // Transparent pixel
      if (!this.map.hasImage(e.id)) {
        this.map.addImage(e.id, { width, height, data });
      }
    });

    // Handle map errors (suppress harmless PMTiles fetch errors, log others)
    this.map.on('error', (e: any) => {
      // Suppress harmless tile loading errors (e.g., missing offline tiles)
      if (e.error?.message === 'Failed to fetch' && e.source?.url?.includes('pmtiles://')) {
        return;
      }
      console.error('Map error:', e);
    });

    // Map load event: Initialize all sub-components after map is ready
    // This is when the map style has loaded and the map is ready for interaction
    this.map.on('load', () => {
      // Verify and set projection (some MapLibre versions require setProjection after load)
      // This ensures projection is applied even if constructor option didn't work
      // Note: Only 'mercator', 'globe', and 'vertical-perspective' are supported
      if (ENABLE_GLOBE) {
        this.map.setProjection({ type: 'globe' });
        console.log('[MapView] Projection set to: globe');
      } else if (MAP_PROJECTION !== 'mercator') {
        this.map.setProjection({ type: MAP_PROJECTION });
        console.log(`[MapView] Projection set to: ${MAP_PROJECTION}`);
      } else {
        console.log('[MapView] Using default Mercator projection');
      }
      
      // Initialize all specialized sub-components (they need the map to be loaded)
      this.influenceLayer = new InfluenceLayer(this.map); // Territory influence visualization
      this.markerLayer    = new MarkerLayer(this.map); // HQ markers and other map markers
      this.camera         = new CameraController(this.map, this.characterView); // Camera controls
      this.featureQuery   = new FeatureQuery(this.map); // Building/transport feature queries
      
      // Set up map interaction event handlers (clicks, drags, etc.)
      this.setupMapEventHandlers();
      
      // Handle zoom events: resize markers and character sprite
      // 'zoom' fires continuously during zoom (for real-time updates)
      this.map.on('zoom', () => {
        this.markerLayer?.resizeAll(false); // Resize without finalizing (performance optimization)
        this.characterView?.updateCharacterSize(false);
      });

      // 'zoomend' fires once when zoom completes (for final size calculation)
      this.map.on('zoomend', () => {
        this.markerLayer?.resizeAll(true); // Finalize sizes
        this.characterView?.updateCharacterSize(true);
      });
    });

    // Handle WebGL context loss (can happen on mobile devices or GPU issues)
    // Attempts to recover by resizing the map (triggers style rebuild)
    this.map.getCanvas().addEventListener('webglcontextlost', (e: WebGLContextEvent) => {
      e.preventDefault(); // Prevent default behavior (which would be to stop rendering)
      console.warn('Context lost – attempting reload');
      this.map.resize(); // Triggers style rebuild, which may recover the context
    });
  }

  /**
   * Handles player input events from InputManager.
   * Syncs input state to CharacterView and manages camera override behavior.
   * 
   * @param input - Current input state (keys pressed, rotation, etc.)
   */
  private handlePlayerInput(input: InputState): void {
    // Sync input state to CharacterView (for animation switching)
    if (this.characterView) {
      this.characterView.inputState = { ...input }; // Copy to avoid reference issues
    }
    
    // Update movement state (triggers animation switching in CharacterView)
    this.updateMovementState();

    // If player starts moving or rotating, re-enable auto-follow camera
    // This allows user to manually drag camera, but resumes following when player moves
    if (input.forward || input.backward || input.left || input.right || input.rotateLeft || input.rotateRight) {
      this.disableUserCameraOverride();
    }
  }

  /**
   * Getter to expose the map instance to the controller.
   * Allows controller to access map methods directly if needed.
   * 
   * @returns The MapLibre map instance
   */
  get mapInstance(): any {
    return this.map;
  }

  /**
   * Sets callbacks for communicating with the game controller.
   * Called by the controller to register its event handlers.
   * 
   * @param callbacks - Callback functions for map interactions
   */
  setCallbacks(callbacks: MapViewCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Sets up map event handlers for user interactions.
   * Handles clicks, mouse movement, camera movement, and drag detection.
   */
  private setupMapEventHandlers() {
    // Click handler for placing HQs (only active when in "planting" mode)
    this.map.on('click', (e: any) => {
      // Only handle clicks when in planting mode
      if (!this.callbacks?.isPlanting()) return;

      // Extract coordinates from click event
      const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      
      // Query map features at click point (buildings, transport, etc.)
      const features = this.featureQuery?.query(e.point) ?? {};
      
      // Notify controller of click with coordinates and features
      this.callbacks?.onMapClick(coords, features);

      // Reset cursor to default after click
      this.map.getCanvas().style.cursor = '';
    });

    // Change cursor to crosshair when in planting mode (visual feedback)
    this.map.on('mousemove', (e: any) => {
      this.map.getCanvas().style.cursor = this.callbacks?.isPlanting() ? 'crosshair' : '';
    });

    // Keep character sprite pitch/bearing synced with camera
    // This ensures the character sprite appears correctly oriented relative to camera angle
    this.map.on('move', () => {
      if (this.characterView) {
        this.characterView.setCameraPitch(this.map.getPitch()); // Camera angle
        this.characterView.setCameraBearing(this.map.getBearing()); // Camera rotation
        this.characterView.redraw(); // Redraw sprite with new camera state
      }
    });

    // Detect manual camera drag to disable auto-follow
    // When user drags camera manually, stop following player until player moves again
    this.map.on('dragstart', () => {
      this.enableUserCameraOverride();
    });
  }

  /**
   * Creates an HQ marker on the map at the specified coordinates.
   * Delegates to MarkerLayer for actual marker creation.
   * 
   * @param coords - Map coordinates where the HQ should be placed
   * @param type - Type of HQ (from GameState.HQType enum)
   * @returns The created marker object (or undefined if MarkerLayer not initialized)
   */
  createHQMarker(coords: { lng: number; lat: number }, type: HQType): any {
    return this.markerLayer?.createHQMarker(coords, type);
  }

  /**
   * Updates the territory influence area visualization.
   * Delegates to InfluenceLayer for actual rendering.
   * Called by controller when territory data changes.
   * 
   * @param territoryData - Territory data to visualize (format defined by InfluenceLayer)
   */
  updateInfluenceArea(territoryData: any) {
    this.influenceLayer?.update(territoryData);
  }

  /**
   * Creates the player character sprite on the map.
   * Called once when the player spawns. Performs a cinematic zoom-in effect.
   * 
   * Process:
   * 1. Creates character sprite via CharacterView
   * 2. Stores initial position/rotation for camera tracking
   * 3. Animates camera zoom-in to player location
   * 4. Ensures sprite is visible and correctly sized
   * 
   * @param coords - Initial player spawn coordinates
   * @param rotation - Initial player rotation (radians, default: 0)
   */
  createPlayerCharacter(coords: { lng: number; lat: number }, rotation: number = 0): void {
    if (!this.characterView) return;

    // Delegate sprite creation to CharacterView
    this.characterView.createPlayerCharacter(coords, rotation);

    // Store position and rotation for camera controls
    this.playerPosition = this.characterView.getPlayerPosition();
    this.playerRotation = this.characterView.getPlayerRotation();

    // Cinematic zoom-in effect: smoothly animate camera to player location
    // Starts from initial zoom (14) and zooms in to close-up view (21.5)
    this.map.easeTo({
      center: coords, // Center camera on player
      zoom: 21.5, // Target zoom level (very close, street-level view)
      duration: 3000, // Animation duration (3 seconds)
      essential: true // Allow user interaction during animation (user can interrupt)
    } as any);

    // Ensure sprite is visible with correct size immediately (before zoom completes)
    this.characterView.updateCharacterSize(false);
    this.characterView.redraw();
  }

  /**
   * Updates the player character's position and rotation on the map.
   * Called each frame to keep the sprite synchronized with game state.
   * 
   * Process:
   * 1. Updates sprite position/rotation via CharacterView
   * 2. Stores updated state for camera tracking
   * 3. Tells camera to follow player (unless user is manually dragging)
   * 
   * @param coords - New player coordinates
   * @param rotation - New player rotation (radians)
   */
  updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    if (!this.characterView) return;

    // Delegate position update to CharacterView (handles sprite positioning)
    this.characterView.updatePlayerPosition(coords, rotation);
    
    // Get updated position and rotation from CharacterView (may have been adjusted)
    this.playerPosition = this.characterView.getPlayerPosition();
    this.playerRotation = this.characterView.getPlayerRotation();
    
    // Tell camera controller to follow the player unless user is manually dragging
    // Camera override is enabled when user drags, disabled when player moves
    if (!this.userCameraOverride) {
      this.camera?.follow(coords);
    }
  }

  /**
   * Updates movement state and triggers animation switching in CharacterView.
   * CharacterView handles the actual logic for switching between idle/walk/run animations.
   */
  private updateMovementState(): void {
    if (this.characterView) {
      this.characterView.updateMovementState();
    }
  }

  /**
   * Updatable implementation – called each fixed timestep by GameLoop.
   * 
   * Updates all time-based animations and reads player position from ECS.
   * Note: This uses the authoritative position from the fixed timestep, not interpolated.
   * 
   * Process:
   * 1. Advance character animations (sprite frame updates)
   * 2. Update camera controller (continuous zoom/rotation)
   * 3. Read player position from ECS
   * 4. Update player sprite position (non-interpolated, authoritative)
   * 
   * @param deltaMs - Time elapsed since last update (milliseconds)
   */
  public update(deltaMs: number): void {
    // Advance character sprite animations (frame updates)
    if (this.characterView) {
      this.characterView.update(deltaMs);
    }

    // Update camera controller (handles continuous zoom/rotation if active)
    if (this.camera) {
      this.camera.update(deltaMs);
    }

    // If player entity ID is set, read position from ECS
    if (this.playerEid !== null) {
      // Read directly from ECS components
      const lng = Position.x[this.playerEid];
      const lat = Position.y[this.playerEid];
      const rot = Rotation.angle[this.playerEid];

      // Update player position with authoritative (non-interpolated) values
      this.updatePlayerPosition({ lng, lat }, rot);
      
      // Note: prevPosition is NOT updated here - it's updated in render() after interpolation
      // This ensures render() always has the previous fixed-timestep position for interpolation
    }
  }

  /**
   * Renderable implementation – called each frame by GameLoop for smooth interpolation.
   * 
   * Interpolates between the previous fixed-timestep position and the current position
   * to provide smooth rendering regardless of frame rate. This eliminates stuttering
   * when the frame rate doesn't match the fixed timestep rate.
   * 
   * Interpolation formula: lerp(prev, curr, alpha)
   * - alpha = 0: use previous position
   * - alpha = 1: use current position
   * - alpha = 0.5: halfway between (typical case)
   * 
   * @param alpha - Interpolation factor (0.0 to 1.0) representing position between
   *                previous fixed update and current fixed update
   */
  public render(alpha: number): void {
    // Early exit if player entity not set or no previous position (first frame)
    if (this.playerEid === null || !this.prevPosition) return;
    
    // Read current authoritative position from ECS
    const currLng = Position.x[this.playerEid];
    const currLat = Position.y[this.playerEid];
    const currRot = Rotation.angle[this.playerEid];

    // Interpolate between previous and current position
    // This provides smooth rendering even if frame rate doesn't match fixed timestep
    const lng = this.prevPosition.lng + (currLng - this.prevPosition.lng) * alpha;
    const lat = this.prevPosition.lat + (currLat - this.prevPosition.lat) * alpha;
    const rot = this.prevRotation + (currRot - this.prevRotation) * alpha;

    // Update sprite with interpolated position (smooth visual update)
    this.updatePlayerPosition({ lng, lat }, rot);

    // Store current authoritative position as previous for next frame interpolation
    // This ensures we always interpolate between two consecutive fixed-timestep positions
    this.prevPosition = { lng: currLng, lat: currLat };
    this.prevRotation = currRot;
  }

  /**
   * Sets the ECS entity ID representing the player.
   * Once set, MapView will automatically read player position/rotation from ECS components
   * from ECS each frame.
   * 
   * @param id - ECS entity ID of the player
   */
  public setPlayerEntity(id: number) {
    this.playerEid = id;
  }

  /**
   * Cleans up all resources and event listeners.
   * Should be called when MapView is no longer needed (e.g., when switching scenes).
   */
  public destroy(): void {
    // Clean up input manager if we created it (don't destroy injected ones)
    if (this.createdOwnInputManager) {
      this.inputManager.destroy();
    }
    
    // Remove map instance (cleans up all map resources and event listeners)
    if (this.map) {
      this.map.remove();
    }
    
    // Clean up sub-components
    this.markerLayer?.destroy();
    this.influenceLayer?.destroy();
    this.camera?.destroy();
  }

  /* ---------------- Camera override handlers ---------------- */
  
  /**
   * Enables user camera override mode.
   * When enabled, camera will not auto-follow the player (user is manually controlling camera).
   */
  private enableUserCameraOverride(): void {
    this.userCameraOverride = true;
  }

  /**
   * Disables user camera override mode.
   * When disabled, camera will resume auto-following the player.
   */
  private disableUserCameraOverride(): void {
    this.userCameraOverride = false;
  }
}
