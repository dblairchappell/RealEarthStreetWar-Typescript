# Real-Earth Street War

A top-down GTA1-style game prototype set on a real-world map. Players explore and interact with NPCs in a server-authoritative multiplayer simulation.

## 🎮 Current Features

- **Real-World Maps**: Authentic street layouts using MapLibre GL JS with offline PMTiles support
- **Server-Authoritative Simulation**: NPCs and game state managed by the server
- **Player Movement**: WASD-style character controls with smooth movement and sprite animations
- **NPC Simulation**: Server-controlled NPCs that walk around the map with collision detection
- **Time Progression**: In-game time advances at 60x speed (1 game minute = 1 real second) with timezone-aware display (uses `tz-lookup` based on lat/lng)
- **Multiplayer-Ready**: WebSocket-based client-server architecture (60Hz state broadcasts)
- **Advanced Camera**: Continuous zoom/rotation/pan controls with camera following
- **Multiple Projections**: Support for Mercator, Globe, and Vertical-Perspective projections
- **Performance Tools**: Built-in performance overlay for FPS and frame time monitoring
- **Sprite System**: Animated character sprites with idle/walking/running states

## 🏗️ Architecture

This project uses **npm workspaces** with three packages:

- **Root Package**: Client application (browser-based)
- **`shared/`**: Shared code between client and server (ECS components, models, systems, utilities)
- **`server/`**: Game server (Node.js with WebSocket)

### Key Technologies

- **Client**: TypeScript, Vite, MapLibre GL JS
- **Server**: Node.js, TypeScript, WebSocket (ws)
- **ECS**: bitecs (Entity Component System)
- **Shared Code**: npm workspaces for code reuse

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Modern web browser with WebGL support

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd RealEarthStreetWar

# Install all dependencies (workspace packages)
npm install
```

### Running the Game

**Terminal 1 - Start the server:**
```bash
cd server
npm run dev
```

The server will start on `ws://localhost:8080` (or the port specified in `PORT` environment variable).

**Terminal 2 - Start the client:**
```bash
# From project root
npm run dev
```

Visit `http://localhost:5173` to start playing!

### Controls

- **Arrow Keys**: Move character (↑↓←→)
- **Shift + ←/→**: Rotate character left/right
- **Double-tap ↑**: Run
- **W/S**: Continuous zoom in/out (with acceleration)
- **A/D**: Continuous camera rotation left/right (with acceleration)
- **Q/E**: Continuous camera pan left/right
- **R/F**: Continuous camera pan up/down
- **Shift + C**: Toggle camera follow lock

## 📁 Project Structure

```
RealEarthStreetWar/
├── shared/                 # Shared package (npm workspace)
│   ├── src/
│   │   ├── components/    # ECS components (NpcTag, SpriteRef)
│   │   ├── ecs/           # ECS component definitions (Position, Rotation, Velocity, PlayerTag)
│   │   ├── input/         # Input types (InputState)
│   │   ├── model/         # Game state models (GameState)
│   │   ├── systems/       # ECS systems (collisionSystem)
│   │   └── utils/         # Utilities (SpatialGrid)
│   └── package.json
│
├── server/                 # Server package (npm workspace)
│   ├── src/
│   │   ├── game/          # Game world and systems
│   │   ├── network/       # WebSocket server
│   │   ├── players/       # Player management
│   │   └── server.ts      # Entry point
│   └── package.json
│
├── src/                    # Client application
│   ├── controller/        # Game controller (MVC)
│   ├── debug/             # Debug tools (PerfOverlay)
│   ├── ecs/               # Client ECS world instance
│   ├── input/             # Input handling
│   ├── loop/              # Game loop
│   ├── model/             # (deprecated - use shared)
│   ├── network/           # WebSocket client
│   ├── view/              # Rendering and UI
│   │   ├── map/           # Map components (CameraController, FeatureQuery, MarkerLayer)
│   │   ├── CharacterView.ts  # Player sprite rendering
│   │   ├── HUDView.ts     # UI and HUD
│   │   ├── MapView.ts     # Main map view
│   │   ├── NpcLayer.ts    # Canvas NPC rendering (globe fallback)
│   │   ├── NpcInstancedLayer.ts  # WebGL NPC rendering (Mercator)
│   │   └── NpcController.ts  # NPC interpolation controller
│   └── main.ts            # Entry point
│
└── package.json            # Root workspace config
```

