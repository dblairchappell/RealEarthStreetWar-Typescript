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
 * - **Component Coordination**: Delegates to specialized components (PlayerDomView/PlayerCanvasView/PlayerWebglView, CameraController,
 *   MarkerLayer, FeatureQuery)
 * - **Input Handling**: Receives input events and routes them to appropriate components
 * - **Player Tracking**: Updates player position and rotation, manages camera following
 * - **Map Events**: Handles clicks, drags, zoom, and other map interactions
 * - **Game Loop Integration**: Implements Updatable and Renderable for frame-based updates
 * 
 * **Architecture:**
 * - **MVC Pattern**: Acts as the View layer, communicating with Controller via callbacks
 * - **Delegation**: Delegates specific responsibilities to specialized components:
 *   - `PlayerDomView`/`PlayerCanvasView`/`PlayerWebglView`: Player sprite rendering and animation
 *   - `CameraController`: Camera following, zoom, and rotation
 *   - `MarkerLayer`: Map markers
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
import PlayerDomView from "./PlayerDomView";
import PlayerCanvasView from "./PlayerCanvasView";
import PlayerWebglView from "./PlayerWebglView";
import InputManager from "../input/InputManager";
import { IInputService } from "../input/IInputService";
import { InputState } from "@shared/realearthstreetwar";
import { GTA1_STYLE_TOP_DOWN, MAP_PROJECTION, SHOW_BUILDINGS, SHOW_BUILDINGS_3D, PLAYER_RENDER_PATH, SHOW_TERRAIN, TERRAIN_EXAGGERATION } from "../config";
import { MarkerLayer, CameraController, FeatureQuery } from './map';
import { Position, Rotation } from "../ecs/world";
import { Renderable, Updatable } from "../loop/GameLoop";
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { EntityClickHandler, EntityInfo } from "./EntityClickHandler";


/**
 * Main view component that manages the map and all visual elements.
 * Implements Updatable and Renderable for integration with the game loop.
 */
export default class MapView implements Updatable, Renderable {
  // Core map instance (MapLibre GL JS map object)
  private map: any;
  
  // Specialized sub-components (initialized after map loads)
  private featureQuery: FeatureQuery | null = null; // Queries map features (buildings, transport) at click points
  private markerLayer: MarkerLayer | null = null; // Manages map markers
  private camera: CameraController | null = null; // Handles camera following, zoom, and rotation
  private playerDomView: PlayerDomView | null = null; // Renders and animates the player character sprite (DOM path)
  private playerCanvasView: PlayerCanvasView | null = null; // Renders and animates the player character sprite (Canvas path)
  private playerWebglView: PlayerWebglView | null = null; // Manages player rendering for WebGL path
  private entityClickHandler: EntityClickHandler | null = null; // Handles clicking on entities
  private npcLayer: any = null; // NPC rendering layer (NpcCanvasLayer or NpcWebglLayer)
  private npcController: any = null; // NPC controller (for WebGL path)
  
  // Player state tracking
  private playerPosition: { lng: number; lat: number } | null = null; // Current player position (lat/lng)
  private playerRotation: number = 0; // Current player rotation (radians)
  
  // Previous frame state for interpolation (used in render())
  private prevPosition: { lng: number; lat: number } | null = null;
  private prevRotation: number = 0;
  
  // Camera control state
  private cameraFollowEnabled = true; // Whether camera should auto-follow player
  private cameraFollowLocked = false; // When true, cameraFollowEnabled cannot be auto-changed (locked via Shift+C toggle)
  private movementKeysJustPressed = false; // Track if movement keys were just pressed (to avoid re-enabling follow every frame)
  // Note: Per-frame camera state is handled by CameraController, not MapView

  
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
   * 3. Creates PlayerDomView/PlayerCanvasView/PlayerWebglView for player sprite rendering
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
    
