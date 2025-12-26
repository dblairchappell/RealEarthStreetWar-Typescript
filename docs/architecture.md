# Architecture Overview

Real-Earth Street War uses a **server-authoritative multiplayer architecture** with a **monorepo structure** managed by npm workspaces.

## 🏗️ High-Level Architecture

```
┌─────────────┐         WebSocket          ┌─────────────┐
│   Client    │◄──────────────────────────►│   Server    │
│  (Browser)  │      (60Hz snapshots)      │  (Node.js)  │
└─────────────┘                             └─────────────┘
      │                                             │
      │ ECS World Instance                         │ ECS World Instance
      │ (for rendering)                            │ (authoritative)
      │                                             │
      └─────────────────────────────────────────────┘
                    Shared Package (@shared/realearthstreetwar)
                    (Components, Models, Systems, Utils)
```

## 📦 Monorepo Structure

The project uses **npm workspaces** to manage three packages:

### 1. Root Package (Client)
- **Location**: `./`
- **Purpose**: Browser-based game client
- **Tech**: Vite, TypeScript, MapLibre GL JS
- **Entry**: `src/main.ts`

### 2. Shared Package
- **Location**: `./shared`
- **Package Name**: `@shared/realearthstreetwar`
- **Purpose**: Code shared between client and server
- **Contents**:
  - ECS component definitions (Position, Rotation, Velocity, PlayerTag, NpcTag, SpriteRef)
  - Game state models (GameState, PlayerCharacter)
  - Input types (InputState)
  - ECS systems (collisionSystem)
  - Utilities (SpatialGrid)

### 3. Server Package
- **Location**: `./server`
- **Package Name**: `realearthstreetwar-server`
- **Purpose**: Authoritative game server
- **Tech**: Node.js, TypeScript, WebSocket (ws), bitecs
- **Entry**: `src/server.ts`

## 🎮 Client Architecture

The client follows **MVC (Model-View-Controller)** pattern:

```
src/
├── main.ts                 # Application bootstrap
├── controller/
│   └── GameController.ts  # Coordinates game logic
├── debug/
│   └── PerfOverlay.ts     # Performance monitoring overlay
├── view/
│   ├── MapView.ts         # Main map view and coordination
│   ├── CharacterView.ts   # Player sprite rendering and animation
│   ├── HUDView.ts         # UI and HUD
│   ├── NpcLayer.ts        # Canvas NPC rendering (globe fallback)
│   ├── NpcInstancedLayer.ts  # WebGL NPC rendering (Mercator)
│   ├── NpcController.ts   # NPC interpolation and data management
│   └── map/               # Map-specific components
│       ├── CameraController.ts  # Camera following, zoom, rotation
│       ├── FeatureQuery.ts      # Map feature queries (buildings, transport)
│       └── MarkerLayer.ts       # Map markers
├── network/
│   ├── GameClient.ts      # WebSocket client
│   ├── NetworkStateManager.ts  # Syncs server state to client ECS
│   └── ClientPrediction.ts     # Client-side prediction (currently disabled)
├── ecs/
│   └── world.ts           # Client ECS world instance
├── input/
│   ├── InputManager.ts    # Keyboard input handling
│   └── IInputService.ts   # Input service interface
└── loop/
    └── GameLoop.ts        # Variable-timestep game loop
```

### Client-Side ECS

The client maintains its **own ECS World instance** for rendering:

- **Purpose**: Display server state visually
- **World Instance**: Created in `src/ecs/world.ts`
- **Components**: Imported from `@shared/realearthstreetwar`
- **No Simulation**: Client does NOT run game logic (no movement systems, no collision)

**Key Point**: The client's World is a **mirror** of server state, updated via snapshots.

## 🖥️ Server Architecture

The server is **authoritative** - it owns all game state:

```
server/src/
├── server.ts              # Entry point
├── game/
│   ├── GameWorld.ts      # Authoritative game state + ECS world
│   ├── GameLoop.ts       # Fixed-timestep loop (60Hz)
│   └── systems/          # Server-side ECS systems
│       ├── movementSystem.ts
│       └── randomWalkSystem.ts
├── network/
│   ├── WebSocketServer.ts  # WebSocket handling
│   └── types.ts            # Message type definitions
└── players/
    └── PlayerManager.ts    # Player connection management
```

### Server-Side ECS

The server maintains the **authoritative ECS World**:

