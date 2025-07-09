# Map Data System

Real-Earth Street War uses PMTiles format for efficient, offline-first map data delivery. The current implementation includes complete New Jersey coverage with plans for additional regions.

## 📊 Current Dataset

### New Jersey Complete (`nj-complete.pmtiles`)
- **File Size**: 116MB compressed
- **Coverage**: All of New Jersey state
- **Zoom Levels**: 0-14 with detailed building data
- **Layers**: Buildings, roads, water bodies, terrain, boundaries
- **Source**: OpenStreetMap via Planetiler export

### Data Characteristics
- **Buildings**: Complete footprints with height data where available
- **Road Network**: All road types from highways to residential streets
- **Water Features**: Rivers, lakes, coastline with proper topology
- **Boundaries**: State, county, municipal boundaries
- **POI Data**: Points of interest for building classification

## 🗺 Map Style Configuration

### `offline-map-style.json` (11KB, 440 lines)
The map style defines visual appearance and data layer processing:

**Key Layer Types:**
- **Background**: Base map color and texture
- **Water**: Polygons for rivers, lakes, ocean with blue styling
- **Buildings**: 3D extrusion with height-based coloring
- **Roads**: Multi-class styling (highway, primary, residential, etc.)
- **Boundaries**: Administrative borders with different weights

**Building Height Visualization:**
```json
{
  "type": "fill-extrusion",
  "paint": {
    "fill-extrusion-color": [
      "interpolate", ["linear"], ["get", "height"],
      0, "#cccccc",      // Ground level - light gray
      20, "#888888",     // Low buildings - medium gray  
      50, "#444444",     // Mid-rise - dark gray
      100, "#222222"     // High-rise - very dark gray
    ],
    "fill-extrusion-height": ["*", ["get", "height"], 1]
  }
}
```

## 🏗 PMTiles Format

### Advantages
- **Efficient**: Single-file distribution with internal tiling
- **Offline-Ready**: No tile server required, works with `file://` protocol
- **Compression**: Optimized vector data with minimal overhead
- **Standards-Based**: Compatible with MapLibre GL JS and other tools

### Technical Details
- **Vector Tiles**: Data stored as Mapbox Vector Tiles (MVT) internally
- **Spatial Index**: Built-in spatial indexing for fast zoom/pan
- **Compression**: Uses Protocol Buffers for compact data representation
- **HTTP Range**: Supports efficient partial downloading (future streaming)

## ⚙️ Data Generation Process

### Current Workflow (New Jersey)
```bash
# Using Planetiler via Docker
docker run --rm -it -v ${PWD}:/data ghcr.io/onthegomap/planetiler:latest \
  --download=true \
  --osm-path=/data/new-jersey-latest.osm.pbf \
  --output=/data/nj-complete.pmtiles \
  --output-format=pmtiles \
  --area=new-jersey \
  --maxzoom=14
```

### Parameters Explained
- **`--area=new-jersey`**: Predefined geographic boundary
- **`--maxzoom=14`**: Street-level detail sufficient for gameplay
- **`--output-format=pmtiles`**: Single-file output format
- **OpenMapTiles Profile**: Standard schema with buildings, roads, water

## 🌍 Planned Expansions

### `expansion-packs.json` Configuration
```json
{
  "new-york-city": {
    "name": "New York City Complete",
    "estimated_size_mb": 200,
    "coverage_area": "NYC 5 boroughs",
    "priority": "high"
  },
  "philadelphia-metro": {
    "name": "Philadelphia Metro Area", 
    "estimated_size_mb": 150,
    "coverage_area": "Philadelphia + surrounding counties",
    "priority": "medium"
  }
}
```

### Generation Commands
**New York City:**
```bash
docker run --rm -it -v ${PWD}:/data ghcr.io/onthegomap/planetiler:latest \
  --osm-path=/data/new-york-latest.osm.pbf \
  --output=/data/nyc-complete.pmtiles \
  --bounds=-74.2591,40.4774,-73.7004,40.9176 \
  --maxzoom=15
```

**Philadelphia:**
```bash  
docker run --rm -it -v ${PWD}:/data ghcr.io/onthegomap/planetiler:latest \
  --osm-path=/data/philadelphia-latest.osm.pbf \
  --output=/data/philly-complete.pmtiles \
  --bounds=-75.2804,39.8670,-74.9557,40.1379 \
  --maxzoom=14
```

## 🎯 Gameplay Integration

### Building Detection System
```javascript
// Query buildings at mouse click location
const buildingFeatures = map.queryRenderedFeatures(event.point, {
  layers: ['building']
});

if (buildingFeatures.length > 0) {
  // Valid building location for Producer/Retailer HQ
  return true;
}
```

### Road Network Queries
```javascript
// Check for road or water placement (Trafficker HQ)
const transportFeatures = map.queryRenderedFeatures(event.point, {
  layers: ['road', 'waterway']
});

return transportFeatures.length > 0;
```

### Performance Characteristics
- **Initial Load**: ~2-3 seconds for 116MB dataset
- **Zoom Performance**: 60fps at all zoom levels
- **Memory Usage**: ~200MB peak during tile processing
- **Query Speed**: Sub-millisecond feature queries

## 🔧 Customization Options

### Modifying Map Style
1. **Edit Style JSON**: Update `offline-map-style.json`
2. **Layer Properties**: Modify colors, visibility, extrusion heights
3. **Data Filtering**: Add feature filtering expressions
4. **New Layers**: Add custom styling for additional data sources

### Data Source Extensions
- **Custom Buildings**: Add private building datasets
- **Terrain Data**: Include elevation models for 3D terrain
- **Traffic Data**: Integrate real-time or historical traffic
- **Weather Integration**: Add weather-responsive styling

### Quality Considerations
- **Data Freshness**: OpenStreetMap data may be outdated in some areas
- **Completeness**: Building height data varies by region
- **Accuracy**: GPS coordinates generally accurate within 1-5 meters
- **Coverage**: Rural areas may have less detailed building data 