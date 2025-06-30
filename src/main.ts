import GameState      from "./model/GameState";
import MapView        from "./view/MapView";
import GameController from "./controller/GameController";
import * as turf from "@turf/turf";

const state   = new GameState();
const view    = new MapView();
new GameController(state, view);

// Real-Earth Street War - Fully Offline Game Logic
// Uses local PMTiles data for all map features and territory control

// Set up PMTiles protocol for loading .pmtiles files
let protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// MapLibre GL JS doesn't require an access token for open data sources
const map = new maplibregl.Map({
    container: 'map', // container ID
    // Using complete offline style with local PMTiles data, fonts, and no sprites
    style: 'offline-map-style.json',
    center: [-74.5, 40], // starting position [lng, lat]
    zoom: 13, // start a bit closer to see details
    pitch: 60, // tilt for 3-D perspective
    bearing: -20, // slight rotation for depth perception
    antialias: true // smoother edges on extrusions
});

// Handle missing images and fonts gracefully
map.on('styleimagemissing', (e) => {
    // Create a dummy-placeholder image for any missing icons
    const width = 1;
    const height = 1;
    const data = new Uint8Array([0, 0, 0, 0]);
    if (!map.hasImage(e.id)) {
        map.addImage(e.id, { width, height, data });
    }
});

map.on('error', (e) => {
    // Suppress harmless tile loading errors
    if (e.error?.message === 'Failed to fetch' && e.source?.url?.includes('pmtiles://')) {
        console.warn('Tile not available (normal for PMTiles):', e.tile);
        return;
    }
    console.error('Map error:', e);
});

