/**
 * Main Application Entry Point
 * 
 * This file is the bootstrap/wiring layer for the entire game. It:
 * 1. Creates and initializes all core systems (GameState, HUD, Input, MapView, Controller)
 * 2. Sets up communication channels (callbacks) between systems
 * 3. Waits for the map to load, then initializes game entities
 * 4. Starts the game loop and registers all update/render systems
 * 5. Configures NPC simulation (worker or main thread)
 * 6. Sets up rendering layers for NPCs
 * 7. Exposes dev tools for debugging
 * 8. Starts the game clock for timezone-aware time display
 * 
 * Architecture:
 * 
 * This file follows a "wiring" pattern - it doesn't contain business logic,
 * but connects all the pieces together. Business logic lives in:
 * - GameController: Game logic and player movement
 * - GameState: Data model
 * - MapView: Rendering and map interaction
 * 
 * Flow:
 * 
 * 1. Create systems → 2. Wire callbacks → 3. Wait for map → 4. Initialize game → 5. Start loop
 */

import GameState, { HQType } from "./model/GameState";
import MapView, { MapViewCallbacks } from "./view/MapView";
import GameController from "./controller/GameController";
import { world, createPlayerEntity, Position, Rotation } from "./ecs/world";
import { movementSystem } from "./ecs/systems/movementSystem";
import HUDView, { HUDViewCallbacks } from "./view/HUDView";
import InputManager from "./input/InputManager";
import GameLoop from "./loop/GameLoop";
import PerfOverlay from "./debug/PerfOverlay";
import * as turf from "@turf/turf";
import tzLookup from "tz-lookup";          // gives us the lat/lon → TZ function
// (Optional) If other code needs osmtogeojson globally later you can import it:
// import osmtogeojson from 'osmtogeojson';
import { randomWalkSystem } from "./ecs/systems/randomWalkSystem";
import { NpcTag } from "./ecs/components/NpcTag";
import { addComponent, addEntity } from "bitecs";
import { Velocity } from "./ecs/world";
import NpcInstancedLayer from "./view/NpcInstancedLayer";
import { bridge } from "./sim/SimulationBridge";
import { CommandType } from "./sim/Command";
import NpcLayer from "./view/NpcLayer";
import { ENABLE_GLOBE, SHOW_PERF_OVERLAY } from "./config";
import { SpriteRef } from "./ecs/components/SpriteRef";
import NpcController from "./view/NpcController";

/* ───────── Core System Initialization ───────── */

/**
 * Central game state - single source of truth for all game data.
 * Contains player position, HQs, territory, resources, etc.
 */
const state = new GameState();

/**
 * Heads-up display view - manages UI elements and stats display.
 */
const hud = new HUDView();

/**
 * Application-wide input manager.
 * Single instance handles all keyboard/mouse input and distributes it to listeners.
 */
const input = new InputManager();

/**
 * Map view - handles map rendering, camera, and map interactions.
 * Takes the input service so it can handle camera controls.
 */
const view = new MapView('map', input);

/**
 * Player entity ID in the ECS world.
 * Set to -1 initially, will be created once map loads.
 */
let playerEid: number = -1;

/**
 * Game controller - handles game logic, player movement, and game state updates.
 * Takes state and view so it can read/write state and update the view.
 */
const controller = new GameController(state, view);

/**
 * MapLibre GL map instance.
 * Extracted from MapView for direct access when needed.
 */
const map = view.mapInstance;

/**
 * Visual marker references for placed HQs.
 * These are MapLibre markers (view-layer objects) and don't belong in the model.
 * Kept here for potential cleanup/management, though currently not used elsewhere.
 */
const hqMarkers: any[] = [];

/**
 * Gameplay constant: influence radius for each HQ in kilometers.
 * Extracted from GameState for use in HQ placement logic.
 */
const { INFLUENCE_RADIUS_KM } = GameState;

/* ───────── HQ Placement Logic ───────── */

/**
 * Places a new headquarters at the specified coordinates.
 * 
 * This function handles the complete HQ placement process:
 * 1. Creates visual marker on the map
 * 2. Adds HQ to game state
 * 3. Calculates influence area using Turf.js
 * 4. Merges new area with existing territory
 * 5. Updates visual territory overlay
 * 6. Updates HUD stats
 * 
 * Note: This business logic could be moved to GameController for better
 * separation of concerns, but keeping it here for now as it's closely
 * tied to the callback setup.
 * 
 * @param coords - Longitude and latitude where HQ should be placed
 * @param type - Type of HQ (producer, trafficker, or retailer)
 */
