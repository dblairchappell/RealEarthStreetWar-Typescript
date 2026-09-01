# Real-Earth Street War

A browser-based, real-world-map game prototype. The client renders a New Jersey map and player/NPC sprites; a Node.js WebSocket server owns the simulation and sends authoritative state snapshots.

## Current Capabilities

- Server-authoritative player and NPC simulation at a target 60 Hz.
- Arrow-key player movement, rotation, strafing, and running.
- NPC spawning, entity collision, building collision, and heuristic road-aware wandering.
- Possession: control can transfer to an NPC within 5 metres; the prior body becomes an NPC.
- Map building selection, highlighting, and informational HUD data (area, height, estimated floors, and floorspace where available).
- DOM, Canvas, and WebGL rendering paths for players and NPCs.
- Mercator, globe, and vertical-perspective map projections.
- Local-time HUD, sprite animation, camera controls, and a performance overlay.

The project is a prototype. Territory, resources, combat, durable multiplayer identity, authentication, and production deployment are not implemented.

## Workspace Layout

```text
.
├── client/                  # Vite browser client
│   ├── src/                 # Input, networking, rendering, UI
│   └── tests/               # Playwright smoke test
├── shared/                  # Shared ECS components, models, systems, utilities
├── server/                  # Node.js WebSocket server and simulation
├── config/                  # Map style and expansion metadata
└── public/assets/           # Fonts and sprite assets
```

The root package coordinates the `client`, `shared`, and `server` workspaces. Root `dev`, `build`, `test`, and `typecheck` scripts delegate to the client workspace.

## Requirements

- Node.js 18 or newer.
- A modern browser with WebGL support.
- A local PMTiles map archive at `public/assets/maps/tiles/nj-complete.pmtiles` for the browser map.

The PMTiles archive is not included in the repository. It is required by the local map style. The server currently searches separate legacy `assets/maps/tiles/nj-complete.pmtiles` locations for building collision and road-aware NPC movement, so a single archive placement does not yet enable both client and server map features. The active map configuration covers New Jersey; see `config/expansion-packs.json`.

Terrain is remote by default when enabled. Disable `SHOW_TERRAIN` in `client/src/config.ts` for a fully local vector-map setup.

## Run Locally

Install workspace dependencies from the repository root:

```bash
npm install
```

Start the server:

```bash
npm run dev --workspace=server
```

Start the client in another terminal:

```bash
npm run dev
```

Open `http://localhost:5173`. The client connects to `ws://localhost:8080` by default. Override this with `VITE_SERVER_URL`.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys | Move |
| Left / Right arrow | Rotate |
| Shift + Left / Right arrow | Strafe |
| Double-tap Up arrow | Run |
| W / S | Zoom camera |
| A / D | Rotate camera |
| Shift + W / A / S / D | Pan camera |
| Shift + C | Toggle camera follow lock |
| Click NPC | Inspect; possess if it is within 5 m |
| Click building | Highlight it and show available building data |

## Configuration

- Client: `client/src/config.ts`
  - `PLAYER_RENDER_PATH` and `NPC_RENDER_PATH`: `dom`, `canvas`, or `webgl`.
  - `MAP_PROJECTION`: `mercator`, `globe`, or `vertical-perspective`.
  - Building, terrain, collision-bound, and performance-overlay switches.
  - `SERVER_URL`, sourced from `VITE_SERVER_URL` or `ws://localhost:8080`.
- Server: `server/src/config.ts`
  - `NPC_COUNT` defaults to `251`.
  - `NPC_SPAWN_RADIUS` defaults to `0.001` degrees.
  - `PORT` defaults to `8080` and accepts the `PORT` environment variable.

The server watches its configuration file and adjusts the NPC count when `NPC_COUNT` changes.

## Development Commands

```bash
# Client development server
npm run dev

# Client production build (output: client/dist/)
npm run build

# Server development server
npm run dev --workspace=server

# One-shot TypeScript checks
npx tsc --noEmit --project client/tsconfig.json
npm run typecheck --workspace=shared
npm run typecheck --workspace=server

# Browser smoke/performance test
npm test
```

`npm run typecheck` at the root starts the client watch-mode checker; it does not check all workspaces.

## Testing

The Playwright smoke test loads the map with 1,000 NPCs and asserts an average frame rate of at least 55 FPS. It is GPU- and environment-dependent. Run it with `npm test` after installing Playwright browser dependencies as needed.

## Deployment and Security Status

The Vite development configuration sets COOP and COEP headers for cross-origin isolation. A production host must provide equivalent headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The WebSocket server currently has no authentication, authorization, TLS/WSS setup, rate limiting, or admin authorization. The `spawn_npc` message and browser `window.spawnNpc()` helper are development tools and must not be exposed unchanged on a public server.

## Documentation

- [Architecture](docs/architecture.md)
- [Development guide](docs/development.md)
- [Roadmap](docs/roadmap.md)
- [Server guide](server/README.md)

## License

ISC