map.on('load', () => {
    // Find a reliable anchor layer from the style to insert our custom layers before.
    const allMapLayers = map.getStyle().layers;
    let anchorLayerId;
    const topLabelLayerIds = ['place-labels-major', 'road-labels', 'water-labels'];
    for (const id of topLabelLayerIds) {
        if (allMapLayers.some(l => l.id.startsWith(id))) {
            anchorLayerId = allMapLayers.find(l => l.id.startsWith(id)).id;
            break;
        }
    }
    if (!anchorLayerId) {
        const firstSymbol = allMapLayers.find(l => l.type === 'symbol');
        anchorLayerId = firstSymbol ? firstSymbol.id : undefined;
    }
    console.log(`Using anchor layer for custom layers: ${anchorLayerId}`);

    // Buildings are already included in the offline map style
    // The offline style uses nj-complete source, so we don't need to add building layers

    const infoPanel = document.getElementById('info-panel');
    const roadNameEl = document.getElementById('road-name');
    const roadTypeEl = document.getElementById('road-type');
    const roadIdEl = document.getElementById('road-id');
    const plantHqBtn = document.getElementById('plant-hq-btn');
    const refreshBtn = document.getElementById('refresh-map-btn');
    const buildingCountEl = document.getElementById('building-count');
    const bankBalanceEl = document.getElementById('bank-balance');
    const residentCountEl = document.getElementById('resident-count');
    const dateEl = document.getElementById('game-date');
    const wageSlider = document.getElementById('wage-slider');
    const wageDisplayEl = document.getElementById('wage-display');
    const gangCountEl = document.getElementById('gang-count');
    const gangMaxEl = document.getElementById('gang-max');

    // Visual-only references (MapLibre markers don't belong in pure model)
    const hqMarkers: maplibregl.Marker[] = [];            // array of MapLibre markers for visual reference
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
    state.wageOffer = parseInt((wageSlider as HTMLInputElement).value, 10);
    state.maxGangMembers = state.computeMaxGangMembers();

    function updateGangUI() {
        wageDisplayEl!.textContent = state.wageOffer.toString();
        gangMaxEl!.textContent = state.maxGangMembers.toString();
        gangCountEl!.textContent = hqMarkers.length.toString();
        residentCountEl!.textContent = state.totalResidents.toString();
    }
    updateGangUI();

    wageSlider!.addEventListener('input', () => {
        state.wageOffer = parseInt((wageSlider as HTMLInputElement).value, 10);
        state.maxGangMembers = state.computeMaxGangMembers();
        updateGangUI();
        (plantHqBtn as HTMLButtonElement).disabled = hqMarkers.length >= state.maxGangMembers;
    });

    // Find all the road layers to make them interactive
    // Look for any line layers that might represent roads
    const roadLayers = map.getStyle().layers
        .filter(layer =>
            layer.type === 'line' &&
            layer.source && // has a source
            layer['source-layer'] &&
            (layer['source-layer'].includes('road') || 
             layer['source-layer'].includes('transportation') || 
             layer['source-layer'].includes('bridge') ||
             layer.id.includes('road') ||
             layer.id.includes('street') ||
             layer.id.includes('highway')) &&
            !layer.id.includes('casing') &&
            !layer.id.includes('label')
        )
        .map(layer => layer.id);
    
    console.log('Road layers found:', roadLayers);

    // Add an invisible fill layer dedicated to hit-testing buildings using PMTiles data
    map.addLayer({
        id: 'building-hit',
        type: 'fill',
        source: 'nj-complete',
        'source-layer': 'building',
        paint: { 'fill-opacity': 0 }
    });
    console.log('Building hit-testing layer added using PMTiles source');

    // Use this layer for hovering / clicks
    const buildingLayers = ['building-hit'];
    let lastDebuggedBuildingId = null;

    // Add a single source and layer for highlighting the selected road.
    // This is simpler and more reliable than modifying map styles at runtime.
    map.addSource('selected-road', {
        'type': 'geojson',
        'data': null
    });

    map.addLayer({
        'id': 'selected-road-line',
        'type': 'line',
        'source': 'selected-road',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': '#fa9005', // Darker orange for selected
            'line-width': 7
        }
    });

    // Highlight selected building
    map.addSource('selected-building', { type: 'geojson', data: null });
    map.addLayer({
        id: 'selected-building-fill',
        type: 'fill',
        source: 'selected-building',
        paint: {
            'fill-color': '#ffeb3b',
            'fill-opacity': 0
        }
    });

    let selectedFeatureId = null;

    // --- SETUP SOURCES AND LAYERS ---

    // Source and layer to show the HQ's circle of influence
    map.addSource('influence-area', { type: 'geojson', data: null });
    map.addLayer({
        id: 'influence-area-fill',
        type: 'fill',
        source: 'influence-area',
        paint: {
            'fill-color': '#007bff',
            'fill-opacity': 0.2
        }
    });

    // Source and layer to show the road segments controlled by the HQ
    map.addSource('controlled-roads', { type: 'geojson', data: null });
    map.addLayer({
        id: 'controlled-roads-lines',
        type: 'line',
        source: 'controlled-roads',
        paint: {
            'line-color': '#fa9005',
            'line-width': 5
        }
    });

    // After existing sources and layers setup, add one for controlled buildings labels
    map.addSource('controlled-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'controlled-building-labels',
        type: 'symbol',
        source: 'controlled-buildings',
        layout: {
            'text-field': ['to-string', ['get', 'pop_est']],
            'text-size': 12,
            'text-font': ["Noto Sans Regular"]
        },
        paint: {
            'text-color': '#111',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1
        },
        minzoom: 15
    });

    // Removed building-specific gang tracking - now each HQ is independent
    // Hide previously defined label layer if exists (from earlier version)
    if (map.getLayer('hq-building-gang-labels')) {
        map.setLayoutProperty('hq-building-gang-labels', 'visibility', 'none');
    }

    // --- UI EVENT LISTENERS ---

    plantHqBtn!.addEventListener('click', () => {
        state.isPlanting = !state.isPlanting;
        plantHqBtn!.classList.toggle('active', state.isPlanting);
        // Leave cursor management to building-hover logic
    });

    refreshBtn!.addEventListener('click', () => {
        // Force a full page reload with a cache-busting query param so tiles and data are re-requested
        const url = window.location.pathname + '?r=' + Date.now();
        window.location.href = url;
    });

    map.on('mousemove', (e) => {
        if (!state.isPlanting) {
            return;
        }
        const hits = map.queryRenderedFeatures(e.point, { layers: buildingLayers });
        if (hits.length > 0) {
            const building = hits[0];
            // Use mouse position for more intuitive distance checking
            const mousePos = e.lngLat;
            const checkPoint: [number, number] = [mousePos.lng, mousePos.lat];
            const allowed = state.buildingAllowed(checkPoint);
            
            // Minimal debug for troubleshooting if needed
            // (Remove this block entirely once satisfied with performance)
            
        map.getCanvas().style.cursor = allowed ? 'crosshair' : '';
        } else {
            lastDebuggedBuildingId = null; // Reset when not hovering over any building
            map.getCanvas().style.cursor = '';
        }
    });

    map.on('click', (e) => {
        if (!state.isPlanting) return;

        // Require a building under the cursor
        const buildings = map.queryRenderedFeatures(e.point, { layers: buildingLayers });
        if (buildings.length === 0) {
            return;
        }
        const buildingFeature = buildings[0];
        const checkPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (!state.buildingAllowed(checkPoint)) {
            return; // outside current territory
        }
        (map.getSource('selected-building') as maplibregl.GeoJSONSource).setData(buildingFeature);

        // Use the exact click position instead of building centroid for better accuracy
        const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        plantHQ(coords, buildingFeature);

        state.isPlanting = false;
        plantHqBtn!.classList.remove('active');
        map.getCanvas().style.cursor = '';
    });

    // --- CORE LOGIC ---

    function plantHQ(coords: any, buildingFeature: any) {
        if (hqMarkers.length >= state.maxGangMembers) {
            alert('Not enough gang members. Increase wage offer to recruit more.');
            return;
        }
        
        // Always create a new marker for each HQ at the exact click position
        const el = document.createElement('div');
        el.className = 'gang-marker';
        el.textContent = (hqMarkers.length + 1).toString(); // Show HQ number
        const marker = new maplibregl.Marker(el).setLngLat(coords).addTo(map);

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
        (map.getSource('influence-area') as maplibregl.GeoJSONSource).setData(state.playerUnion);

        // 6) Update controlled roads and buildings using local data
        if (incrementalArea) {
            updateControlledRoadsFromLocal(circle, coords);
            updateControlledBuildingsFromLocal(circle, coords);
        }
        state.maxGangMembers = state.computeMaxGangMembers();
        updateGangUI();
    }

    function updateControlledRoadsFromLocal(circle, coords) {
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
            (map.getSource('controlled-roads') as maplibregl.GeoJSONSource).setData({
                type: 'FeatureCollection',
                features: state.controlledFeatures
            });
        }
    }

    function updateControlledBuildingsFromLocal(circle, coords) {
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
            buildingCountEl!.textContent = state.controlledBuildingIds.size.toString();
            (map.getSource('controlled-buildings') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: state.controlledBuildingFeatures });
            // Recompute max gang members since population changed
            state.maxGangMembers = state.computeMaxGangMembers();
            updateGangUI();
            // totalResidents can be used in future for income calculations
        }
    }

    // --- MOUSE HOVER INTERACTION ---
    // For simplicity and stability, we'll remove the hover effect for now
    // to ensure the core click-to-select functionality is flawless.
    map.on('mousemove', roadLayers, (e) => {
        if (state.isPlanting) return; // keep crosshair during placement mode
        map.getCanvas().style.cursor = (e.features && e.features.length > 0) ? 'pointer' : '';
    });

    function updateDateDisplay() {
        dateEl!.textContent = state.gameDate.toLocaleDateString('en-US', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    }
    updateDateDisplay();

    // Update bank balance every real second.
    setInterval(() => {
        const payingResidents = Math.max(0, state.totalResidents - hqMarkers.length);
        const incomePerSecond = (INCOME_PER_RESIDENT_PER_DAY / SECONDS_PER_DAY) * payingResidents;
        const wagesPerSecond = Math.max(0, hqMarkers.length - 1) * state.wageOffer; // first member (player) unpaid
        state.bankBalance += incomePerSecond - wagesPerSecond;
        bankBalanceEl!.textContent = state.bankBalance.toFixed(2);
    }, 1000);

    // Advance game date every game day (now every 1s)
    setInterval(() => {
        // add one day
        state.gameDate.setDate(state.gameDate.getDate() + 1);
        updateDateDisplay();
    }, SECONDS_PER_DAY * 1000);
});

// Helper functions moved to GameState.pointsEqual, GameState.dist2, GameState.pointToSegmentDistance 