import GameState, { HQType } from "./model/GameState";
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
    controller.updateView();
}

// Set up callbacks for MapView to communicate back to controller
const mapCallbacks: MapViewCallbacks = {
    isPlanting: () => state.plantingType !== null,
    onMapClick: (coords: { lng: number; lat: number }) => {
        if (state.plantingType) {
            plantHQ(coords, state.plantingType);
            state.plantingType = null;
            view.exitPlantingMode();
        }
    }
};

function setupPlantingButton(button: HTMLElement | null, type: HQType) {
    if (!button) return;
    button.addEventListener('click', () => {
        const isAlreadyPlanting = state.plantingType === type;
        
        // Deactivate all buttons first
        view.exitPlantingMode();
        state.plantingType = null;

        if (!isAlreadyPlanting) {
            state.plantingType = type;
            button.classList.add('active');
        }
    });
}

// Wait for map to load before setting up game logic
map.on('load', () => {
    // Set up MapView callbacks
    view.setCallbacks(mapCallbacks);
    
    // Initial view update
    controller.updateView();
    controller.startClock(); // Start the game clock

    setupPlantingButton(view.plantProducerBtn, 'producer');
    setupPlantingButton(view.plantTraffickerBtn, 'trafficker');
    setupPlantingButton(view.plantRetailerBtn, 'retailer');
}); 