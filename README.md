# Real-Earth Street War

A top-down GTA1-style game prototype set on a real-world map. Players explore and interact with NPCs in a server-authoritative multiplayer simulation.

## 🎮 Current Features

- **Real-World Maps**: Authentic street layouts using MapLibre GL JS
- **Server-Authoritative Simulation**: NPCs and game state managed by the server
- **Player Movement**: WASD-style character controls with smooth movement
- **NPC Simulation**: Server-controlled NPCs that walk around the map
- **Time Progression**: In-game time advances at 60x speed (1 game minute = 1 real second)
- **Multiplayer-Ready**: WebSocket-based client-server architecture

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
- **W/S**: Zoom in/out
- **A/D**: Rotate camera 45°

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
│   ├── ecs/               # Client ECS world instance
│   ├── input/             # Input handling
│   ├── loop/              # Game loop
│   ├── model/             # (deprecated - use shared)
│   ├── network/           # WebSocket client
│   ├── view/              # Rendering and UI
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
- ✅ Player movement synchronization
- ✅ NPC spawning and simulation
- ✅ Time progression system
- ✅ WebSocket client-server communication
- ✅ Shared code package (npm workspaces)

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
export const SERVER_URL = 'ws://localhost:8080';  // Server WebSocket URL
export const MAP_PROJECTION = 'mercator';          // Map projection type
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
