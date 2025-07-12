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
import NpcLayer from "./view/NpcLayer";


const state = new GameState();
const hud = new HUDView();

// Single, application-wide input service
const input = new InputManager();

const view = new MapView('map', input);
// Player entity will be created once map is ready; placeholder id -1 for now
let playerEid: number = -1;

const controller = new GameController(state, view);

// Get the map instance from the view
const map = view.mapInstance;

// Visual-only references (MapLibre markers don't belong in pure model)
const hqMarkers: any[] = [];

// Pull gameplay constants directly from GameState
const { INFLUENCE_RADIUS_KM } = GameState;

// Declare plantHQ function before using it in callbacks
function plantHQ(coords: { lng: number; lat: number }, type: HQType) {
    const marker = view.createHQMarker(coords, type);
    hqMarkers.push(marker);
    
    const hqId = `hq_${Date.now()}`;
    state.hqs.push({ id: hqId, lng: coords.lng, lat: coords.lat, type });

    const center = [coords.lng, coords.lat];
    const radius = INFLUENCE_RADIUS_KM;
    const options = { steps: 64, units: 'kilometers' as const };
    const circle = turf.circle(center, radius, options);

    if (state.playerUnion) {
        try {
            const playerUnionFeature = turf.feature(state.playerUnion);
            const fc = turf.featureCollection([playerUnionFeature, circle]);
            state.playerUnion = turf.union(fc)!.geometry as any;
        } catch (e) {
            console.warn('turf.union failed', e);
            state.playerUnion = circle.geometry;
        }
    } else {
        state.playerUnion = circle.geometry;
    }

    view.updateInfluenceArea(state.playerUnion);
    hud.updateStats(state.hqs.length, state.commodities, state.money);
}

// Set up callbacks for MapView to communicate back to controller
const mapCallbacks: MapViewCallbacks = {
    isPlanting: () => state.plantingType !== null,
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
        
        plantHQ(coords, state.plantingType);
        state.plantingType = null;
        hud.exitPlantingMode();
    }
};

// Controller listens directly to input service
input.addCallbacks({
    onPlayerInput: (inp) => controller.handlePlayerInput(inp),
    onCameraZoomHold: () => {},
    onCameraZoomRelease: () => {},
    onCameraRotateHold: () => {},
    onCameraRotateRelease: () => {}
});

// Set up HUD callbacks
hud.setCallbacks({
  onPlantProducer: () => {
    // Set planting mode, update button states, etc.
    state.plantingType = 'producer';
    hud.setPlantingButtonActive('producer');
  },
  onPlantTrafficker: () => {
    state.plantingType = 'trafficker';
    hud.setPlantingButtonActive('trafficker');
  },
  onPlantRetailer: () => {
    state.plantingType = 'retailer';
    hud.setPlantingButtonActive('retailer');
  },
});

// Wait for map to load before setting up game logic
map.on('load', () => {
    // Set up MapView callbacks
    view.setCallbacks(mapCallbacks);
    
    // Create ECS entity for player and corresponding sprite
    playerEid = createPlayerEntity(state.player.lng, state.player.lat, state.player.rotation);
    controller.setPlayerEntity(playerEid);
    view.setPlayerEntity(playerEid);

    view.createPlayerCharacter(
        { lng: Position.x[playerEid], lat: Position.y[playerEid] }, 
        Rotation.angle[playerEid]
    );
    
    // Initial view update
    hud.updateStats(state.hqs.length, state.commodities, state.money);

    // Start the rAF-driven game loop
    const loop = new GameLoop();
    loop.addFixed(controller);
    const npcCount = Number(new URLSearchParams(location.search).get('npc') || '0');
    const R = 0.001; // degrees
    for (let i=0;i<npcCount;i++) {
         const angle = Math.random()*Math.PI*2;
         const dist = Math.random()*R;
         const lng = state.player.lng + Math.cos(angle)*dist;
         const lat = state.player.lat + Math.sin(angle)*dist;
         const eid = addEntity(world);
         addComponent(world, Position, eid);
         addComponent(world, Rotation, eid);
         addComponent(world, Velocity, eid);
         addComponent(world, NpcTag, eid);
         Position.x[eid] = lng; Position.y[eid] = lat;
         Rotation.angle[eid] = 0;
         Velocity.x[eid] = 0; Velocity.y[eid] = 0;
    }
    const ecsRunner = { fixedUpdate: () => { randomWalkSystem(); movementSystem(); } } as any;
    loop.addFixed(ecsRunner);
    loop.add(view);           // still needs variable delta for animations
    loop.addRenderable(view);

    if (npcCount>0) {
        const npcLayer = new NpcLayer(map);
        loop.addRenderable(npcLayer);
    }

    const overlay = new PerfOverlay();
    loop.add(overlay);
    loop.start();

    // Expose for dev console (small dev aid)
    (window as any).loop = loop;

        /* ──────────────────────────────────────────────────────────
       Game clock: every second, get the game date, work out which 
       time-zone the current map centre sits in, and update the HUD.
       ────────────────────────────────────────────────────────── */
    setInterval(() => {
        const centre = map.getCenter();        // { lng, lat }
        let zone: string;
        try {
            zone = tzLookup(centre.lat, centre.lng);
        } catch (_) {
            zone = 'UTC';                      // fallback
        }
        hud.updateTimeDisplays(state.gameDate, zone);
    }, 1000);
});