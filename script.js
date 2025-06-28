// Game logic will go here

mapboxgl.accessToken = 'pk.eyJ1Ijoic3RyZWV0d2FyZ2FtZSIsImEiOiJjbWNleGxyaXAwMmpiMnFzY3ZrcjZ5bzZoIn0.XV6-STLYBkq8osAE4FD_7g';
const map = new mapboxgl.Map({
    container: 'map', // container ID
    style: 'mapbox://styles/mapbox/streets-v11', // style URL
    center: [-74.5, 40], // starting position [lng, lat]
    zoom: 13 // start a bit closer to see details
});

map.on('load', () => {
    const infoPanel = document.getElementById('info-panel');
    const roadNameEl = document.getElementById('road-name');
    const roadTypeEl = document.getElementById('road-type');
    const roadIdEl = document.getElementById('road-id');
    const plantHqBtn = document.getElementById('plant-hq-btn');
    const refreshBtn = document.getElementById('refresh-map-btn');
    const buildingCountEl = document.getElementById('building-count');
    const bankBalanceEl = document.getElementById('bank-balance');
    const dateEl = document.getElementById('game-date');
    const wageSlider = document.getElementById('wage-slider');
    const wageDisplayEl = document.getElementById('wage-display');
    const gangCountEl = document.getElementById('gang-count');
    const gangMaxEl = document.getElementById('gang-max');

    let bankBalance = 0;
    let gameDate = new Date(2023, 0, 1); // Jan 1, 2023
    let isPlanting = false;
    const hqMarkers = [];            // array of Mapbox markers for visual reference
    const playerFlags = [];          // array of { id, lngLat }
    let playerUnion = null;          // GeoJSON Polygon/MultiPolygon representing union of all circles
    let controlledFeatures = [];     // accumulated road segments already highlighted
    const controlledBuildingIds = new Set();
    const controlledBuildingFeatures = [];
    let totalResidents = 0;

    const INFLUENCE_RADIUS_KM = 0.2; // 200 meters
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
    }
    updateGangUI();

    wageSlider.addEventListener('input', () => {
        wageOffer = parseInt(wageSlider.value, 10);
        maxGangMembers = computeMaxGangMembers();
        updateGangUI();
        plantHqBtn.disabled = hqMarkers.length >= maxGangMembers;
    });

    // Find all the road layers to make them interactive
    const roadLayers = map.getStyle().layers
        .filter(layer =>
            layer.type === 'line' &&
            layer.source === 'composite' &&
            layer['source-layer'] &&
            (layer['source-layer'].startsWith('road') || layer['source-layer'].startsWith('bridge')) &&
            !layer.id.includes('casing')
        )
        .map(layer => layer.id);

    // Find building layers for hit-testing
    const buildingLayers = map.getStyle().layers
        .filter(l => l.type === 'fill' && l.source === 'composite' && l["source-layer"] && l["source-layer"].startsWith('building'))
        .map(l => l.id);

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
            'fill-opacity': 0.4
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
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
        },
        paint: {
            'text-color': '#111',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1
        },
        minzoom: 15
    });

    // Map from building id -> { count, marker }
    const buildingGangData = {};
    let totalGangMembers = 0;
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

    function buildingAllowed(feature) {
        if (!playerUnion) return true; // first flag anywhere
        const c = turf.centroid(feature).geometry.coordinates;
        return turf.booleanPointInPolygon(turf.point(c), playerUnion);
    }

    map.on('mousemove', (e) => {
        if (!isPlanting) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: buildingLayers });
        const allowed = hits.length > 0 && buildingAllowed(hits[0]);
        map.getCanvas().style.cursor = allowed ? 'crosshair' : '';
    });

    map.on('click', (e) => {
        if (!isPlanting) return;

        // Require a building under the cursor
        const buildings = map.queryRenderedFeatures(e.point, { layers: buildingLayers });
        if (buildings.length === 0) {
            return;
        }
        const buildingFeature = buildings[0];
        if (!buildingAllowed(buildingFeature)) {
            return; // outside current territory
        }
        map.getSource('selected-building').setData(buildingFeature);

        // Use the building centroid as the flag position
        const centroid = turf.centroid(buildingFeature).geometry.coordinates;
        const coords = { lng: centroid[0], lat: centroid[1] };
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
        // 1) Add or update a marker for the building
        const bId = buildingFeature.id || (buildingFeature.properties && buildingFeature.properties.id);
        let marker;
        if (bId != null && buildingGangData[bId]) {
            // Existing marker – just update count
            const data = buildingGangData[bId];
            data.count += 1;
            data.element.textContent = data.count;
            marker = data.marker;
        } else {
            // First gang member in this building – create custom marker element
            const el = document.createElement('div');
            el.className = 'gang-marker';
            el.textContent = '1';
            marker = new mapboxgl.Marker(el).setLngLat(coords).addTo(map);
            if (bId != null) {
                buildingGangData[bId] = { count: 1, marker, element: el };
            }
        }

        hqMarkers.push(marker);
        totalGangMembers += 1;

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

        // 6) Fetch & highlight roads only for the new area (if any)
        if (incrementalArea) {
            updateControlledRoadsFromOverpass(circle, coords);
            updateControlledBuildingsFromOverpass(circle, coords);
        }
        maxGangMembers = computeMaxGangMembers();
        updateGangUI();
    }

    async function updateControlledRoadsFromOverpass(circle, coords) {
        const radiusM = INFLUENCE_RADIUS_KM * 1000;
        const query = `[out:json][timeout:25];(
            way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track|bus_guideway|escape|raceway|road|footway|bridleway|steps|corridor|path|cycleway|construction)$"](around:${radiusM},${coords.lat},${coords.lng});
            way["highway"]["area"!="yes"](around:${radiusM},${coords.lat},${coords.lng});
        );out geom;`;

        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        
        try {
            const resp = await fetch(url);
            const data = await resp.json();
            const geojson = osmtogeojson(data);
            console.log('Processing', geojson.features.length, 'roads...');

            const validRoads = [];
            const centerLng = coords.lng;
            const centerLat = coords.lat;
            const cosLat = Math.cos(centerLat * Math.PI / 180); // for E-W distance scaling
            const radiusKm = INFLUENCE_RADIUS_KM;
            const radiusMeters = radiusKm * 1000;
            const radiusSq = radiusMeters * radiusMeters;

            // Fast planar distance approximation (good for < ~10km radius)
            function distSq(lon, lat) {
                const dx = (lon - centerLng) * cosLat * 111_320; // meters per degree lon ≈ 111.32km * cos(lat)
                const dy = (lat - centerLat) * 110_574;          // meters per degree lat ≈ 110.574km
                return dx * dx + dy * dy; // squared distance in m^2
            }

            // Process each road and clip segments that fall within the circle
            geojson.features.forEach(f => {
                if (f.geometry.type !== 'LineString') return; // skip non-LineString geometries

                const coordsArr = f.geometry.coordinates;
                let currentLine = [];

                for (let i = 0; i < coordsArr.length - 1; i++) {
                    const [lon1, lat1] = coordsArr[i];
                    const [lon2, lat2] = coordsArr[i + 1];

                    const d1sq = distSq(lon1, lat1);
                    const d2sq = distSq(lon2, lat2);

                    const p1Inside = d1sq <= radiusSq;
                    const p2Inside = d2sq <= radiusSq;

                    // Helper to push a point into current line
                    const pushPoint = (pt) => {
                        if (currentLine.length === 0 || (currentLine[currentLine.length - 1][0] !== pt[0] || currentLine[currentLine.length - 1][1] !== pt[1])) {
                            currentLine.push(pt);
                        }
                    };

                    if (p1Inside && p2Inside) {
                        // Whole segment inside – add both endpoints
                        pushPoint([lon1, lat1]);
                        pushPoint([lon2, lat2]);
                    } else if (p1Inside !== p2Inside) {
                        // Segment crosses the circle boundary – find intersection by simple linear interpolation
                        const dx = lon2 - lon1;
                        const dy = lat2 - lat1;

                        // Approximate along parameter t where distance equals radius
                        // Use binary search to refine intersection (few iterations, cheap)
                        let tLow = 0, tHigh = 1, tMid = 0;
                        for (let iter = 0; iter < 6; iter++) { // 6 iterations ~1/64 precision, good enough
                            tMid = (tLow + tHigh) / 2;
                            const lonMid = lon1 + dx * tMid;
                            const latMid = lat1 + dy * tMid;
                            const dMidSq = distSq(lonMid, latMid);
                            if ((p1Inside && dMidSq > radiusSq) || (!p1Inside && dMidSq <= radiusSq)) {
                                tHigh = tMid;
                            } else {
                                tLow = tMid;
                            }
                        }
                        const lonInt = lon1 + dx * tMid;
                        const latInt = lat1 + dy * tMid;
                        const intersection = [lonInt, latInt];

                        // Add clipped segment part that lies inside
                        if (p1Inside) {
                            pushPoint([lon1, lat1]);
                            pushPoint(intersection);
                        } else {
                            pushPoint(intersection);
                            pushPoint([lon2, lat2]);
                        }
                    } else {
                        // Both outside – flush current line if exists
                        if (currentLine.length >= 2) {
                            validRoads.push(turf.lineString(currentLine));
                        }
                        currentLine = [];
                    }
                }

                // Flush any remaining line after finishing the road
                if (currentLine.length >= 2) {
                    validRoads.push(turf.lineString(currentLine));
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
        } catch (e) {
            console.error('Overpass fetch failed', e);
        }
    }

    async function updateControlledBuildingsFromOverpass(circle, coords) {
        const radiusM = INFLUENCE_RADIUS_KM * 1000;
        const query = `[out:json][timeout:25];(way["building"](around:${radiusM},${coords.lat},${coords.lng});relation["building"](around:${radiusM},${coords.lat},${coords.lng}););out geom tags;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        try {
            const resp = await fetch(url);
            const data = await resp.json();
            const geojson = osmtogeojson(data);
            let added = false;
            geojson.features.forEach(f => {
                const id = f.id || (f.properties && f.properties.id);
                if (!id) return;
                if (controlledBuildingIds.has(id)) return; // already counted
                const centroid = turf.centroid(f).geometry.coordinates;
                if (!(playerUnion && turf.booleanPointInPolygon(turf.point(centroid), playerUnion))) {
                    return; // skip if not actually inside
                }

                // Estimate population
                const area = turf.area(f); // in m^2
                let levels = parseFloat(f.properties["building:levels"]);
                if (!levels || isNaN(levels)) {
                    const height = parseFloat(f.properties.height);
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
            });
            if (added) {
                buildingCountEl.textContent = controlledBuildingIds.size;
                map.getSource('controlled-buildings').setData({ type: 'FeatureCollection', features: controlledBuildingFeatures });
                // Recompute max gang members since population changed
                maxGangMembers = computeMaxGangMembers();
                updateGangUI();
                // totalResidents can be used in future for income calculations
            }
        } catch (err) {
            console.error('Failed to fetch buildings from Overpass', err);
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
        const payingResidents = Math.max(0, totalResidents - totalGangMembers);
        const incomePerSecond = (INCOME_PER_RESIDENT_PER_DAY / SECONDS_PER_DAY) * payingResidents;
        const wagesPerSecond = Math.max(0, maxGangMembers - 1) * wageOffer; // first member (player) unpaid
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