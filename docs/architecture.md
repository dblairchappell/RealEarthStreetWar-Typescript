# Architecture Overview

Real-Earth Street War uses a **server-authoritative multiplayer architecture** with a **monorepo structure** managed by npm workspaces.

## 🏗️ High-Level Architecture

```
┌─────────────┐         WebSocket          ┌─────────────┐
│   Client    │◄──────────────────────────►│   Server    │
│  (Browser)  │      (20Hz snapshots)      │  (Node.js)  │
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
├── view/
│   ├── MapView.ts         # Map rendering and camera
│   ├── CharacterView.ts   # Player character rendering
│   ├── HUDView.ts         # UI and HUD
│   └── NpcLayer.ts        # NPC rendering
├── network/
│   ├── GameClient.ts      # WebSocket client
│   └── NetworkStateManager.ts  # Syncs server state to client ECS
├── ecs/
│   └── world.ts           # Client ECS world instance
├── input/
│   └── InputManager.ts   # Keyboard input handling
└── loop/
    └── GameLoop.ts        # Fixed-timestep game loop
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
2. `GameWorld` creates state snapshot (20Hz)
3. Snapshot sent via WebSocket: `{ type: 'state_snapshot', state: GameStateSnapshot }`
4. `NetworkStateManager` applies snapshot to client ECS world
5. Client renders updated state

### 3. Rendering Flow (Client)

```
Client ECS → NetworkStateManager → GameState → Views → Screen
```

1. Client ECS world updated from snapshot
2. `NetworkStateManager` syncs to `GameState` model
3. Views (`MapView`, `CharacterView`, `HUDView`) read from `GameState`
4. Rendering updates

## 🧩 Entity Component System (ECS)

### Component Definitions (Shared)

Components are **defined once** in `shared/src/ecs/components.ts`:

```typescript
export const Position = defineComponent({ x: Types.f64, y: Types.f64 });
export const Rotation = defineComponent({ angle: Types.f32 });
export const Velocity = defineComponent({ x: Types.f64, y: Types.f64 });
export const PlayerTag = defineComponent();
```

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
  | { type: 'ping'; timestamp: number };
```

### Server → Client Messages

```typescript
type ServerMessage =
  | { type: 'state_snapshot'; state: GameStateSnapshot; timestamp: number }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
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
// server/src/game/GameLoop.ts
fixedUpdate() {
  // 1. Process player input
  // 2. Run NPC AI (randomWalkSystem)
  // 3. Apply movement (movementSystem)
  // 4. Handle collisions (entityCollisionSystem)
  // 5. Advance game time
  // 6. Create snapshot (every 3rd frame = 20Hz)
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
- **Snapshot rate**: 20Hz balances bandwidth and responsiveness
- **Spatial grid**: Efficient collision detection (O(n) instead of O(n²))

### Client
- **Render interpolation**: Smooth visuals between snapshots
- **Efficient rendering**: WebGL instanced rendering for NPCs
- **Minimal computation**: No game logic, just display

## 🚀 Future Architecture Improvements

- **Delta compression**: Send only changed entities
- **Client-side prediction**: Predict movement for lower latency
- **Interpolation**: Smooth position updates between snapshots
- **Chunking**: Load map regions on-demand
- **Caching**: Cache snapshots for reconnection