    // Build projection configuration based on MAP_PROJECTION
    // Note: MapLibre GL JS v5.6.1 only supports: 'mercator', 'globe', 'vertical-perspective'
    let projectionConfig: any = undefined;
    if (MAP_PROJECTION !== 'mercator') {
      // Only 'globe' and 'vertical-perspective' need explicit configuration
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
      style: 'config/offline-map-style.json', // Map style configuration (defines layers, sources, etc.)
      center: [-74.05682, 40.69337], // Starting position [lng, lat] (New York area)
      zoom: 14, // Start zoomed out for cinematic effect (will zoom in when player spawns)
      minZoom: 1, // Allow zooming out to see the full globe
      maxZoom: 23.5, // Maximum zoom level
      pitch: GTA1_STYLE_TOP_DOWN ? 0 : 55, // Camera angle: 0 = top-down, 55 = angled view
      bearing: 0, // Map rotation (0 = north up)
      antialias: true, // Enable antialiasing for smoother rendering
      dragRotate: true, // Allow mouse drag to rotate map
      dragPitch: GTA1_STYLE_TOP_DOWN ? false : true, // Allow mouse drag to change pitch (disabled in top-down mode)
      dragPan: true, // Allow mouse drag to pan map
      pitchWithRotate: GTA1_STYLE_TOP_DOWN ? false : true, // Change pitch when rotating (disabled in top-down)
      touchZoomRotate: GTA1_STYLE_TOP_DOWN ? false : true, // Allow touch gestures for zoom/rotate (disabled in top-down)
      keyboard: false, // Disable built-in keyboard navigation to prevent conflicts with game controls
      maxPitch: 60, // Maximum camera pitch angle (90 = looking straight down)
      projection: projectionConfig // Set projection at initialization (required for proper reprojection)
    } as any);

    // Create player rendering layer based on config
    // DOM path: PlayerDomView (CSS transforms)
    // Canvas path: PlayerCanvasView (consistent with NPC rendering)
    if (PLAYER_RENDER_PATH === 'canvas') {
      this.playerCanvasView = new PlayerCanvasView(this.map);
    } else {
      this.playerDomView = new PlayerDomView(this.map);
    }

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
      onPlayerInput: (input: InputState) => this.handlePlayerInput(input), // Player movement/rotation input
      onCameraZoomHold: (direction: 'in' | 'out') => this.camera?.startZoom(direction), // Start continuous zoom
      onCameraZoomRelease: () => this.camera?.stopZoom(), // Stop continuous zoom
      onCameraRotateHold: (direction: 'left' | 'right') => this.camera?.startRotate(direction), // Start continuous rotation
      onCameraRotateRelease: () => this.camera?.stopRotate(), // Stop continuous rotation
      onCameraPanHold: (direction: 'up' | 'down' | 'left' | 'right') => this.camera?.startPan(direction), // Start camera panning (Shift+WASD)
      onCameraPanRelease: () => this.camera?.stopPan(), // Stop camera panning
      onCameraPanPause: () => this.camera?.pausePan(), // Pause panning movement but keep position
      onCameraFollowToggle: () => this.toggleCameraFollow() // Toggle camera follow (Shift+C)
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
      // Log PMTiles errors with full details for debugging
      if (e.source?.url?.includes('pmtiles://')) {
        console.error('PMTiles error details:', {
          error: e.error,
          message: e.error?.message,
          stack: e.error?.stack,
          source: e.source,
          sourceId: e.sourceId,
          url: e.source?.url,
          tile: e.tile
        });
        // Continue to log the full error object as well
      }
      console.error('Map error:', e);
    });

    // Map load event: Initialize all sub-components after map is ready
    // This is when the map style has loaded and the map is ready for interaction
    this.map.on('load', () => {
      // Verify and set projection (some MapLibre versions require setProjection after load)
      // This ensures projection is applied even if constructor option didn't work
      // Note: Only 'mercator', 'globe', and 'vertical-perspective' are supported
      if (MAP_PROJECTION !== 'mercator') {
        this.map.setProjection({ type: MAP_PROJECTION });
        console.log(`[MapView] Projection set to: ${MAP_PROJECTION}`);
      } else {
        console.log('[MapView] Using default Mercator projection');
      }
      
      // Hide/show building layers based on config flags
      if (!SHOW_BUILDINGS) {
        this.map.setLayoutProperty('building-footprints', 'visibility', 'none');
        console.log('[MapView] Building footprints hidden');
      }
      
      // Hide 3D buildings if disabled OR in top-down mode (orthographic view)
      if (!SHOW_BUILDINGS_3D) {
        this.map.setLayoutProperty('building-3d', 'visibility', 'none');
        if (!SHOW_BUILDINGS_3D) {
          console.log('[MapView] 3D building extrusions hidden');
        } else {
          console.log('[MapView] Hidden 3D building layer for orthographic view');
        }
      }
      
      // Setup 3D terrain if enabled (only works when pitch > 0, so skip in top-down mode)
      if (SHOW_TERRAIN && !GTA1_STYLE_TOP_DOWN) {
        try {
          // Add terrain DEM source
          if (!this.map.getSource('terrainSource')) {
            this.map.addSource('terrainSource', {
              type: 'raster-dem',
              url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
              tileSize: 256
            });
          }
          
          // Add hillshade DEM source (separate source improves render quality)
          if (!this.map.getSource('hillshadeSource')) {
            this.map.addSource('hillshadeSource', {
              type: 'raster-dem',
              url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
              tileSize: 256
            });
          }
          
          // Add hillshade layer (for shadows/depth) - insert before other layers
          if (!this.map.getLayer('hills')) {
            this.map.addLayer({
              id: 'hills',
              type: 'hillshade',
              source: 'hillshadeSource',
              layout: {
                visibility: 'visible'
              },
              paint: {
                'hillshade-shadow-color': '#473B24'
              }
            }, 'background'); // Insert before background layer
          }
          
          // Configure terrain using MapLibre API
          this.map.setTerrain({
            source: 'terrainSource',
            exaggeration: TERRAIN_EXAGGERATION
          });
          
          console.log(`[MapView] 3D terrain enabled with exaggeration: ${TERRAIN_EXAGGERATION}`);
        } catch (error) {
          console.warn('[MapView] Failed to enable 3D terrain:', error);
        }
      } else if (SHOW_TERRAIN && GTA1_STYLE_TOP_DOWN) {
        console.log('[MapView] Terrain disabled (requires pitch > 0, but top-down mode is enabled)');
      } else if (!SHOW_TERRAIN) {
        // Ensure terrain is disabled if flag is false
        try {
          this.map.setTerrain(null);
        } catch (error) {
          // Ignore errors if terrain wasn't enabled
        }
      }
      
      // Initialize all specialized sub-components (they need the map to be loaded)
      this.markerLayer    = new MarkerLayer(this.map); // Map markers
      // Camera controller needs PlayerDomView for DOM path (for compatibility), but can work without it
      this.camera         = new CameraController(this.map, this.playerDomView); // Camera controls
      this.featureQuery   = new FeatureQuery(this.map); // Building/transport feature queries
      
      // Set up map interaction event handlers (clicks, drags, etc.)
      this.setupMapEventHandlers();
      
      // Detect manual zoom via mouse wheel to disable auto-follow
      // Listen directly to wheel events to detect user-initiated zoom
      const mapContainer = this.map.getContainer();
      mapContainer.addEventListener('wheel', () => {
        if (!this.cameraFollowLocked) {
          this.setCameraFollowEnabled(false);
        }
      }, { passive: true });
      
      // Handle zoom events: resize markers and character sprite
      // 'zoom' fires continuously during zoom (for real-time updates)
      this.map.on('zoom', () => {
        this.markerLayer?.resizeAll(false); // Resize without finalizing (performance optimization)
        this.playerDomView?.updateCharacterSize(false);
      });

      // 'zoomend' fires once when zoom completes (for final size calculation)
      this.map.on('zoomend', () => {
        this.markerLayer?.resizeAll(true); // Finalize sizes
        this.playerDomView?.updateCharacterSize(true);
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
   * Syncs input state to PlayerDomView/PlayerCanvasView/PlayerWebglView and manages camera override behavior.
   * 
   * @param input - Current input state (keys pressed, rotation, etc.)
   */
  private handlePlayerInput(input: InputState): void {
    // Sync input state to player rendering layer (for animation switching)
    if (this.playerDomView) {
      this.playerDomView.inputState = { ...input }; // Copy to avoid reference issues (DOM path)
    }
    if (this.playerCanvasView) {
      this.playerCanvasView.updateInputState(input); // Canvas path
    }
    if (this.playerWebglView) {
      this.playerWebglView.updateInputState(input); // WebGL path
    }
    
    // Update movement state (triggers animation switching)
    this.updateMovementState();

    // Check if movement keys are currently pressed
    const movementKeysPressed = input.forward || input.backward || input.left || input.right || input.rotateLeft || input.rotateRight;
    
    // Only re-enable camera follow when movement keys are FIRST pressed (not every frame)
    // AND only if camera is not busy with user controls
    if (movementKeysPressed && !this.movementKeysJustPressed) {
      this.movementKeysJustPressed = true;
      
      // Check if camera is currently busy with user controls (zoom/rotate/pan)
      const cameraBusy = this.camera?.isBusy() ?? false;
      
      // Only re-enable follow if camera is not busy and not locked
      // This prevents race conditions where follow gets enabled but can't actually follow
      // until camera controls are released
      if (!cameraBusy && !this.cameraFollowLocked) {
        this.setCameraFollowEnabled(true);
      }
    } else if (!movementKeysPressed) {
      // Reset flag when no movement keys are pressed
      this.movementKeysJustPressed = false;
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

  /**
   * Sets up map event handlers for user interactions.
   * Handles camera movement and drag detection.
   */
  private setupMapEventHandlers() {

    // Keep character sprite pitch/bearing synced with camera
    // This ensures the character sprite appears correctly oriented relative to camera angle
    this.map.on('move', () => {
      const pitch = this.map.getPitch();
      const bearing = this.map.getBearing();
      if (this.playerDomView) {
        this.playerDomView.setCameraPitch(pitch); // Camera angle (DOM path)
        this.playerDomView.setCameraBearing(bearing); // Camera rotation (DOM path)
        this.playerDomView.redraw(); // Redraw sprite with new camera state (DOM path)
      }
      if (this.playerCanvasView) {
        this.playerCanvasView.setCameraPitch(pitch); // Camera angle (Canvas path)
        this.playerCanvasView.setCameraBearing(bearing); // Camera rotation (Canvas path)
        this.playerCanvasView.redraw(); // Trigger redraw (Canvas path)
      }
      // WebGL path doesn't need camera updates - it reads bearing directly in render()
    });

    // Detect manual camera interactions to disable auto-follow
    // When user interacts with camera via mouse (drag, rotate, pitch, zoom), 
    // stop following player until movement key is pressed
    // (unless camera follow is locked via Shift+C toggle)
    
    // Detect drag start (panning)
    this.map.on('dragstart', () => {
      //console.log('[MapView] Drag started - disabling camera follow');
      if (!this.cameraFollowLocked) {
        this.setCameraFollowEnabled(false);
      }
    });
    
    // Detect rotation start (drag to rotate)
    // Only disable follow if this is user-initiated (mouse drag), not programmatic (keyboard)
    this.map.on('rotatestart', (e: any) => {
      // Check if rotation was initiated by keyboard controls
      // If camera is already rotating via keyboard, don't disable follow
      const isKeyboardRotation = this.camera?.isRotating() ?? false;
      if (!isKeyboardRotation) {
        console.log('[MapView] Rotation started (mouse) - disabling camera follow');
        if (!this.cameraFollowLocked) {
          this.setCameraFollowEnabled(false);
        }
      } else {
        console.log('[MapView] Rotation started (keyboard) - keeping camera follow enabled');
      }
    });
    
    // Detect pitch start (drag to change pitch/angle)
    this.map.on('pitchstart', () => {
      console.log('[MapView] Pitch started - disabling camera follow');
      if (!this.cameraFollowLocked) {
        this.setCameraFollowEnabled(false);
      }
    });
    
    // Detect zoom start (mouse wheel or pinch) - also handled by wheel event listener below
    // Only disable follow if this is user-initiated (mouse/pinch), not programmatic (keyboard)
    this.map.on('zoomstart', (e: any) => {
      // Check if zoom was initiated by keyboard controls
      // If camera is already zooming via keyboard, don't disable follow
      const isKeyboardZoom = this.camera?.isZooming() ?? false;
      if (!isKeyboardZoom) {
        //console.log('[MapView] Zoom started (mouse/pinch) - disabling camera follow');
        if (!this.cameraFollowLocked) {
          this.setCameraFollowEnabled(false);
        }
      } else {
        console.log('[MapView] Zoom started (keyboard) - keeping camera follow enabled');
      }
    });
    
  }


  /**
   * Creates the player character sprite on the map.
   * Called once when the player spawns. Performs a cinematic zoom-in effect.
   * 
   * Process:
   * 1. Creates character sprite via PlayerDomView (DOM) or PlayerCanvasView (Canvas)
   * 2. Stores initial position/rotation for camera tracking
   * 3. Animates camera zoom-in to player location
   * 4. Ensures sprite is visible and correctly sized
   * 
   * @param coords - Initial player spawn coordinates
   * @param rotation - Initial player rotation (radians, default: 0)
   */
  createPlayerCharacter(coords: { lng: number; lat: number }, rotation: number = 0): void {
    if (this.playerDomView) {
      // DOM path
      this.playerDomView.createPlayerCharacter(coords, rotation);
      this.playerPosition = this.playerDomView.getPlayerPosition();
      this.playerRotation = this.playerDomView.getPlayerRotation();
      this.playerDomView.updateCharacterSize(false);
      this.playerDomView.redraw();
    } else if (this.playerCanvasView) {
      // Canvas path
      this.playerCanvasView.updatePlayerPosition(coords, rotation);
      this.playerPosition = this.playerCanvasView.getPlayerPosition();
      this.playerRotation = this.playerCanvasView.getPlayerRotation();
    } else if (this.playerWebglView) {
      // WebGL path - player position is read from ECS, no initialization needed
      this.playerPosition = coords;
      this.playerRotation = rotation;
    } else {
      return; // No rendering layer initialized
    }

    // Perform camera swoop-in effect
    // Check if map is loaded - if not, wait for load event
    const performSwoop = () => {
      const currentZoom = this.map.getZoom();
      const currentCenter = this.map.getCenter();
      
      // console.log('[MapView] Starting camera swoop:', {
      //   from: { center: [currentCenter.lng, currentCenter.lat], zoom: currentZoom },
      //   to: { center: coords, zoom: 21.5 }
      // });

      // Cinematic zoom-in effect: smoothly animate camera to player location
      // Starts from initial zoom (14) and zooms in to close-up view (21.5)
      // essential: true allows user to interrupt and drag during animation
      this.map.easeTo({
        center: coords, // Center camera on player
        zoom: 21.5, // Target zoom level (very close, street-level view)
        duration: 3000, // Animation duration (3 seconds)
        essential: true // Allow user interaction during animation (user can interrupt)
      } as any);
    };

    // Check if map is already loaded
    if (this.map.loaded()) {
      performSwoop();
    } else {
      // Wait for map to load before performing swoop
      this.map.once('load', () => {
        performSwoop();
      });
    }
  }

  /**
   * Updates the player character's position and rotation on the map.
   * Called each frame to keep the sprite synchronized with game state.
   * 
   * Process:
   * 1. Updates sprite position/rotation via PlayerDomView (DOM) or PlayerCanvasView (Canvas)
   * 2. Stores updated state for camera tracking
   * 
   * Note: Camera follow is handled separately in update() to avoid calling it
   * every frame from render() which causes jitter.
   * 
   * @param coords - New player coordinates
   * @param rotation - New player rotation (radians)
   * @param updateCamera - If true, also update camera to follow player (default: false)
   */
  updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number, updateCamera: boolean = false): void {
    if (this.playerDomView) {
      // DOM path
      this.playerDomView.updatePlayerPosition(coords, rotation);
      this.playerPosition = this.playerDomView.getPlayerPosition();
      this.playerRotation = this.playerDomView.getPlayerRotation();
    } else if (this.playerCanvasView) {
      // Canvas path
      this.playerCanvasView.updatePlayerPosition(coords, rotation);
      this.playerPosition = this.playerCanvasView.getPlayerPosition();
      this.playerRotation = this.playerCanvasView.getPlayerRotation();
    } else if (this.playerWebglView) {
      // WebGL path - player position is read from ECS in render(), just store for camera
      this.playerPosition = coords;
      this.playerRotation = rotation;
    } else {
      return; // No rendering layer initialized
    }
    
    // Only update camera from fixed timestep (update()), not from render() interpolation
    // This prevents jitter from calling easeTo() every frame
    // CameraController.follow() already checks map.isMoving() to avoid interfering with animations
    if (updateCamera && this.cameraFollowEnabled) {
      this.camera?.follow(coords);
    }
  }

  /**
   * Smoothly transition camera to player position (used for possession transfers).
   * Always uses smooth animation regardless of distance.
   */
  public smoothTransitionCameraToPlayer(duration: number = 2000): void {
    if (this.playerPosition && this.camera) {
      this.camera.smoothTransitionTo(this.playerPosition, duration);
    }
  }

  /**
   * Updates movement state and triggers animation switching.
   * PlayerDomView (DOM) or PlayerCanvasView (Canvas) handles the actual logic for switching between idle/walk/run animations.
   */
  private updateMovementState(): void {
    if (this.playerDomView) {
      this.playerDomView.updateMovementState(); // DOM path
    }
    // Canvas and WebGL paths handle animation switching automatically in update() based on input state
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
    if (this.playerDomView) {
      this.playerDomView.update(deltaMs); // DOM path
    }
    if (this.playerCanvasView) {
      this.playerCanvasView.update(deltaMs); // Canvas path
    }
    if (this.playerWebglView) {
      this.playerWebglView.update(deltaMs); // WebGL path
    }

    // If player entity ID is set, read position from ECS
    if (this.playerEid !== null) {
      // Read directly from ECS components
      const lng = Position.x[this.playerEid];
      const lat = Position.y[this.playerEid];
      // Rotation.angle is stored in degrees, convert to radians
      const rotDeg = Rotation.angle[this.playerEid];
      const rot = (rotDeg * Math.PI) / 180;

      // Log position changes (only when significant change detected)
      // if (this.playerPosition && (
      //   Math.abs(lng - this.playerPosition.lng) > 0.000001 ||
      //   Math.abs(lat - this.playerPosition.lat) > 0.000001
      // )) {
      //   console.log('[MapView] Position updated from ECS:', { lng: lng.toFixed(8), lat: lat.toFixed(8), rotDeg });
      // }

      // Update camera bearing for sprite rotation
      const bearing = this.map.getBearing(); // Returns degrees
      if (this.playerDomView) {
        this.playerDomView.setCameraBearing(bearing); // DOM path
      }
      if (this.playerCanvasView) {
        this.playerCanvasView.setCameraBearing(bearing); // Canvas path
      }
      // WebGL path reads bearing directly in render(), no update needed

      // Update player position FIRST so camera.update() uses latest position for zoom/rotation
      // Pass updateCamera=true so camera follows authoritative position (not interpolated)
      this.updatePlayerPosition({ lng, lat }, rot, true);
      
      // Note: prevPosition is NOT updated here - it's updated in render() after interpolation
      // This ensures render() always has the previous fixed-timestep position for interpolation
    }

    // Update camera controller AFTER player position is updated
    // This ensures zoom/rotation use the latest player position, preventing jitter
    if (this.camera) {
      this.camera.update(deltaMs);
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
    // Rotation.angle is stored in degrees, convert to radians
    const currRotDeg = Rotation.angle[this.playerEid];
    const currRot = (currRotDeg * Math.PI) / 180;

    // Update camera bearing for sprite rotation (needs to be updated every frame)
    const bearing = this.map.getBearing(); // Returns degrees
    if (this.playerDomView) {
      this.playerDomView.setCameraBearing(bearing); // DOM path
    }
    if (this.playerCanvasView) {
      this.playerCanvasView.setCameraBearing(bearing); // Canvas path
    }
    // WebGL path reads bearing directly in render(), no update needed

    // Interpolate between previous and current position
    // This provides smooth rendering even if frame rate doesn't match fixed timestep
    const lng = this.prevPosition.lng + (currLng - this.prevPosition.lng) * alpha;
    const lat = this.prevPosition.lat + (currLat - this.prevPosition.lat) * alpha;
    const rot = this.prevRotation + (currRot - this.prevRotation) * alpha;

    // Update sprite with interpolated position (smooth visual update)
    // Don't update camera here - camera follows authoritative position from update()
    // WebGL path reads position directly from ECS in PlayerWebglView.render(), skip interpolation
    if (this.playerWebglView) {
      // WebGL path: PlayerWebglView.render() reads directly from ECS, no interpolation needed
      // Just update stored position for camera tracking
      this.playerPosition = { lng, lat };
      this.playerRotation = rot;
    } else {
      // DOM/Canvas paths: use interpolated position
      this.updatePlayerPosition({ lng, lat }, rot, false);
    }

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
    // Also set in player rendering layer
    if (this.playerCanvasView) {
      this.playerCanvasView.setPlayerEntity(id);
    }
    if (this.playerWebglView) {
      this.playerWebglView.setPlayerEntity(id);
    }
  }

  /**
   * Reset interpolation state to prevent drift when possession transfers.
   * Clears prevPosition so render() skips interpolation on first frame after possession,
   * matching the behavior of initial character creation.
   * 
   * @param position - New position to set (lat/lng)
   * @param rotation - New rotation to set (radians)
   */
  public resetInterpolationState(position: { lng: number; lat: number }, rotation: number): void {
    // Clear prevPosition so render() skips interpolation on first frame after possession
    // This matches the behavior of initial character creation - interpolation starts
    // naturally from the next fixed-timestep position update
    this.prevPosition = null;
    this.prevRotation = rotation;
    this.playerPosition = { ...position };
    this.playerRotation = rotation;
    
    console.log(`[MapView] Reset interpolation state:`, { lng: position.lng.toFixed(8), lat: position.lat.toFixed(8), rot: rotation.toFixed(4) });
  }

  /**
   * Get the current occupant entity ID
   */
  public getCurrentOccupantEid(): number | null {
    return this.playerEid;
  }

  /**
   * Get player rendering layer (for game loop registration)
   * Returns PlayerCanvasView if canvas path is used, null otherwise
   */
  public getPlayerCanvasView(): any {
    return this.playerCanvasView;
  }

  /**
   * Get player WebGL view (for WebGL path)
   */
  public getPlayerWebglView(): PlayerWebglView | null {
    return this.playerWebglView;
  }

  /**
   * Set NPC rendering layer references (called from main.ts after layers are created)
   */
  public setNpcRenderingLayers(layer: any, controller: any): void {
    this.npcLayer = layer;
    this.npcController = controller;
    
    // Initialize PlayerWebglView for WebGL path if needed
    if (PLAYER_RENDER_PATH === 'webgl' && layer && !this.playerWebglView) {
      this.playerWebglView = new PlayerWebglView(this.map, layer);
    }
  }

  /**
   * Set selected NPC entity ID (for red outline)
   */
  public setSelectedNpc(eid: number | null): void {
    console.log('[MapView] setSelectedNpc called with eid:', eid, 'npcLayer:', this.npcLayer);
    // Set selection in NPC rendering layer
    if (this.npcLayer && typeof this.npcLayer.setSelectedNpc === 'function') {
      console.log('[MapView] Calling npcLayer.setSelectedNpc');
      this.npcLayer.setSelectedNpc(eid);
    } else {
      console.warn('[MapView] npcLayer not available or setSelectedNpc not a function', {
        npcLayer: this.npcLayer,
        hasMethod: this.npcLayer && typeof this.npcLayer.setSelectedNpc === 'function'
      });
    }
  }

  /**
   * Set up entity click handler with callbacks
   */
  public setupEntityClickHandler(
    onOccupantClicked: (eid: number, info: EntityInfo) => void,
    onNpcClicked: (eid: number, info: EntityInfo, distanceMeters: number) => void,
    onEmptyClick: () => void
  ): void {
    if (this.entityClickHandler) {
      // Handler already exists, don't create duplicate
      console.warn('[MapView] EntityClickHandler already exists, skipping setup');
      return;
    }
    
    this.entityClickHandler = new EntityClickHandler(
      this.map,
      () => this.getCurrentOccupantEid(),
      onOccupantClicked,
      onNpcClicked,
      onEmptyClick
    );
    
    // Set up hover detection for showing possession range
    this.setupHoverDetection();
  }
  
  /**
   * Set up hover detection to show possession range indicator
   */
  private setupHoverDetection(): void {
    // TODO: Add hover detection for NPCs to show possession range
    // This could highlight NPCs within range or show a range circle
    // For now, this is a placeholder for future implementation
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
    this.camera?.destroy();
  }

  /* ---------------- Camera follow control ---------------- */
  
  /**
   * Sets whether camera should follow the player.
   * @param enabled - Whether camera should follow player
   */
  private setCameraFollowEnabled(enabled: boolean): void {
    this.cameraFollowEnabled = enabled;
    
    // Sync state with CameraController
    this.camera?.setFollowEnabled(enabled);
  }

  /**
   * Toggles camera follow mode and locks it.
   * When locked, camera follow state cannot be auto-changed by dragging or movement.
   * Called by Shift+C keyboard shortcut.
   */
  public toggleCameraFollow(): void {
    this.cameraFollowLocked = !this.cameraFollowLocked;
    this.setCameraFollowEnabled(!this.cameraFollowEnabled);
    console.log('[MapView] Camera follow:', this.cameraFollowEnabled ? 'ENABLED' : 'DISABLED', this.cameraFollowLocked ? '(locked)' : '');
  }
}