function plantHQ(coords: { lng: number; lat: number }, type: HQType) {
    // Create visual marker on the map
    const marker = view.createHQMarker(coords, type);
    hqMarkers.push(marker);
    
    // Add HQ to game state
    const hqId = `hq_${Date.now()}`;
    state.hqs.push({ id: hqId, lng: coords.lng, lat: coords.lat, type });

    // Calculate influence area as a circle using Turf.js
    const center = [coords.lng, coords.lat];
    const radius = INFLUENCE_RADIUS_KM;
    const options = { steps: 64, units: 'kilometers' as const };  // 64 steps = smooth circle
    const circle = turf.circle(center, radius, options);

    // Merge new circle with existing territory
    if (state.playerUnion) {
        try {
            // Convert existing territory to Turf feature and merge with new circle
            const playerUnionFeature = turf.feature(state.playerUnion);
            const fc = turf.featureCollection([playerUnionFeature, circle]);
            state.playerUnion = turf.union(fc)!.geometry as any;
        } catch (e) {
            // If union fails (e.g., invalid geometry), fall back to just the new circle
            console.warn('turf.union failed', e);
            state.playerUnion = circle.geometry;
        }
    } else {
        // First HQ - just use the circle as the initial territory
        state.playerUnion = circle.geometry;
    }

    // Update visual territory overlay on the map
    view.updateInfluenceArea(state.playerUnion);
    // Update HUD with new stats
    hud.updateStats(state.hqs.length, state.commodities, state.money);
}

/* ───────── Callback Setup - System Communication ───────── */

/**
 * Callbacks for MapView to communicate user interactions back to the game logic.
 * 
 * These callbacks are called by MapView when:
 * - User clicks on the map (for HQ placement)
 * - MapView needs to check if we're in planting mode
 */
const mapCallbacks: MapViewCallbacks = {
    /**
     * Check if player is currently in HQ placement mode.
     * Used by MapView to change cursor and enable click handling.
     */
    isPlanting: () => state.plantingType !== null,
    
    /**
     * Handle map click for HQ placement.
     * Validates placement rules based on HQ type and map features.
     * 
     * Placement Rules:
     * - Producer: Can be placed anywhere
     * - Retailer: Must be placed on a building
     * - Trafficker: Must be placed on a road or river (transport feature)
     * 
     * @param coords - Click coordinates (longitude, latitude)
     * @param features - Map features at click location (building, transport)
     */
    onMapClick: (coords: { lng: number; lat: number }, features: { building?: any, transport?: any }) => {
        if (!state.plantingType) return;

        // Retailers must be placed on a building
        if (state.plantingType === 'retailer' && !features.building) {
            return;
        }

        // Traffickers must be placed on a road or river
        if (state.plantingType === 'trafficker' && !features.transport) {
            return;
        }
        
        // Placement is valid - create the HQ
        plantHQ(coords, state.plantingType);
        // Exit planting mode
        state.plantingType = null;
        hud.exitPlantingMode();
    }
};

/**
 * Input callbacks - connect input manager to game controller.
 * 
 * The input manager captures keyboard events and distributes them to registered callbacks.
 * Here we connect player input to the controller, and camera controls to MapView
 * (though camera controls are currently empty - handled internally by MapView).
 */
input.addCallbacks({
    /** Forward player input (WASD, arrows) to controller for movement */
    onPlayerInput: (inp) => controller.handlePlayerInput(inp),
    /** Camera zoom controls (currently unused - handled by MapView internally) */
    onCameraZoomHold: () => {},
    onCameraZoomRelease: () => {},
    /** Camera rotation controls (currently unused - handled by MapView internally) */
    onCameraRotateHold: () => {},
    onCameraRotateRelease: () => {}
});

/**
 * HUD callbacks - connect UI buttons to game state.
 * 
 * When user clicks a planting button in the HUD, these callbacks:
 * 1. Set the planting type in game state
 * 2. Update button visual state (active/inactive)
 */
hud.setCallbacks({
  /** User clicked "Plant Producer" button */
  onPlantProducer: () => {
    state.plantingType = 'producer';
    hud.setPlantingButtonActive('producer');
  },
  /** User clicked "Plant Trafficker" button */
  onPlantTrafficker: () => {
    state.plantingType = 'trafficker';
    hud.setPlantingButtonActive('trafficker');
  },
  /** User clicked "Plant Retailer" button */
  onPlantRetailer: () => {
    state.plantingType = 'retailer';
    hud.setPlantingButtonActive('retailer');
  },
});

