/**
 * Main Application Entry Point
 * 
 * This file is the bootstrap/wiring layer for the entire game. It:
 * 1. Creates and initializes all core systems (GameState, HUD, Input, MapView, Controller)
 * 2. Sets up communication channels (callbacks) between systems
 * 3. Waits for the map to load, then initializes game entities
 * 4. Starts the game loop and registers all update/render systems
 * 5. Configures NPC simulation (main thread)
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

import { GameState, InputState } from "@shared/realearthstreetwar";
import MapView from "./view/MapView";
import GameController from "./controller/GameController";
import { world, Position, Rotation } from "./ecs/world";
import HUDView from "./view/HUDView";
import InputManager from "./input/InputManager";
import GameLoop from "./loop/GameLoop";
import PerfOverlay from "./debug/PerfOverlay";
import tzLookup from "tz-lookup";          // gives us the lat/lon → TZ function
// (Optional) If other code needs osmtogeojson globally later you can import it:
// import osmtogeojson from 'osmtogeojson';
import NpcInstancedLayer from "./view/NpcInstancedLayer";
import NpcLayer from "./view/NpcLayer";
import { ENABLE_GLOBE, SHOW_PERF_OVERLAY } from "./config";
import NpcController from "./view/NpcController";
import { GameClient } from "./network/GameClient";
import { SERVER_URL } from "./config";
import { EntityInfo } from "./view/EntityClickHandler";

/* ───────── Core System Initialization ───────── */

/**
 * Central game state - stores non-entity game data (like game time).
 * Entity state (player/NPC positions, rotations) is stored in ECS world.
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
 * Game controller - handles game logic, player movement, and game state updates.
 * Takes state and view so it can read/write state and update the view.
 */
const controller = new GameController(state, view);

/**
 * MapLibre GL map instance.
 * Extracted from MapView for direct access when needed.
 */
const map = view.mapInstance;

/* ───────── Network Client Setup ---------------- */

/**
 * Network client for server communication.
 * Handles WebSocket connection, sends input, receives state snapshots.
 */
const gameClient = new GameClient(SERVER_URL);

gameClient.setCallbacks({
    onConnected: () => {
        console.log('[Client] Connected to server');
    },
    onDisconnected: () => {
        console.log('[Client] Disconnected from server');
    },
    onStateSnapshot: (snapshot) => {
        // Apply server state to local game state and ECS
        controller.applyServerState(snapshot);
    },
    onError: (error) => {
        console.error('[Client] Network error:', error);
    },
});

// Set player ID in NetworkStateManager when received from server
// This allows matching the correct player snapshot after possession
gameClient.setCallbacks({
    onPlayerIdReceived: (playerId: string) => {
        controller.getNetworkStateManager().setPlayerId(playerId);
    },
});

// Set GameClient reference in controller for sending possession requests
controller.setGameClient(gameClient);

// Connect to server
gameClient.connect();

/**
 * Input callbacks - connect input manager to game controller and network client.
 * 
 * The input manager captures keyboard events and distributes them to registered callbacks.
 * Input is sent to server for authoritative processing.
 */
