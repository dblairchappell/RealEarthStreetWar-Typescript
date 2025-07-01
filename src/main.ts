import GameState from "./model/GameState";
import MapView, { MapViewCallbacks } from "./view/MapView";
import GameController from "./controller/GameController";
import * as turf from "@turf/turf";

const state = new GameState();
const view = new MapView('map');
const controller = new GameController(state, view);

// Get the map instance from the view
const map = view.mapInstance;

// Visual-only references (MapLibre markers don't belong in pure model)
const hqMarkers: any[] = [];

// Pull gameplay constants directly from GameState
const { INFLUENCE_RADIUS_KM } = GameState;

// Declare plantHQ function before using it in callbacks
function plantHQ(coords: { lng: number; lat: number }) {
    // Create HQ marker using MapView
    const marker = view.createHQMarker(coords, hqMarkers.length + 1);
    hqMarkers.push(marker);
    
    // Add HQ position to state
    state.hqs.push({ lng: coords.lng, lat: coords.lat });

    // Build the circle polygon for this HQ
    const center = [coords.lng, coords.lat];
    const radius = INFLUENCE_RADIUS_KM;
    const options = { steps: 64, units: 'kilometers' as const };
    const circle = turf.circle(center, radius, options);

    // Update the running union of all territories
    if (state.playerUnion) {
        try {
            const playerUnionFeature = turf.feature(state.playerUnion);
            const fc = turf.featureCollection([playerUnionFeature, circle]);
            const unionResult = (turf as any).union(fc);
            state.playerUnion = unionResult ? unionResult.geometry : circle.geometry;
        } catch (e) {
            console.warn('turf.union failed, falling back to simple combine', e);
            state.playerUnion = circle.geometry;
        }
    } else {
        state.playerUnion = circle.geometry;
    }

    // Update influence fill layer to show the full territory
    view.updateInfluenceArea(state.playerUnion);
    
    // Update HQ count
    controller.updateView();
}

// Set up callbacks for MapView to communicate back to controller
const mapCallbacks: MapViewCallbacks = {
    isPlantingMode: () => state.isPlanting,
    onBuildingClick: (coords: { lng: number; lat: number }) => {
        plantHQ(coords);
        state.isPlanting = false;
        view.exitPlantingMode();
    }
};

// Wait for map to load before setting up game logic
map.on('load', () => {
    // Set up MapView callbacks
    view.setCallbacks(mapCallbacks);
    
    // Initial view update
    controller.updateView();

    // Plant HQ button event listener
    view.plantHqButton!.addEventListener('click', () => {
        state.isPlanting = !state.isPlanting;
        view.plantHqButton!.classList.toggle('active', state.isPlanting);
    });
}); 