/* ───────── Game Initialization (After Map Loads) ───────── */

/**
 * Wait for map to load before setting up game logic.
 * 
 * MapLibre needs to finish loading tiles and initializing before we can:
 * - Create entities and render them
 * - Set up callbacks
 * - Start the game loop
 * 
 * This callback runs once when the map is fully loaded and ready.
 */
map.on('load', () => {
    /* ---------------- Callback Setup ---------------- */
    
    /**
     * Connect MapView callbacks so it can communicate user interactions.
     * This enables HQ placement when user clicks the map.
     */
    view.setCallbacks(mapCallbacks);
    
    /* ---------------- Player Entity Creation ---------------- */
    
    /**
     * Create the player entity in the ECS world.
     * The player is represented both in ECS (for simulation) and as a visual sprite.
     */
    playerEid = createPlayerEntity(state.player.lng, state.player.lat, state.player.rotation);
    
    /**
     * Register player entity with controller and view.
     * Controller needs it for movement updates, view needs it for rendering.
     */
    controller.setPlayerEntity(playerEid);
    view.setPlayerEntity(playerEid);

    /**
     * Initialize simulation bridge with player position.
     * This keeps the bridge snapshot in sync when running on main thread,
     * and provides initial position when starting worker mode.
     */
    bridge.updateFromMainThread(Position.x[playerEid], Position.y[playerEid], Rotation.angle[playerEid]);

    /**
     * Create the visual representation of the player character.
     * This creates the sprite and adds it to the map.
     */
    view.createPlayerCharacter(
        { lng: Position.x[playerEid], lat: Position.y[playerEid] }, 
        Rotation.angle[playerEid]
    );
    
    /**
     * Initial HUD update with starting stats.
     * Displays initial HQ count (0), commodities (0), and money (1000).
     */
    hud.updateStats(state.hqs.length, state.commodities, state.money);

    /* ---------------- Game Loop Setup ---------------- */
    
    /**
     * Create and configure the main game loop.
     * The loop will drive all updates and rendering.
     */
    const loop = new GameLoop();
    
    /**
     * Register game controller for fixed-timestep updates.
     * Controller handles game logic, player movement, and game clock.
     */
    loop.addFixed(controller);
    
    /**
     * Parse URL parameters for configuration.
     * Allows testing different scenarios via URL:
     * - ?npc=100 - Spawn 100 NPCs
     * - ?worker=1 - Enable Web Worker simulation
     */
    const params = new URLSearchParams(location.search);
    const npcCount = Number(params.get('npc') || '0');
    const workerEnabled = params.get('worker') === '1';

    /* ---------------- NPC Simulation Setup ---------------- */
    
    /**
     * Start NPC simulation in worker or main thread.
     * 
     * Worker mode (workerEnabled = true):
     * - Simulation runs in separate thread for better performance
     * - Uses SharedArrayBuffer for fast data transfer
     * - Can handle thousands of NPCs without blocking UI
     * 
     * Main thread mode (workerEnabled = false):
     * - Simulation runs on main thread (fallback)
     * - Simpler but can cause UI lag with many NPCs
     */
    bridge.startInWorker(
        workerEnabled,
        npcCount,
        { lng: Position.x[playerEid], lat: Position.y[playerEid], rot: Rotation.angle[playerEid] }
    );

    /**
     * Fallback: If worker is disabled, spawn NPCs on main thread.
     * 
     * This creates NPCs directly in the main ECS world and registers
     * an ECS runner to update them each frame.
     */
    if (!workerEnabled) {
        /**
         * Spawn radius in degrees (approximately 111 meters at equator).
         * NPCs spawn in a circle around the player's starting position.
         */
        const R = 0.001;
        
        /**
         * Create NPC entities in the ECS world.
         * Each NPC gets Position, Rotation, Velocity, NpcTag, and SpriteRef components.
         */
        for (let i = 0; i < npcCount; i++) {
            // Random angle and distance for circular distribution
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * R;
            const lng = state.player.lng + Math.cos(angle) * dist;
            const lat = state.player.lat + Math.sin(angle) * dist;
            
            // Create entity and add components
            const eid = addEntity(world);
            addComponent(world, Position, eid);
            addComponent(world, Rotation, eid);
            addComponent(world, Velocity, eid);
            addComponent(world, NpcTag, eid);
            addComponent(world, SpriteRef, eid);
            
            // Set initial values
            Position.x[eid] = lng;
            Position.y[eid] = lat;
            Rotation.angle[eid] = 0;
            Velocity.x[eid] = 0;
            Velocity.y[eid] = 0;
            SpriteRef.id[eid] = 0;
        }

        /**
         * ECS runner for main-thread NPC simulation.
         * Runs randomWalkSystem and movementSystem each fixed update.
         */
        const ecsRunner = {
            fixedUpdate: () => {
                randomWalkSystem();  // Sets NPC walking directions
                movementSystem();    // Applies velocity to position
            },
        } as any;
        loop.addFixed(ecsRunner);
    }

    /* ---------------- Rendering Setup ---------------- */
    
    /**
     * Register MapView for variable-delta updates and rendering.
     * 
     * Variable updates: Needed for animations (sprite frame updates, camera smoothing)
     * Render interpolation: Needed for smooth visual updates between fixed timesteps
     */
    loop.add(view);
    loop.addRenderable(view);

    /**
     * Set up NPC rendering based on projection mode.
     * 
     * Mercator projection (ENABLE_GLOBE = false):
     * - Uses fast WebGL instanced rendering (NpcInstancedLayer)
     * - NpcController handles interpolation and data management
     * 
     * Globe projection (ENABLE_GLOBE = true):
     * - Falls back to Canvas overlay (NpcLayer)
     * - Uses map.project() for coordinate conversion
     */
    if (npcCount > 0) {
        if (!ENABLE_GLOBE) {
            /**
             * WebGL instanced rendering path (fast, Mercator only).
             * Creates a custom MapLibre layer that renders NPCs using WebGL.
             */
            const npcGlLayer = new NpcInstancedLayer();
            map.addLayer(npcGlLayer as any);

            /**
             * NPC controller handles interpolation and data management.
             * Reads NPC positions from simulation bridge and passes interpolated
             * screen coordinates to the rendering layer.
             */
            const npcController = new NpcController(map, npcGlLayer);
            loop.addRenderable(npcController);

        } else {
            /**
             * Canvas overlay fallback (works with any projection).
             * Uses map.project() to convert lat/lng to screen coordinates.
             * Slower than WebGL but more flexible.
             */
            const npcCanvasLayer = new NpcLayer(map);
            loop.addRenderable(npcCanvasLayer);
        }
    }

    /**
     * Add performance overlay if enabled in config.
     * Displays FPS, frame time, and CPU usage for debugging.
     */
    if (SHOW_PERF_OVERLAY) {
        const overlay = new PerfOverlay();
        loop.add(overlay);
    }
    
    /**
     * Start the game loop.
     * This begins the requestAnimationFrame loop and starts the game.
     */
    loop.start();

    /* ---------------- Development Tools ---------------- */
    
    /**
     * Expose game loop and state to browser console for debugging.
     * 
     * Usage in console:
     * - window.loop - Access game loop (pause, resume, etc.)
     * - window.state - Access game state (hqs, money, etc.)
     * - window.spawnNpc() - Spawn an NPC at current map center
     */
    (window as any).loop = loop;
    (window as any).state = state;

    /**
     * Dev helper function: spawn an NPC at specified or current map center.
     * 
     * Usage:
     * - spawnNpc() - Spawn at current map center
     * - spawnNpc(-74.0, 40.7) - Spawn at specific coordinates
     * 
     * @param lng - Optional longitude (uses map center if not provided)
     * @param lat - Optional latitude (uses map center if not provided)
     */
    (window as any).spawnNpc = (lng?: number, lat?: number) => {
        const center = lng !== undefined && lat !== undefined ? {lng, lat} : map.getCenter();
        // Scale coordinates by 1e7 for integer precision in command buffer
        bridge.enqueueCommand(CommandType.SpawnNpc, Math.round(center.lng * 1e7), Math.round(center.lat * 1e7), 0);
    };

    // (Hot-reload functionality intentionally omitted.)

    /* ---------------- Game Clock ---------------- */
    
    /**
     * Game clock update loop.
     * 
     * Every second:
     * 1. Get the current map center (longitude, latitude)
     * 2. Look up the timezone for that location
     * 3. Update HUD with game time displayed in that timezone
     * 
     * This provides a realistic "world clock" effect where the displayed
     * time changes as you pan around the globe.
     */
    setInterval(() => {
        const centre = map.getCenter();        // { lng, lat }
        let zone: string;
        try {
            // Look up timezone for current map center
            zone = tzLookup(centre.lat, centre.lng);
        } catch (_) {
            // Fallback to UTC if lookup fails
            zone = 'UTC';
        }
        // Update HUD with game time in the local timezone
        hud.updateTimeDisplays(state.gameDate, zone);
    }, 1000);
});