input.addCallbacks({
    /** Forward player input (WASD, arrows) to controller and server */
    onPlayerInput: (inp: InputState) => {
        controller.handlePlayerInput(inp);
        
        // Send input to server
        if (gameClient.isConnected()) {
            // Only log if there's actual movement input
            if (inp.forward || inp.backward || inp.left || inp.right || inp.rotateLeft || inp.rotateRight) {
                //console.log('[Input] Sending to server:', { forward: inp.forward, backward: inp.backward, left: inp.left, right: inp.right });
            }
            gameClient.sendInput(inp);
        }
    },
    /** Camera zoom controls (currently unused - handled by MapView internally) */
    onCameraZoomHold: () => {},
    onCameraZoomRelease: () => {},
    /** Camera rotation controls (currently unused - handled by MapView internally) */
    onCameraRotateHold: () => {},
    onCameraRotateRelease: () => {}
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
    
    
    /* ---------------- Player Entity Creation ---------------- */
    
    /**
     * With network enabled, player entity is created by NetworkStateManager
     * when the first state snapshot arrives from the server.
     * View will be updated in the state snapshot callback.
     */
    // Player entity will be created when server sends first snapshot
    // View will be updated in the state snapshot callback
    

    /* ---------------- Entity Click Handler Setup ---------------- */
    
    /**
     * Set up entity click handler with callbacks from controller.
     * This enables clicking on occupant or NPCs to show info panels.
     */
    view.setupEntityClickHandler(
      (eid: number, info: EntityInfo) => controller.handleOccupantClicked(eid, info),
      (eid: number, info: EntityInfo, distanceMeters: number) => controller.handleNpcClicked(eid, info, distanceMeters),
      () => controller.handleEmptyClick()
    );

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
    
    /* ---------------- NPC Rendering Setup ---------------- */
    
    /**
     * NPCs are spawned automatically by the server at startup.
     * Client only needs to set up rendering layers to display NPCs from server snapshots.
     */

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
     * Register HUDView for variable-delta updates.
     * Updates time display every frame for smooth progression.
     */
    hud.setMapInstance(map);
    hud.setGameState(state);
    controller.setHUDView(hud); // Wire up HUD callbacks
    loop.add(hud);

    /**
     * Set up NPC rendering based on projection mode.
     * 
     * NPCs are spawned by the server and arrive via state snapshots.
     * Rendering layers are always initialized to display NPCs when they arrive.
     * 
     * Mercator projection (ENABLE_GLOBE = false):
     * - Uses fast WebGL instanced rendering (NpcInstancedLayer)
     * - NpcController handles interpolation and data management
     * 
     * Globe projection (ENABLE_GLOBE = true):
     * - Falls back to Canvas overlay (NpcLayer)
     * - Uses map.project() for coordinate conversion
     */
    if (!ENABLE_GLOBE) {
        /**
         * WebGL instanced rendering path (fast, Mercator only).
         * Creates a custom MapLibre layer that renders NPCs using WebGL.
         */
        const npcGlLayer = new NpcInstancedLayer();
        map.addLayer(npcGlLayer as any);

        /**
         * NPC controller handles interpolation and data management.
         * Reads NPC positions from ECS and passes interpolated
         * screen coordinates to the rendering layer.
         */
        const npcController = new NpcController(map, npcGlLayer);
        loop.addRenderable(npcController);
        
        // Store references for selection feedback
        view.setNpcRenderingLayers(npcGlLayer, npcController);

    } else {
        /**
         * Canvas overlay fallback (works with any projection).
         * Uses map.project() to convert lat/lng to screen coordinates.
         * Slower than WebGL but more flexible.
         */
        const npcCanvasLayer = new NpcLayer(map);
        loop.add(npcCanvasLayer); // Register as Updatable for animation frame advancement
        loop.addRenderable(npcCanvasLayer); // Register as Renderable for rendering
        
        // Store reference for selection feedback
        view.setNpcRenderingLayers(npcCanvasLayer, null);
        
        // Wire up NPC speed updates for animation scaling
        controller.getNetworkStateManager().setNpcLayer(npcCanvasLayer);
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
     * - window.state - Access game state
     * - window.spawnNpc() - Spawn an NPC at current map center
     */
    (window as any).loop = loop;
    (window as any).state = state;

    /**
     * Dev helper function: request server to spawn an NPC.
     * 
     * Usage:
     * - spawnNpc() - Request server to spawn 1 NPC
     * - spawnNpc(10) - Request server to spawn 10 NPCs
     * 
     * Note: Server controls NPC spawning. This is just a convenience function for testing.
     * 
     * @param count - Number of NPCs to spawn (default: 1)
     */
    (window as any).spawnNpc = (count: number = 1) => {
        if (gameClient && gameClient.isConnected()) {
            gameClient.sendMessage({ type: 'spawn_npc', count });
            console.log(`[Dev] Requested server to spawn ${count} NPC(s)`);
        } else {
            console.warn('[Dev] Cannot spawn NPCs - not connected to server');
        }
    };

    // (Hot-reload functionality intentionally omitted.)

    /* ---------------- Game Clock ---------------- */
    
    /**
     * Game clock is now updated every frame via HUDView.update() for smooth progression.
     * The HUDView implements Updatable and is registered in the game loop above.
     */
});