- **Purpose**: Run all game simulation
- **World Instance**: Created in `GameWorld.ts`
- **Components**: Imported from `@shared/realearthstreetwar`
- **Systems**: Movement, collision, NPC AI

**Key Point**: The server's World is the **source of truth** for all game state.

## 🔄 Data Flow

### 1. Input Flow (Client → Server)

```
User Input → InputManager → GameClient → WebSocket → Server
```

1. User presses keys
2. `InputManager` captures input
3. `GameClient` sends `{ type: 'input', input: InputState }` to server
4. Server receives input and processes movement

### 2. State Sync Flow (Server → Client)

```
Server ECS → GameWorld → Snapshot → WebSocket → NetworkStateManager → Client ECS
```

1. Server runs simulation (60Hz fixed timestep)
2. `GameWorld` creates state snapshot
3. `WebSocketServer` broadcasts snapshot at 60Hz: `{ type: 'state_snapshot', state: GameStateSnapshot }`
4. `NetworkStateManager` applies snapshot to client ECS world
5. Client renders updated state with interpolation

### 3. Rendering Flow (Client)

```
Client ECS → NetworkStateManager → GameState → Views → Screen
```

1. Client ECS world updated from snapshot
2. `NetworkStateManager` syncs game time to `GameState` model
3. Views read directly from ECS components:
   - `MapView` queries ECS for player/NPC positions
   - `CharacterView` reads player Position/Rotation from ECS
   - `NpcController` reads NPC positions from ECS and interpolates
   - `HUDView` reads game time from `GameState`
4. Rendering updates with interpolation for smooth visuals

## 🧩 Entity Component System (ECS)

### Component Definitions (Shared)

Components are **defined once** in `shared/src/ecs/components.ts`:

```typescript
export const Position = defineComponent({ x: Types.f64, y: Types.f64 }); // x = lng, y = lat
export const Rotation = defineComponent({ angle: Types.f32 }); // degrees (0 = north)
export const Velocity = defineComponent({ x: Types.f64, y: Types.f64 }); // degrees/second
export const PlayerTag = defineComponent(); // Marker component
export const NpcTag = defineComponent(); // Marker component
export const SpriteRef = defineComponent({ id: Types.ui16 }); // Sprite ID for rendering
```

**Component Usage**:
- `Position`: Stores longitude (x) and latitude (y) in degrees
- `Rotation`: Stores rotation angle in degrees (0° = north, 90° = east)
- `Velocity`: Stores velocity in degrees per second
- `SpriteRef`: Stores sprite ID (ui16) for selecting which sprite to render
- `PlayerTag` / `NpcTag`: Marker components for entity identification
  - Entities can switch between these tags during possession transfer
  - Server transfers `PlayerTag` from old entity to new entity
  - Client mirrors this change in its ECS world

### World Instances (Separate)

Each side creates its **own World instance**:

**Client** (`src/ecs/world.ts`):
```typescript
export const world = createWorld();  // Client's world
```

**Server** (`server/src/game/GameWorld.ts`):
```typescript
public readonly world = createWorld();  // Server's world
```

### Why Separate Worlds?

- **Different Entity IDs**: Server assigns ID 5, client might assign ID 2
- **Different Lifecycles**: Server creates NPCs, client receives them later
- **Different Data**: Server calculates positions, client displays them
- **Separation of Concerns**: Server simulates, client renders

**Important**: Components are **shared** (same structure), but each World has **separate storage arrays**.

## 🔌 Network Protocol

### Client → Server Messages

```typescript
type ClientMessage =
  | { type: 'input'; input: InputState }
  | { type: 'spawn_npc'; count: number }
  | { type: 'possess_entity'; targetEid: number }
  | { type: 'ping'; timestamp: number };
```

### Server → Client Messages

```typescript
type ServerMessage =
  | { type: 'state_snapshot'; state: GameStateSnapshot; timestamp: number }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'possession_transferred'; playerId: string; newEntityId: number; oldEntityId: number }
  | { type: 'possession_failed'; reason: string }
  | { type: 'pong'; timestamp: number }
  | { type: 'error'; message: string };
```

### State Snapshot Format

```typescript
interface GameStateSnapshot {
  gameDate: string;        // ISO string
  players: PlayerSnapshot[];
  npcs: NpcSnapshot[];
}
```

## ⚙️ Game Loop

### Server Loop (60Hz Fixed Timestep)

