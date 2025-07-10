import GameState, { HQType } from "./model/GameState";
import MapView, { MapViewCallbacks } from "./view/MapView";
import GameController from "./controller/GameController";
import HUDView, { HUDCallbacks } from "./view/HUDView";
import * as turf from "@turf/turf";

const state = new GameState();
const hud = new HUDView();
const view = new MapView('map');
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
    hud.updateStats(state.hqs.length, state.commodities, state.money, state.gameDate);
}

// Set up callbacks for MapView to communicate back to controller
const mapCallbacks: MapViewCallbacks = {
    isPlanting: () => state.plantingType !== null,
    onMapClick: (coords: { lng: number; lat: number }, features: { building?: any, transport?: any }) => {
        if (!state.plantingType) return;

        // Retailers must be placed on a building
        if (state.plantingType === 'retailer' && !features.building) {
            // console.log("Retailers must be placed on a building.");
            return;
        }

        // Traffickers must be placed on a road or river
        if (state.plantingType === 'trafficker' && !features.transport) {
            // console.log("Traffickers must be placed on a road or river.");
            return;
        }
        
        plantHQ(coords, state.plantingType);
        state.plantingType = null;
        hud.exitPlantingMode();
    },
    onPlayerInput: (input) => {
        controller.handlePlayerInput(input);
    }
};

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
  onToggleMovementMode: () => {
    controller.toggleMovementMode();
    hud.updateMovementModeButton(controller.isInFreeRotationMode());
  }
});

// Wait for map to load before setting up game logic
map.on('load', () => {
    // Set up MapView callbacks
    view.setCallbacks(mapCallbacks);
    
    // Create player character at the player's starting position
    view.createPlayerCharacter(
        { lng: state.player.lng, lat: state.player.lat }, 
        state.player.rotation
    );
    
    // Initial view update
    hud.updateStats(state.hqs.length, state.commodities, state.money, state.gameDate);
    controller.startClock(); // Start the game clock
    controller.startMovementLoop(); // Start the movement update loop
    
    // Setup movement mode toggle button
    hud.updateMovementModeButton(controller.isInFreeRotationMode());
});