## 🛠️ Development

### Type Checking

```bash
# Check all packages
npm run typecheck

# Check specific package
cd server && npm run typecheck
cd shared && npm run typecheck
```

### Building

```bash
# Build client
npm run build

# Build server
cd server && npm run build
```

### Workspace Management

Since this project uses npm workspaces, dependencies are managed at the root:

```bash
# Install a dependency for the client
npm install <package> --workspace=.

# Install a dependency for the server
npm install <package> --workspace=server

# Install a dependency for shared
npm install <package> --workspace=shared
```

## 📚 Documentation

- [Architecture Overview](docs/architecture.md) - System architecture and design patterns
- [Development Guide](docs/development.md) - Contributing and extending the game
- [Server Documentation](server/README.md) - Server setup and API

## 🎯 Current Status

**Implemented:**
- ✅ Server-authoritative game state
- ✅ Player movement synchronization (60Hz server, 60Hz client broadcasts)
- ✅ NPC spawning and simulation with collision detection
- ✅ Time progression system with timezone-aware display
- ✅ WebSocket client-server communication
- ✅ Shared code package (npm workspaces)
- ✅ Sprite animation system (idle/walking/running)
- ✅ Advanced camera controls (zoom/rotation/pan)
- ✅ Multiple map projections (Mercator/Globe/Vertical-Perspective)
- ✅ Dual NPC rendering paths (WebGL for Mercator, Canvas for Globe)
- ✅ Performance monitoring overlay
- ✅ Offline map support (PMTiles)
- ✅ Server config hot-reload

**Planned:**
- 🔲 Gameplay mechanics (HQ placement, territory control)
- 🔲 Resource management
- 🔲 Combat system
- 🔲 Multiplayer features

## 🔧 Configuration

### Server Configuration

Edit `server/src/config.ts`:

```typescript
export const ServerConfig = {
  NPC_COUNT: 10,              // Number of NPCs to spawn
  DEFAULT_SPAWN_CENTER: {     // Default spawn location
    lng: -74.05682,           // NYC coordinates
    lat: 40.69337,
  },
  NPC_SPAWN_RADIUS: 0.0001,   // Spawn radius in degrees
  PORT: 8080,                 // Server port
};
```

### Client Configuration

Edit `src/config.ts`:

```typescript
// Visual style
export const GTA1_STYLE_TOP_DOWN = true;   // Toggle top-down vs 3D angled view
export const ENABLE_GLOBE = true;           // Enable globe projection mode
export const MAP_PROJECTION: 'mercator' | 'globe' | 'vertical-perspective' = 'mercator';

// Debug tools
export const SHOW_PERF_OVERLAY = true;      // Show performance overlay (FPS, frame time)
export const SHOW_COLLISION_BOUNDS = false; // Show collision circles around NPCs

// Network
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8080';
```

## 🐛 Troubleshooting

**Server won't start:**
- Check if port 8080 is available
- Verify `npm install` completed successfully
- Check server logs for errors

**Client can't connect:**
- Ensure server is running first
- Check `SERVER_URL` in `src/config.ts` matches server port
- Check browser console for WebSocket errors

**Type errors:**
- Run `npm install` to ensure workspace linking is correct
- Verify TypeScript path mappings in `tsconfig.json` and `server/tsconfig.json`

## 📄 License

ISC

---

Built with TypeScript, Vite, MapLibre GL JS, bitecs, and npm workspaces.
