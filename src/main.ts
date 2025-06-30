import GameState      from "./model/GameState";
import MapView, { MapViewCallbacks } from "./view/MapView";
import GameController from "./controller/GameController";
import * as turf from "@turf/turf";

const state   = new GameState();
const view    = new MapView('map');
new GameController(state, view);

// Get the map instance from the view
const map = view.mapInstance;

// Visual-only references (MapLibre markers don't belong in pure model)
const hqMarkers: any[] = [];            // array of MapLibre markers for visual reference
const playerFlags: { id: string; lngLat: { lng: number; lat: number } }[] = [];

// All other game state now lives in the state object

// Pull gameplay constants directly from GameState so we have a single source of truth
const {
    INFLUENCE_RADIUS_KM,
    INCOME_PER_RESIDENT_PER_DAY,
    SECONDS_PER_DAY,
    AREA_PER_RESIDENT,
    METERS_PER_FLOOR_DEFAULT,
    MIN_WAGE,
    PERCENT_PER_INCREMENT
} = GameState;

// Initialize state from UI
state.wageOffer = view.getInitialWage();
state.maxGangMembers = state.computeMaxGangMembers();

function updateHud() {
    view.updateHud({
        wageOffer: state.wageOffer,
        maxGangMembers: state.maxGangMembers,
        hqCount: hqMarkers.length,
        totalResidents: state.totalResidents,
        bankBalance: state.bankBalance,
        gameDate: state.gameDate,
        buildingCount: state.controlledBuildingIds.size
    });
}

// Forward declare helper functions that will be defined inside map.on('load')
let updateControlledRoadsFromLocal: (circle: any, coords: any) => void;
let updateControlledBuildingsFromLocal: (circle: any, coords: any) => void;

// Declare plantHQ function before using it in callbacks
function plantHQ(coords: any, buildingFeature: any) {
    if (hqMarkers.length >= state.maxGangMembers) {
        alert('Not enough gang members. Increase wage offer to recruit more.');
        return;
    }
    
    // Create HQ marker using MapView
    const marker = view.createHQMarker(coords, hqMarkers.length + 1);
    hqMarkers.push(marker);
    
    // Add HQ position to state
    state.hqs.push({ lng: coords.lng, lat: coords.lat });

    // 2) Build the circle polygon for this flag
    const center = [coords.lng, coords.lat];
    const radius = INFLUENCE_RADIUS_KM;
    const options = { steps: 64, units: 'kilometers' as const };
    const circle = turf.circle(center, radius, options);

    // 3) Compute the area that is truly new (circle minus current union)
    let incrementalArea;
    if (state.playerUnion) {
        try {
            incrementalArea = turf.difference(circle, state.playerUnion);
        } catch (err) {
            console.warn('turf.difference failed, falling back to full circle', err);
            incrementalArea = circle;
        }
    } else {
        incrementalArea = circle;
    }

    // 4) Update the running union
    state.playerUnion = state.playerUnion ? turf.union(state.playerUnion, circle) : circle;

    // 5) Update influence fill layer to show the full territory
    view.updateInfluenceArea(state.playerUnion);

    // 6) Update controlled roads and buildings using local data
    if (incrementalArea && updateControlledRoadsFromLocal && updateControlledBuildingsFromLocal) {
        updateControlledRoadsFromLocal(circle, coords);
        updateControlledBuildingsFromLocal(circle, coords);
    }
    state.maxGangMembers = state.computeMaxGangMembers();
    updateHud();
}

// Set up callbacks for MapView to communicate back to controller
const mapCallbacks: MapViewCallbacks = {
    isPlantingMode: () => state.isPlanting,
    isBuildingAllowed: (point: [number, number]) => state.buildingAllowed(point),
    onBuildingClick: (coords: { lng: number; lat: number }, buildingFeature: any) => {
        plantHQ(coords, buildingFeature);
        state.isPlanting = false;
        view.exitPlantingMode();
    }
};

