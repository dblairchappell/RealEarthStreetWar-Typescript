// Game logic will go here 

mapboxgl.accessToken = 'pk.eyJ1Ijoic3RyZWV0d2FyZ2FtZSIsImEiOiJjbWNleGxyaXAwMmpiMnFzY3ZrcjZ5bzZoIn0.XV6-STLYBkq8osAE4FD_7g';
const map = new mapboxgl.Map({
    container: 'map', // container ID
    style: 'mapbox://styles/mapbox/streets-v11', // style URL
    center: [-74.5, 40], // starting position [lng, lat]
    zoom: 9 // starting zoom
});

map.on('load', () => {
    const loadRoadsButton = document.getElementById('load-roads');
    const infoPanel = document.getElementById('info-panel');
    const roadNameEl = document.getElementById('road-name');
    const roadTypeEl = document.getElementById('road-type');
    const roadIdEl = document.getElementById('road-id');
    const MIN_ZOOM_FOR_ROADS = 12;

    loadRoadsButton.addEventListener('click', async () => {
        if (map.getZoom() < MIN_ZOOM_FOR_ROADS) {
            alert(`Please zoom in further to load roads. The minimum zoom level is ${MIN_ZOOM_FOR_ROADS}.`);
            return;
        }

        const bounds = map.getBounds();
        const bbox = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()].join(',');

        const query = `
            [out:json][timeout:25][bbox:${bbox}];
            (
                way["highway"];
            );
            out body;
            >;
            out skel qt;
        `;

        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

        try {
            loadRoadsButton.disabled = true;
            loadRoadsButton.textContent = 'Loading...';

            const response = await fetch(url);
            const data = await response.json();
            const geojson = osmtogeojson(data);

            if (map.getSource('roads')) {
                map.getSource('roads').setData(geojson);
            } else {
                map.addSource('roads', {
                    type: 'geojson',
                    data: geojson
                });

                map.addLayer({
                    'id': 'road-lines',
                    'type': 'line',
                    'source': 'roads',
                    'layout': {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    'paint': {
                        'line-color': '#ffbc36',
                        'line-width': 4
                    }
                });

                // Add a new source and layer for the selected road
                map.addSource('selected-road', {
                    'type': 'geojson',
                    'data': {
                        'type': 'FeatureCollection',
                        'features': []
                    }
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
                        'line-color': '#fa9005', // Blue for selected
                        'line-width': 7
                    }
                });

                map.on('click', 'road-lines', (e) => {
                    const feature = e.features[0];
                    const properties = feature.properties;
                    console.log('Selected Road Properties:', properties);

                    // Populate and show the info panel
                    roadNameEl.textContent = properties.name || 'Unnamed Road';
                    roadTypeEl.textContent = properties.highway;
                    roadIdEl.textContent = feature.id;
                    infoPanel.classList.remove('hidden');

                    // Update the 'selected-road' source with the clicked feature
                    const selectedRoadSource = map.getSource('selected-road');
                    if (selectedRoadSource) {
                        selectedRoadSource.setData(feature.geometry);
                    }
                });

                // Change the cursor to a pointer when hovering over a road
                map.on('mouseenter', 'road-lines', () => {
                    map.getCanvas().style.cursor = 'pointer';
                });
                map.on('mouseleave', 'road-lines', () => {
                    map.getCanvas().style.cursor = '';
                });
            }
        } catch (error) {
            console.error('Error loading road data:', error);
            alert('Failed to load road data. See console for details.');
        } finally {
            loadRoadsButton.disabled = false;
            loadRoadsButton.textContent = 'Load Roads in View';
        }
    });
}); 