# Architecture

## Overview

Real-Earth Street War uses a server-authoritative multiplayer model. The browser captures input and renders replicated state; the Node.js server runs game simulation and broadcasts snapshots.

```text
Browser client -- WebSocket --> server simulation
     ^                              |
     +------ state snapshots --------+
```

The codebase is an npm-workspace monorepo:

```text
client/   Browser application: Vite, TypeScript, MapLibre, bitecs
shared/   ECS components, models, collision systems, utilities
server/   WebSocket server, authoritative ECS world, NPC systems
```

The root package is a workspace coordinator, not the client package.

## Client

`client/src/main.ts` is the application wiring layer. It creates the map, input manager, HUD, controller, WebSocket client, and game loop.

### Responsibilities

- Capture keyboard and pointer input in `input/InputManager.ts`.
- Send input and possession requests through `network/GameClient.ts`.
- Mirror server snapshots into a local ECS world through `network/NetworkStateManager.ts`.
- Render the map, entities, building selection, HUD, sprites, and camera.
- Perform no authoritative game simulation.

`ClientPrediction.ts` exists but prediction is deliberately disabled because reconciliation produced rubber-banding. Player movement is therefore snapshot-authoritative.

### Rendering

`client/src/config.ts` independently chooses player and NPC rendering paths:

- `PlayerDomView`, `PlayerCanvasView`, `PlayerWebglView`
- `NpcDomLayer`, `NpcCanvasLayer`, `NpcWebglLayer`
- `NpcWebglController` supplies WebGL NPC state and animation updates.

WebGL is intended for Mercator performance. DOM and Canvas paths work with all supported projections. NPC WebGL and Canvas paths currently use current replicated positions rather than a history-based interpolation controller.

`MapView` owns MapLibre configuration, entity/building clicks, camera coordination, building highlighting, and player positioning. It can enable local vector map data, building extrusion, and terrain. The current terrain source is remote when `SHOW_TERRAIN` is enabled.

### Client Loop

`client/src/loop/GameLoop.ts` runs three phases:

1. Fixed updates at 60 Hz for registered client systems.
2. Variable updates for animation and view work.
3. Interpolated rendering through `requestAnimationFrame`.

## Shared Package

`shared/src` is the common data and systems package, imported as `@shared/realearthstreetwar`.

- `ecs/components.ts`: position, rotation, velocity, altitude, and player marker components.
- `components/`: NPC marker and sprite-reference components.
- `model/GameState.ts`: game clock and shared constants, including the 5 m possession range.
- `systems/`: entity collision and map-building collision systems.
- `utils/`: distances and spatial grid support.

Client and server create separate bitecs worlds. Component definitions are shared, but component storage and entity IDs are local to each process.

## Server

`server/src/server.ts` creates `GameWorld`, `PlayerManager`, `ServerGameLoop`, and `WebSocketServer`.

`GameWorld` owns the authoritative ECS world and game time. It loads the PMTiles archive when present:

- `BuildingDataLoader` provides footprint geometry for building collision.
- `RoadDataLoader` provides transportation geometry for NPC road-aware steering.

If the archive cannot be found, those map-derived systems are disabled and the server logs the degraded state. The server currently searches legacy `assets/maps/tiles/nj-complete.pmtiles` paths rather than the client's public directory.

### Fixed Update Order

`GameWorld.fixedUpdate()` performs:

1. Advance game time.
2. Apply stored player input, including building collision and wall sliding.
3. Run NPC random/road-aware direction selection.
4. Prevent movement into building footprints.
5. Apply velocity movement.
6. Rebuild the spatial grid and resolve entity collisions.
7. Run corrective building collision as a safety net.

The loop targets 60 Hz. Road and building lookups are asynchronous, so actual tick performance depends on map data, cache state, and NPC population.

### NPC Behaviour

NPCs spawn around the server configuration's default center. Each has a random speed multiplier. Periodically, an NPC chooses a direction:

- With road data, it prefers the local road direction or steers toward the nearest road.
- Without usable road data, it selects a random direction.

This is a heuristic constraint system, not road-graph pathfinding.

## Protocol

Client messages:

```ts
{ type: 'input', input: InputState }
{ type: 'spawn_npc', count: number } // development-only
{ type: 'possess_entity', targetEid: number }
{ type: 'ping', timestamp: number }
```

Server messages:

```ts
{ type: 'state_snapshot', state: GameStateSnapshot, timestamp: number }
{ type: 'player_joined', playerId: string }
{ type: 'player_left', playerId: string }
{ type: 'possession_transferred', playerId: string, newEntityId: number, oldEntityId: number }
{ type: 'possession_failed', reason: string }
{ type: 'pong', timestamp: number }
{ type: 'error', message: string }
```

The server broadcasts state snapshots at a target 60 Hz. Possession is server-validated: targets must exist, may not belong to another player, and must be within `GameStateConstants.POSSESSION_RANGE_METERS` (5 m).

## State and Reconnection

The client reconnects with limited exponential backoff. The current server reconnection mapping is not durable identity/session restoration and is suitable only for prototype or single-player-oriented use. Do not treat it as robust multiplayer account support.

## Map Data

The local vector style expects `public/assets/maps/tiles/nj-complete.pmtiles`. The server currently searches separate legacy `assets/maps/tiles/nj-complete.pmtiles` paths, so its map-data path must be aligned before one archive can enable both processes. The active expansion metadata describes a New Jersey region in `config/expansion-packs.json`.

Offline support applies to the vector basemap when this archive is installed. Terrain uses a remote DEM source by default and must be disabled or replaced for a fully offline deployment.

## Production Limitations

The server lacks authentication, authorization, rate limiting, transport security configuration, and input-hardening suitable for a public deployment. `spawn_npc` is unrestricted debug functionality. Production hosting must also preserve the cross-origin-isolation headers configured for Vite.
