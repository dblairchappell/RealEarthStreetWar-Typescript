# Server Guide

The `server` workspace runs the authoritative Node.js game simulation and WebSocket endpoint.

## Run

From the repository root:

```bash
npm install
npm run dev --workspace=server
```

The default endpoint is `ws://localhost:8080`. Set `PORT` to override it.

```bash
PORT=8081 npm run dev --workspace=server
```

## Structure

```text
server/src/
├── config.ts                 # NPC and port configuration
├── data/                     # PMTiles building and road data loaders
├── game/                     # ECS world, loop, movement, NPC systems
├── network/                  # WebSocket server and protocol types
├── players/                  # Connections and current input state
└── server.ts                 # Process entry point
```

Shared components, state, collisions, and utilities are imported from the `shared` workspace as `@shared/realearthstreetwar`.

## Configuration

`server/src/config.ts` currently sets:

```ts
NPC_COUNT: 251
DEFAULT_SPAWN_CENTER: { lng: -74.05682, lat: 40.69337 }
NPC_SPAWN_RADIUS: 0.001
PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080
```

The process watches `config.ts`; changing `NPC_COUNT` adjusts the current NPC population.

## Simulation

The server targets a fixed 60 Hz loop. On each update it advances game time, processes player input, selects NPC directions, prevents building entry, moves entities, resolves entity collisions, and applies a final building-collision correction.

NPC movement is heuristic. NPCs prefer road geometry from the local PMTiles file when available; otherwise they wander randomly. It is not pathfinding.

## Map Archive

The server searches for `nj-complete.pmtiles` in locations relative to its working directory and source tree, including:

```text
assets/maps/tiles/nj-complete.pmtiles
```

This differs from the browser's `public/assets/maps/tiles/nj-complete.pmtiles` path and should be aligned before production use. When it cannot find the archive, the server continues without PMTiles-backed building collision and road constraints.

## Protocol

Client messages:

```ts
{ type: 'input', input: InputState }
{ type: 'spawn_npc', count: number } // debug only
{ type: 'possess_entity', targetEid: number }
{ type: 'ping', timestamp: number }
```

The server sends state snapshots at a target 60 Hz and may send player join/leave, possession result, pong, and error messages. Possession is checked server-side and requires a target within 5 m.

## Development Limitations

- `spawn_npc` has no authorization and must remain a development-only operation.
- A spawn request uses the configured default center, not the requester's current position.
- Reconnection does not use durable account/session identity.
- Authentication, authorization, rate limiting, TLS/WSS hosting, and deployment hardening are not implemented.

## Build Status

Use development mode for the current workspace setup. The current server typecheck and build are blocked by an incorrect `RoadDataLoader` import in `src/game/systems/randomWalkSystem.ts`. Before relying on `npm run build --workspace=server` for deployment, fix that error and verify the build and start path in the target environment; server and shared ESM workspace resolution requires production packaging work.
