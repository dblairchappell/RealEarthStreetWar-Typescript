# Real-Earth Street War

## Project Vision

This project is a prototype for a massively multiplayer online strategy game inspired by the classic board game *Risk*. The game world is a 1:1 representation of the real Earth, where players, organized into gangs or factions, fight to capture and control real-world streets and territories.

The core gameplay loop is intended to be:
- **Territory Control:** Every street segment is a distinct, conquerable territory.
- **Resource Generation:** Owning territories generates resources based on properties like population density and building footprints.
- **Strategic Depth:** A street's defensibility is determined by how many other streets it connects to, creating natural choke points and strategic fronts.

## Current Status

This repository contains a **fully offline, frontend-only prototype** built with vanilla HTML, CSS, and JavaScript. The application runs entirely without internet connectivity using local map data and assets.

**Current features include:**
- **Complete Offline Operation**: 116MB New Jersey map data with all layers (buildings, roads, water, terrain, labels)
- **3D Building Visualization**: Interactive building rendering with height data from local PMTiles
- **HQ Placement System**: Territory control mechanics with influence radius visualization
- **Population & Income Calculation**: Based on building footprints and density analysis
- **Gang Recruitment System**: Wage-based recruitment tied to local population
- **Territory Expansion**: Visual feedback for building and road control
- **Local Asset Management**: All JavaScript libraries, fonts, and map data stored locally

## Technical Implementation

### Tech Stack
- **HTML5, CSS3, JavaScript (ES6+):** Core web technologies for the client
- **MapLibre GL JS (`v3.6.2`):** Open-source mapping library for high-performance map rendering
- **PMTiles:** Vector tile format for efficient offline map data storage
- **Local Assets:** All dependencies stored in `libs/` directory for offline operation

### Data Sources
- **Map Data**: Complete New Jersey dataset generated using Planetiler from OpenStreetMap
- **Building Heights**: Extracted from OpenStreetMap `building:levels` and `height` tags
- **Fonts**: Noto Sans font family in PBF format for offline text rendering
- **No External Dependencies**: Zero network requests during normal operation

### Project Structure
- `index.html`: Main application entry point
- `style.css`: UI styling and layout
- `script.js`: Core game logic and map interaction
- `offline-map-style.json`: MapLibre style definition using local data sources
- `libs/`: Local JavaScript libraries (MapLibre GL, PMTiles, Turf.js, etc.)
- `fonts/`: Local font files in PBF format for map text rendering
- `tiles/nj-complete.pmtiles`: Complete New Jersey map data (116MB)

### Key Features
- **Territory Control**: Click buildings to claim them for your gang
- **Population Analysis**: Real-time calculation based on building footprints
- **Resource Management**: Income generation tied to controlled territories
- **3D Visualization**: Buildings rendered with realistic heights
- **Offline First**: No internet connection required after initial setup

## How to Run the Project

This is a completely offline application with no build process required.

1. **No internet connection needed** - all assets are local
2. **Start a local web server** in the project directory:
   ```bash
   python -m http.server 8000
   ```
   Or use any other local server (Live Server extension in VS Code, etc.)
3. **Open your browser** to `http://localhost:8000`
4. **Start playing** - click buildings to claim territory and build your gang

## Technical Evolution

The project has evolved through several phases:

1. **Online Prototype**: Originally used Carto CDN and Overpass API for live data
2. **Hybrid Approach**: Migrated to local PMTiles for building data while keeping online base map
3. **Full Offline**: Complete migration to local assets including:
   - Local PMTiles data for all map layers
   - Local JavaScript libraries
   - Local font files
   - Removed sprite dependencies (not needed)
   - Clean error handling for missing tiles

## Performance & Data

- **Map Data Size**: 116MB for complete New Jersey coverage
- **Zoom Levels**: Supports zoom levels 0-14 with detailed building data
- **Coverage Area**: All of New Jersey with building heights, roads, water, and terrain
- **Load Time**: Fast initial load due to local assets
- **Memory Usage**: Efficient vector tile rendering with on-demand loading

## Next Steps

The project is ready for the next phase of development:

1. **Backend Development**:
   - Node.js server with PostgreSQL + PostGIS
   - Real-time multiplayer functionality
   - Persistent territory ownership

2. **Additional Regions**:
   - Expand beyond New Jersey using the same PMTiles approach
   - Multi-region gameplay mechanics

3. **Enhanced Features**:
   - Combat system between gangs
   - Resource trading and economics
   - Strategic alliance mechanics

The offline foundation is solid and ready to support multiplayer backend integration.