```typescript
// server/src/game/GameWorld.ts
fixedUpdate() {
  // 1. Advance game time
  // 2. Process player movement based on stored input
  // 3. Run NPC AI (randomWalkSystem)
  // 4. Apply movement (movementSystem)
  // 5. Rebuild spatial grid
  // 6. Handle collisions (entityCollisionSystem)
}

// server/src/network/WebSocketServer.ts
// Broadcasts state snapshots at 60Hz (separate from game loop)
startBroadcasting() {
  setInterval(() => {
    const snapshot = gameWorld.createSnapshot();
    broadcastState(snapshot);
  }, 1000 / 60); // 60Hz
}
```

### Client Loop (Variable Timestep)

```typescript
// src/loop/GameLoop.ts
update(deltaMs: number) {
  // 1. Render interpolation
  // 2. Update views
  // 3. Handle input
}
```

## 🎨 Rendering System

### View Components

The client uses a modular view system with specialized components:

**MapView** (`src/view/MapView.ts`):
- Main orchestrator for all visual elements
- Manages MapLibre GL map instance
- Coordinates sub-components (CharacterView, CameraController, etc.)
- Handles map events (clicks, drags, zoom)
- Manages player entity tracking and interpolation state
- Resets interpolation state on possession transfer for smooth movement

**CharacterView** (`src/view/CharacterView.ts`):
- Player sprite rendering and animation
- Sprite sheet animation system (idle/walking/running)
- Pseudo-3D effect with slice stacking (when not top-down)
- Zoom-based sprite scaling
- Camera-relative rotation

**CameraController** (`src/view/map/CameraController.ts`):
- Camera following player
- Continuous zoom/rotation/pan with acceleration
- Camera lock/unlock functionality
- Smooth camera transitions

**NPC Rendering** (dual-path system):
- **NpcInstancedLayer**: WebGL-based instanced rendering for Mercator projection
  - Uses WebGL point sprites
  - Single draw call for all NPCs
  - High performance (1000+ NPCs at 60fps)
- **NpcLayer**: Canvas-based rendering for Globe projection
  - Fallback when `ENABLE_GLOBE = true`
  - Uses `map.project()` for coordinate conversion
  - Slower but works with any projection

**NpcController** (`src/view/NpcController.ts`):
- Handles NPC interpolation between snapshots
- Maintains position history for smooth rendering
- Converts lat/lng to screen coordinates
- Passes data to rendering layer