// Wait for map to load before setting up game logic
map.on('load', () => {
    // Set up MapView callbacks
    view.setCallbacks(mapCallbacks);
    
    updateHud();

    view.wageSliderElement!.addEventListener('input', () => {
        state.wageOffer = parseInt((view.wageSliderElement as HTMLInputElement).value, 10);
        state.maxGangMembers = state.computeMaxGangMembers();
        updateHud();
        (view.plantHqButton as HTMLButtonElement).disabled = hqMarkers.length >= state.maxGangMembers;
    });

    // Get road and building layers from view
    const roadLayers = view.roadLayers;
    const buildingLayers = view.buildingLayers;

    // --- UI EVENT LISTENERS ---

    view.plantHqButton!.addEventListener('click', () => {
        state.isPlanting = !state.isPlanting;
        view.plantHqButton!.classList.toggle('active', state.isPlanting);
    });

    view.refreshButton!.addEventListener('click', () => {
        // Force a full page reload with a cache-busting query param so tiles and data are re-requested
        const url = window.location.pathname + '?r=' + Date.now();
        window.location.href = url;
    });

    // --- HELPER FUNCTIONS ---
    // Now define the helper functions that were forward declared

    updateControlledRoadsFromLocal = function(circle, coords) {
        // Query roads from local PMTiles using MapLibre's queryRenderedFeatures
        // Get the bounding box of the circle for efficient querying
        const bbox = turf.bbox(circle);
        const sw = map.project([bbox[0], bbox[1]]);
        const ne = map.project([bbox[2], bbox[3]]);
        
        const roadFeatures = map.queryRenderedFeatures([
            [sw.x, ne.y], // top-left
            [ne.x, sw.y]  // bottom-right
        ], {
            layers: roadLayers // Use the road layers we identified earlier
        });

        console.log('Processing', roadFeatures.length, 'local roads...');

        const validRoads = [];
        roadFeatures.forEach(feature => {
            if (!feature.geometry || feature.geometry.type !== 'LineString') return;
            
            // Check if the road intersects with our circle
            try {
                const lineString = turf.lineString(feature.geometry.coordinates);
                const intersects = turf.booleanIntersects(lineString, circle);
                
                if (intersects) {
                    // Clip the road to only the part inside the circle
                    try {
                        const clipped = turf.lineIntersect(lineString, circle);
                        if (clipped.features.length > 0) {
                            validRoads.push(lineString);
                        }
                    } catch (err) {
                        // If clipping fails, just add the whole road if it intersects
                        validRoads.push(lineString);
                    }
                }
            } catch (err) {
                console.warn('Error processing road feature:', err);
            }
        });

        console.log('Highlighted roads:', validRoads.length);
        if (validRoads.length > 0) {
            state.controlledFeatures.push(...validRoads);
            view.updateControlledRoads(state.controlledFeatures);
        }
    }

    updateControlledBuildingsFromLocal = function(circle, coords) {
        // Query buildings from local PMTiles using MapLibre's queryRenderedFeatures
        const bbox = turf.bbox(circle);
        const sw = map.project([bbox[0], bbox[1]]);
        const ne = map.project([bbox[2], bbox[3]]);
        
        const buildingFeatures = map.queryRenderedFeatures([
            [sw.x, ne.y], // top-left
            [ne.x, sw.y]  // bottom-right
        ], {
            layers: buildingLayers // Use building-hit layer
        });

        console.log('Processing', buildingFeatures.length, 'local buildings...');
        let added = false;
        
        buildingFeatures.forEach(f => {
            const id = f.id || (f.properties && f.properties.id) || 
                      `building_${f.geometry.coordinates[0][0]}_${f.geometry.coordinates[0][1]}`;
            
            if (state.controlledBuildingIds.has(id)) return; // already counted
            
            // Check if building is inside the circle
            try {
                const centroid = turf.centroid(f).geometry.coordinates;
                if (!(state.playerUnion && turf.booleanPointInPolygon(turf.point(centroid), state.playerUnion))) {
                    return; // skip if not actually inside
                }

                // Estimate population using the same logic as before
                const area = turf.area(f); // in m^2
                let levels = parseFloat(f.properties["building:levels"] || f.properties.levels);
                if (!levels || isNaN(levels)) {
                    const height = parseFloat(f.properties.height || f.properties.render_height);
                    if (height && !isNaN(height)) {
                        levels = height / METERS_PER_FLOOR_DEFAULT;
                    }
                }
                if (!levels || isNaN(levels)) levels = 2; // fallback
                const pop_est = Math.max(1, Math.round((area * levels) / AREA_PER_RESIDENT));

                // Attach and store
                f.properties = { ...f.properties, pop_est };
                state.controlledBuildingIds.add(id);
                state.controlledBuildingFeatures.push(f);
                state.totalResidents += pop_est;
                added = true;
            } catch (err) {
                console.warn('Error processing building feature:', err);
            }
        });
        
        if (added) {
            view.updateControlledBuildings(state.controlledBuildingFeatures);
            // Recompute max gang members since population changed
            state.maxGangMembers = state.computeMaxGangMembers();
            updateHud();
            // totalResidents can be used in future for income calculations
        }
    }

    // Mouse hover interactions now handled by MapView

    // Update bank balance every real second.
    setInterval(() => {
        const payingResidents = Math.max(0, state.totalResidents - hqMarkers.length);
        const incomePerSecond = (INCOME_PER_RESIDENT_PER_DAY / SECONDS_PER_DAY) * payingResidents;
        const wagesPerSecond = Math.max(0, hqMarkers.length - 1) * state.wageOffer; // first member (player) unpaid
        state.bankBalance += incomePerSecond - wagesPerSecond;
        updateHud();
    }, 1000);

    // Advance game date every game day (now every 1s)
    setInterval(() => {
        // add one day
        state.gameDate.setDate(state.gameDate.getDate() + 1);
        updateHud();
    }, SECONDS_PER_DAY * 1000);
});

// Helper functions moved to GameState.pointsEqual, GameState.dist2, GameState.pointToSegmentDistance 