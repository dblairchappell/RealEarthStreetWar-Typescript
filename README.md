# Real-Earth Street War

A web-based strategy game prototype that uses real-world map data for territory control gameplay. Fight to capture and control real streets, buildings, and territories in an authentic 1:1 representation of Earth.

## 🎮 Game Features

- **Real-World Maps**: Authentic building heights and street layouts using OpenStreetMap data
- **Territory Control**: Expand your influence by placing headquarters strategically  
- **Player Movement**: WASD-style character controls with 8-directional movement and running
- **Strategic Gameplay**: Three HQ types with location-based placement rules
- **Complete Offline Play**: 116MB New Jersey dataset with all map layers included

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Modern web browser with WebGL support
- ~200MB disk space

### Installation
```bash
git clone <repository-url>
cd RealEarthStreetWar
npm install
npm run dev
```

Visit `http://localhost:5173` to start playing!

### Controls
- **Arrow Keys**: Move character (↑↓←→)
- **Shift + ←/→**: Strafe left/right  
- **Double-tap ↑**: Run
- **A/D**: Rotate camera 45°
- **W/S**: Zoom in/out

### Gameplay
1. **Place HQs**: Click the control panel buttons then click on the map
   - **Producers**: Must be on buildings
   - **Traffickers**: Must be on roads/rivers
   - **Retailers**: Must be on buildings
2. **Expand Territory**: Each HQ creates influence areas that merge
3. **Manage Resources**: Watch your stats grow over time

## 🛠 Development

```bash
# Development server
npm run dev

# Production build  
npm run build

# Type checking
npm run typecheck
```

## 📚 Documentation

Detailed technical documentation is available in the `/docs` folder:

- [Architecture Overview](docs/architecture.md) - Code structure and design patterns
- [Input System](docs/input-system.md) - Keyboard handling and controls
- [View Layer](docs/view-layer.md) - Rendering and UI components  
- [Map Data](docs/map-data.md) - PMTiles generation and format details
- [Development Guide](docs/development.md) - Contributing and extending the game

## 🗺 Current Coverage

- **New Jersey**: Complete dataset with buildings, roads, water (116MB)
- **Planned Expansions**: NYC, Philadelphia, Boston (see `expansion-packs.json`)

## 🎯 Status

**Current**: Fully functional single-player prototype with movement, territory control, and resource management.

**Planned**: Multiplayer backend, combat mechanics, economic systems, mobile support.

---

Built with TypeScript, Vite, MapLibre GL JS, and PMTiles.