**Other Components**:
- **EntityClickHandler** (`src/view/EntityClickHandler.ts`):
  - Detects clicks on entities (player's current body or NPCs)
  - Calculates distances between entities
  - Triggers callbacks for entity interactions
  - Uses ECS queries and map projection for accurate click detection
- **HUDView** (`src/view/HUDView.ts`):
  - Displays game time and stats
  - Shows entity info panels (occupant info, NPC info)
  - Manages possession and command UI
  - Handles panel visibility and range checking
- **FeatureQuery**: Queries map features (buildings, transport) at click points
- **MarkerLayer**: Manages map markers
- **PerfOverlay**: Performance monitoring (FPS, frame time, CPU)

### Sprite Animation System

The game uses a sprite sheet animation system:

- **Animation States**: idle, walking, running
- **Frame Timing**: Uses accumulator pattern for consistent frame rates
- **Sprite Sheets**: Located in `sprites/brian/` directory
- **Animation Switching**: Automatically based on movement state
- **Pseudo-3D**: Multiple sprite slices stacked for depth (when not top-down)

### Map Projections

The game supports multiple map projections:

- **Mercator** (default): Flat map, best performance, WebGL NPC rendering
- **Globe**: 3D sphere view, accurate sizes, Canvas NPC rendering fallback
- **Vertical-Perspective**: 3D perspective view (experimental)

Projection is configured via `MAP_PROJECTION` in `src/config.ts`.

### Offline Map Support

The game uses **PMTiles** protocol for offline map tiles:
- Single-file format for efficient tile storage
- Map style: `offline-map-style.json`
- Tile data: `map_data/tiles/nj-complete.pmtiles`
- Protocol registered with MapLibre GL JS

## 🎯 Design Principles

### 1. Server Authority
- **All game logic** runs on the server
- Client is **display-only** (no simulation)
- Server sends **authoritative snapshots**

### 2. Shared Code
- **Single source of truth** for components, models, systems
- No code duplication between client/server
- Changes to shared code affect both sides

### 3. Separation of Concerns
- **Client**: Rendering, input capture, UI
- **Server**: Simulation, game logic, state management
- **Shared**: Data structures, component definitions

### 4. Type Safety
- TypeScript throughout
- Shared types ensure client/server compatibility
- Path mappings resolve workspace packages correctly

## 🔧 Extension Points

### Adding New Components

1. **Define in shared**: `shared/src/ecs/components.ts`
2. **Export**: Add to `shared/src/index.ts`
3. **Use on server**: Import from `@shared/realearthstreetwar`
4. **Use on client**: Import from `@shared/realearthstreetwar`

### Adding New Systems

1. **Create in shared**: `shared/src/systems/` (if used by both)
2. **Or create server-only**: `server/src/game/systems/`
3. **Add to GameWorld**: Call in `fixedUpdate()`

### Adding New Models

1. **Create in shared**: `shared/src/model/`
2. **Export**: Add to `shared/src/index.ts`
3. **Use**: Import from `@shared/realearthstreetwar`

## 📊 Performance Considerations

### Server
- **Fixed timestep**: 60Hz ensures deterministic simulation
- **Broadcast rate**: 60Hz for responsive state updates
- **Spatial grid**: Efficient collision detection (O(n) instead of O(n²))
- **Hot-reload**: Config file watching for NPC count changes

### Client
- **Render interpolation**: Smooth visuals between snapshots (NpcController)
- **Dual rendering paths**: 
  - WebGL instanced rendering (`NpcInstancedLayer`) for Mercator projection
  - Canvas overlay (`NpcLayer`) for Globe projection
- **Sprite animations**: Frame-based animation system with accumulator pattern
- **Performance overlay**: Built-in FPS and frame time monitoring
- **Minimal computation**: No game logic, just display and interpolation

## 🚀 Future Architecture Improvements

- **Delta compression**: Send only changed entities
- **Client-side prediction**: Code exists but currently disabled (see `ClientPrediction.ts`)
  - Full reconciliation system implemented with smooth correction
  - Three-tier error handling (tiny/medium/catastrophic)
  - Disabled to prevent rubber-banding issues
- **Interpolation**: Already implemented in `NpcController` for NPCs and `MapView` for player
- **Command System**: Issue commands to NPCs when vacating bodies (planned)
- **Chunking**: Load map regions on-demand
- **Caching**: Cache snapshots for reconnection
- **Input buffering**: Queue inputs for reconciliation with server state

## 🎮 Possession System

The game features a **possession system** that allows players to transfer control between entities:

### How It Works

1. **Player starts** with control of an initial body (spawned as a player entity)
2. **Click on NPC** within 50 meters to view info and possess
3. **Click "Possess Body"** button in HUD to transfer control
4. **Server transfers** `PlayerTag` from old entity to new entity
5. **Old body becomes NPC** (receives `NpcTag` and starts wandering)
6. **New body becomes player** (receives `PlayerTag` and responds to input)

### Implementation Details

**Server-Side** (`server/src/game/GameWorld.ts`):
- `transferPossession()` validates distance and transfers tags
- Resets velocity for both entities to prevent drift
- Updates `playerEntities` mapping

**Client-Side** (`src/network/NetworkStateManager.ts`):
- `transferPlayerEntity()` mirrors server tag changes
- Maps server entity IDs to client entity IDs
- Maintains reverse mapping for click detection

**Visual Feedback**:
- **Green outline**: Current possessed body (via CSS class `possessed-body`)
- **Red outline**: Selected NPC (rendered by `NpcLayer`)

**Interpolation Handling** (`src/view/MapView.ts`):
- `resetInterpolationState()` clears `prevPosition` on possession transfer
- Prevents jittery movement by skipping interpolation on first frame
- Matches behavior of initial character creation

### Network Messages

**Client → Server**:
```typescript
{ type: 'possess_entity'; targetEid: number }
```

**Server → Client**:
```typescript
{ type: 'possession_transferred'; playerId: string; newEntityId: number; oldEntityId: number }
{ type: 'possession_failed'; reason: string }
```

### Range and Validation

- **Possession Range**: 50 meters (0.0005 degrees)
- **Validation**: Server checks distance, entity existence, and prevents possessing other players
- **Visual Range Indicator**: HUD shows distance and enables/disables possess button

## 🌍 Timezone Support

The game uses `tz-lookup` library for timezone-aware time display:
- Game time is stored in UTC
- Display time is converted based on player's geographic location (lat/lng)
- HUD shows local time for the current map position
- Timezone lookup happens automatically via `tzLookup(lat, lng)`
