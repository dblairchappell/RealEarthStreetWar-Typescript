import GameState      from "./model/GameState";
import MapView        from "./view/MapView";
import GameController from "./controller/GameController";

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

    let bankBalance = 0;
    let gameDate = new Date(2023, 0, 1); // Jan 1, 2023
    let isPlanting = false;
    const hqMarkers = [];            // array of MapLibre markers for visual reference
    const playerFlags = [];          // array of { id, lngLat }
    let playerUnion = null;          // GeoJSON Polygon/MultiPolygon representing union of all circles
    let controlledFeatures = [];     // accumulated road segments already highlighted
    const controlledBuildingIds = new Set();
    const controlledBuildingFeatures = [];
    let totalResidents = 0;

    const INFLUENCE_RADIUS_KM = 0.6; // 600 meters
    const INCOME_PER_RESIDENT_PER_DAY = 1;
    const SECONDS_PER_DAY = 1; // 1 game day = 1 real second
    const AREA_PER_RESIDENT = 25; // m^2
    const METERS_PER_FLOOR_DEFAULT = 3;

    // Gang wage offer (per member per day) & gang availability
    const MIN_WAGE = 50; // $50 corresponds to 1% population willing
    const PERCENT_PER_INCREMENT = 0.01; // 1% per $10 increment
    let wageOffer = parseInt(wageSlider.value, 10); // initial wage per member per day
    let maxGangMembers = 0; // will be computed based on totalResidents

    function computeMaxGangMembers() {
        if (wageOffer < MIN_WAGE) return 0;
        const increments = Math.floor((wageOffer - MIN_WAGE) / 10) + 1; // 50->1, 60->2, etc.
        const willingPercent = increments * PERCENT_PER_INCREMENT; // convert to fraction
        const calc = Math.floor(totalResidents * willingPercent);
        return Math.max(1, calc);
    }

    // Initialise max gang members at startup
    maxGangMembers = computeMaxGangMembers();

    function updateGangUI() {
        wageDisplayEl.textContent = wageOffer;
        gangMaxEl.textContent = maxGangMembers;
        gangCountEl.textContent = hqMarkers.length;
        residentCountEl.textContent = totalResidents;
    }
    updateGangUI();

    wageSlider.addEventListener('input', () => {
        wageOffer = parseInt(wageSlider.value, 10);
        maxGangMembers = computeMaxGangMembers();
        updateGangUI();
        plantHqBtn.disabled = hqMarkers.length >= maxGangMembers;
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

    plantHqBtn.addEventListener('click', () => {
        isPlanting = !isPlanting;
        plantHqBtn.classList.toggle('active', isPlanting);
        // Leave cursor management to building-hover logic
    });

    refreshBtn.addEventListener('click', () => {
        // Force a full page reload with a cache-busting query param so tiles and data are re-requested
        const url = window.location.pathname + '?r=' + Date.now();
        window.location.href = url;
    });

    function buildingAllowed(feature, mousePosition = null) {
        if (hqMarkers.length === 0) {
            return true; // first flag anywhere
        }
        
        // Use mouse position if available, otherwise fall back to bounding box center
        let checkPoint;
        if (mousePosition) {
            checkPoint = [mousePosition.lng, mousePosition.lat];
        } else {
            const bbox = turf.bbox(feature);
            checkPoint = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
        }
        
        const radiusKm = INFLUENCE_RADIUS_KM;
        
        // Check if point is within influence radius of any existing HQ
        for (let i = 0; i < hqMarkers.length; i++) {
            const hqPos = hqMarkers[i].getLngLat();
            const hqCenter = [hqPos.lng, hqPos.lat];
            const distance = turf.distance(turf.point(checkPoint), turf.point(hqCenter), { units: 'kilometers' });
            
            if (distance <= radiusKm) {
                return true;
            }
        }
        
        return false;
    }

    map.on('mousemove', (e) => {
        if (!isPlanting) {
            return;
        }
        const hits = map.queryRenderedFeatures(e.point, { layers: buildingLayers });
        if (hits.length > 0) {
            const building = hits[0];
            // Use mouse position for more intuitive distance checking
            const mousePos = e.lngLat;
            const allowed = buildingAllowed(building, mousePos);
            
            // Minimal debug for troubleshooting if needed
            // (Remove this block entirely once satisfied with performance)
            
        map.getCanvas().style.cursor = allowed ? 'crosshair' : '';
        } else {
            lastDebuggedBuildingId = null; // Reset when not hovering over any building
            map.getCanvas().style.cursor = '';
        }
    });

    map.on('click', (e) => {
        if (!isPlanting) return;

        // Require a building under the cursor
        const buildings = map.queryRenderedFeatures(e.point, { layers: buildingLayers });
        if (buildings.length === 0) {
            return;
        }
        const buildingFeature = buildings[0];
        if (!buildingAllowed(buildingFeature, e.lngLat)) {
            return; // outside current territory
        }
        map.getSource('selected-building').setData(buildingFeature);

        // Use the exact click position instead of building centroid for better accuracy
        const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        plantHQ(coords, buildingFeature);

        isPlanting = false;
        plantHqBtn.classList.remove('active');
        map.getCanvas().style.cursor = '';
    });

    // --- CORE LOGIC ---

    function plantHQ(coords, buildingFeature) {
        if (hqMarkers.length >= maxGangMembers) {
            alert('Not enough gang members. Increase wage offer to recruit more.');
            return;
        }
        
        // Always create a new marker for each HQ at the exact click position
            const el = document.createElement('div');
            el.className = 'gang-marker';
        el.textContent = (hqMarkers.length + 1).toString(); // Show HQ number
        const marker = new maplibregl.Marker(el).setLngLat(coords).addTo(map);

        hqMarkers.push(marker);

        // 2) Build the circle polygon for this flag
        const center = [coords.lng, coords.lat];
        const radius = INFLUENCE_RADIUS_KM;
        const options = { steps: 64, units: 'kilometers' };
        const circle = turf.circle(center, radius, options);

        // 3) Compute the area that is truly new (circle minus current union)
        let incrementalArea;
        if (playerUnion) {
            try {
                incrementalArea = turf.difference(circle, playerUnion);
            } catch (err) {
                console.warn('turf.difference failed, falling back to full circle', err);
                incrementalArea = circle;
            }
        } else {
            incrementalArea = circle;
        }

        // 4) Update the running union
        playerUnion = playerUnion ? turf.union(playerUnion, circle) : circle;

        // 5) Update influence fill layer to show the full territory
        map.getSource('influence-area').setData(playerUnion);

        // 6) Update controlled roads and buildings using local data
        if (incrementalArea) {
            updateControlledRoadsFromLocal(circle, coords);
            updateControlledBuildingsFromLocal(circle, coords);
        }
        maxGangMembers = computeMaxGangMembers();
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
            controlledFeatures.push(...validRoads);
            map.getSource('controlled-roads').setData({
                type: 'FeatureCollection',
                features: controlledFeatures
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
            
            if (controlledBuildingIds.has(id)) return; // already counted
            
            // Check if building is inside the circle
            try {
                const centroid = turf.centroid(f).geometry.coordinates;
                if (!(playerUnion && turf.booleanPointInPolygon(turf.point(centroid), playerUnion))) {
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
                controlledBuildingIds.add(id);
                controlledBuildingFeatures.push(f);
                totalResidents += pop_est;
                added = true;
            } catch (err) {
                console.warn('Error processing building feature:', err);
            }
        });
        
        if (added) {
            buildingCountEl.textContent = controlledBuildingIds.size;
            map.getSource('controlled-buildings').setData({ type: 'FeatureCollection', features: controlledBuildingFeatures });
            // Recompute max gang members since population changed
            maxGangMembers = computeMaxGangMembers();
            updateGangUI();
            // totalResidents can be used in future for income calculations
        }
    }

    // --- MOUSE HOVER INTERACTION ---
    // For simplicity and stability, we'll remove the hover effect for now
    // to ensure the core click-to-select functionality is flawless.
    map.on('mousemove', roadLayers, (e) => {
        if (isPlanting) return; // keep crosshair during placement mode
        map.getCanvas().style.cursor = e.features.length > 0 ? 'pointer' : '';
    });

    function updateDateDisplay() {
        dateEl.textContent = gameDate.toLocaleDateString('en-US', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    }
    updateDateDisplay();

    // Update bank balance every real second.
    setInterval(() => {
        const payingResidents = Math.max(0, totalResidents - hqMarkers.length);
        const incomePerSecond = (INCOME_PER_RESIDENT_PER_DAY / SECONDS_PER_DAY) * payingResidents;
        const wagesPerSecond = Math.max(0, hqMarkers.length - 1) * wageOffer; // first member (player) unpaid
        bankBalance += incomePerSecond - wagesPerSecond;
        bankBalanceEl.textContent = bankBalance.toFixed(2);
    }, 1000);

    // Advance game date every game day (now every 1s)
    setInterval(() => {
        // add one day
        gameDate.setDate(gameDate.getDate() + 1);
        updateDateDisplay();
    }, SECONDS_PER_DAY * 1000);
});

// Helper function to check if two points are effectively equal
function pointsEqual(p1, p2) {
    const tolerance = 1e-9;
    return Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance;
}

// Helper function to calculate the squared distance from a point to a line segment
function pointToSegmentDistance(p, p1, p2) {
    const l2 = dist2(p1, p2);
    if (l2 === 0) return dist2(p, p1);
    let t = ((p[0] - p1[0]) * (p2[0] - p1[0]) + (p[1] - p1[1]) * (p2[1] - p1[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection = [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
    return dist2(p, projection);
}

function dist2(p1, p2) {
    return Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2);
} 