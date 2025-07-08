# Real-Earth Street War

## Project Overview

**Real-Earth Street War** is a web-based strategy game prototype inspired by the classic board game *Risk*. The game uses a 1:1 representation of real Earth, where players control territories by placing headquarters and expanding their influence across real-world streets and buildings.

The game features:
- **Real-world map data** with authentic building heights and street layouts
- **Territory control mechanics** with visual influence areas
- **Player character movement** with WASD-style controls
- **Strategic HQ placement** with different types (producers, traffickers, retailers)
- **Complete offline operation** using local map data

## Current Implementation Status

This repository contains a **TypeScript-based web application** with a modern development workflow. The current implementation includes:

### ✅ Implemented Features
- **Player Character System**: Real-time movement with arrow key controls and rotation
- **HQ Placement Mechanics**: Three types of headquarters with location-based placement rules
- **Territory Visualization**: Dynamic influence areas using geospatial calculations
- **Real-time Game Clock**: Time-based progression with configurable tick system
- **Interactive Map**: 3D building rendering with zoom-responsive UI elements
- **Complete Offline Operation**: 116MB New Jersey dataset with all map layers

### 🚧 In Development
- Resource generation and economic systems
- Combat mechanics between players
- Multiplayer backend integration
- Additional regions beyond New Jersey

## Technical Architecture

### Technology Stack
- **TypeScript 5.8** with strict type checking
- **Vite** for development server and production builds
- **MapLibre GL JS** for high-performance map rendering
- **PMTiles** for efficient vector tile storage and delivery
- **Turf.js** for geospatial calculations and territory management

### Project Structure
```
src/
├── controller/
│   └── GameController.ts    # Game logic and input handling
├── model/
│   └── GameState.ts         # Data model and game state
├── view/
│   └── MapView.ts           # Map rendering and UI interactions
├── types/
│   └── global.d.ts          # TypeScript type definitions
└── main.ts                  # Application entry point

Public Assets:
├── index.html               # Main application HTML
├── style.css                # UI styling and layout
├── offline-map-style.json   # MapLibre map style definition
├── icons/                   # SVG icons for HQ types
├── fonts/                   # Local font files (PBF format)
├── libs/                    # Local JavaScript libraries
└── map_data/                # PMTiles map data (116MB)
```

### Architecture Pattern
The application follows a **Model-View-Controller (MVC)** architecture:

- **GameState** (Model): Manages player data, HQ locations, territory ownership, and game progression
- **MapView** (View): Handles map rendering, UI interactions, and visual feedback
- **GameController** (Controller): Coordinates game logic, input handling, and updates between model and view

## Getting Started

### Prerequisites
- **Node.js** 18+ and npm
- A modern web browser with WebGL support
- ~200MB disk space for map data and dependencies

### Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd RealEarthStreetWar
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Development mode**
   ```bash
   npm run dev
   ```
   This starts the Vite development server at `http://localhost:5173`

4. **Production build**
   ```bash
   npm run build
   ```
   Creates optimized files in the `dist/` directory

5. **Type checking**
   ```bash
   npm run typecheck
   ```

### Map Data Setup
The game includes complete New Jersey map data in PMTiles format:
- **File**: `map_data/tiles/nj-complete.pmtiles` (116MB)
- **Coverage**: All of New Jersey with buildings, roads, water, and terrain
- **Zoom levels**: 0-14 with detailed building data
- **Source**: Generated from OpenStreetMap using Planetiler

## How to Play

### Controls
- **Arrow Keys**: Move player character
  - ↑/↓: Forward/backward movement
  - ←/→: Rotate left/right
  - Shift + ←/→: Strafe left/right

### Gameplay
1. **Place Headquarters**: Use the control panel buttons to place different HQ types:
   - **Producers** (Farms): Must be placed on buildings
   - **Traffickers**: Must be placed on roads or rivers
   - **Retailers** (Dealers): Must be placed on buildings

2. **Expand Territory**: Each HQ creates an influence area that merges with your existing territory

3. **Manage Resources**: Track your commodities, money, and territory expansion over time

## Data Sources & Technical Details

### Map Data Generation
- **Source**: OpenStreetMap via Planetiler
- **Profile**: OpenMapTiles schema
- **Command**: 
  ```bash
  docker run --rm -it -v ${PWD}:/data ghcr.io/onthegomap/planetiler:latest \
    --download=true \
    --osm-path=/data/new-jersey-latest.osm.pbf \
    --output=/data/nj-complete.pmtiles \
    --output-format=pmtiles
  ```

### Performance Characteristics
- **Initial Load**: Fast startup due to local assets
- **Memory Usage**: Efficient vector tile streaming
- **Map Data**: 116MB compressed PMTiles file
- **Frame Rate**: 60fps movement with smooth map interactions

## Development

### Key Dependencies
```json
{
  "dependencies": {
    "@turf/turf": "^7.2.0"
  },
  "devDependencies": {
    "@types/maplibre-gl": "^1.14.0",
    "@types/node": "^24.0.7",
    "typescript": "^5.8.3",
    "vite": "^5.4.19"
  }
}
```

### File Organization
- **TypeScript Source**: All game logic in `src/` with strict typing
- **Local Libraries**: Offline copies in `libs/` (MapLibre, PMTiles, Turf)
- **Assets**: Icons, fonts, and styles for complete offline operation
- **Map Data**: PMTiles format for efficient vector tile delivery

### Build Configuration
- **Target**: ES2020 for modern browser features
- **Module**: ES2020 modules with bundler resolution
- **Output**: Clean distribution build in `dist/` directory
- **Type Checking**: Strict TypeScript with comprehensive error checking

## Planned Features

### Near-term Development
1. **Resource Economics**: Implement commodity generation and trading
2. **Combat System**: Player vs player territory conflicts  
3. **Backend Integration**: Real-time multiplayer with persistence
4. **Mobile Support**: Touch controls and responsive design

### Expansion Roadmap
The `expansion-packs.json` file outlines planned regions:
- **New York City**: Manhattan, Brooklyn, Queens, Bronx, Staten Island (~200MB)
- **Philadelphia Metro**: Philadelphia and surrounding counties (~150MB)  
- **Greater Boston**: Boston metropolitan area (~120MB)

### Technical Evolution
- **Multi-region Support**: Seamless switching between geographic areas
- **Plugin Architecture**: Modular system for expansion packs
- **Performance Optimization**: Streaming and caching for larger datasets
- **Advanced Features**: Real-time collaboration, alliance systems, economic modeling

## Contributing

### Development Workflow
1. Use `npm run typecheck` for continuous type checking
2. Follow the MVC architecture patterns established in the codebase
3. Maintain strict TypeScript typing (avoid `any` types)
4. Test with both development and production builds

### Code Style
- **Interfaces**: Clear separation between model, view, and controller
- **Type Safety**: Comprehensive TypeScript definitions
- **Modularity**: Small, focused classes and functions
- **Documentation**: Clear comments for complex geospatial operations

## License

ISC License - See package.json for details.

---

**Note**: This project represents a sophisticated foundation for a real-world strategy game. The offline-first architecture and authentic geographic data provide a unique gaming experience grounded in real geography.