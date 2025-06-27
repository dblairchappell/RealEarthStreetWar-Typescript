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
    let isPlanting = false;
    let hqMarker = null;

    const INFLUENCE_RADIUS_KM = 0.5; // 500 meters

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

    // --- UI EVENT LISTENERS ---

    plantHqBtn.addEventListener('click', () => {
        isPlanting = !isPlanting;
        plantHqBtn.classList.toggle('active', isPlanting);
        map.getCanvas().style.cursor = isPlanting ? 'crosshair' : '';
    });

    map.on('click', (e) => {
        if (!isPlanting) return;

        const coords = e.lngLat;
        plantHQ(coords);

        // Exit planting mode after placing the HQ
        isPlanting = false;
        plantHqBtn.classList.remove('active');
        map.getCanvas().style.cursor = '';
    });

    // --- CORE LOGIC ---

    function plantHQ(coords) {
        // Remove existing marker if there is one
        if (hqMarker) {
            hqMarker.remove();
        }
        // Add a new marker to the map
        hqMarker = new mapboxgl.Marker().setLngLat(coords).addTo(map);

        // Create a circle of influence around the HQ
        const center = [coords.lng, coords.lat];
        const radius = INFLUENCE_RADIUS_KM;
        const options = { steps: 64, units: 'kilometers' };
        const influenceCircle = turf.circle(center, radius, options);

        // Update the map to show the new influence area
        map.getSource('influence-area').setData(influenceCircle);

        // Update road control based on the new HQ location
        updateControlledRoadsFromOverpass(influenceCircle, coords);
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
            const center = turf.point([coords.lng, coords.lat]);
            const radiusKm = INFLUENCE_RADIUS_KM;

            // Process each road to extract segments within the circle
            geojson.features.forEach(f => {
                if (f.geometry.type === 'LineString') {
                    const coords = f.geometry.coordinates;
                    const segments = [];
                    
                    // Go through each pair of consecutive points
                    for (let i = 0; i < coords.length - 1; i++) {
                        const p1 = coords[i];
                        const p2 = coords[i + 1];
                        
                        const d1 = turf.distance(center, turf.point(p1), { units: 'kilometers' });
                        const d2 = turf.distance(center, turf.point(p2), { units: 'kilometers' });
                        
                        const p1Inside = d1 <= radiusKm;
                        const p2Inside = d2 <= radiusKm;
                        
                        if (p1Inside && p2Inside) {
                            // Both points inside - add the whole segment
                            segments.push([p1, p2]);
                        } else if (p1Inside || p2Inside) {
                            // One point inside, one outside - find intersection with circle
                            const line = turf.lineString([p1, p2]);
                            try {
                                const intersections = turf.lineIntersect(line, circle);
                                if (intersections.features.length > 0) {
                                    const intersection = intersections.features[0].geometry.coordinates;
                                    if (p1Inside) {
                                        // p1 is inside, p2 is outside
                                        segments.push([p1, intersection]);
                                    } else {
                                        // p1 is outside, p2 is inside
                                        segments.push([intersection, p2]);
                                    }
                                } else {
                                    // Fallback: if no intersection found but one point is inside
                                    if (p1Inside) {
                                        segments.push([p1, p2]);
                                    }
                                }
                            } catch (e) {
                                // If intersection calculation fails, include segment if either point is inside
                                if (p1Inside || p2Inside) {
                                    segments.push([p1, p2]);
                                }
                            }
                        }
                        // If both points are outside, skip this segment
                    }
                    
                    // Convert segments to continuous linestrings
                    if (segments.length > 0) {
                        // Group consecutive segments into continuous lines
                        const lines = [];
                        let currentLine = [segments[0][0], segments[0][1]];
                        
                        for (let i = 1; i < segments.length; i++) {
                            const prevEnd = currentLine[currentLine.length - 1];
                            const currStart = segments[i][0];
                            
                            // Check if this segment connects to the previous one
                            const distance = turf.distance(turf.point(prevEnd), turf.point(currStart), { units: 'meters' });
                            if (distance < 10) { // Within 10 meters - consider connected
                                currentLine.push(segments[i][1]);
                            } else {
                                // Start a new line
                                if (currentLine.length >= 2) {
                                    lines.push(turf.lineString(currentLine));
                                }
                                currentLine = [segments[i][0], segments[i][1]];
                            }
                        }
                        
                        // Add the last line
                        if (currentLine.length >= 2) {
                            lines.push(turf.lineString(currentLine));
                        }
                        
                        validRoads.push(...lines);
                    }
                }
            });

            console.log('Highlighted roads:', validRoads.length);
            map.getSource('controlled-roads').setData({ 
                type: 'FeatureCollection', 
                features: validRoads 
            });
        } catch (e) {
            console.error('Overpass fetch failed', e);
        }
    }

    // --- MOUSE HOVER INTERACTION ---
    // For simplicity and stability, we'll remove the hover effect for now
    // to ensure the core click-to-select functionality is flawless.
    map.on('mousemove', roadLayers, (e) => {
        map.getCanvas().style.cursor = e.features.length > 0 ? 'pointer' : '';
    });
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