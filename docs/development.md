# Development Guide

## Setup

Requirements:

- Node.js 18 or newer.
- A WebGL-capable browser.
- `public/assets/maps/tiles/nj-complete.pmtiles` for the local browser map.

Install all workspace dependencies from the repository root:

```bash
npm install
```

Start the server and client in separate terminals:

```bash
npm run dev --workspace=server
npm run dev
```

The Vite client is served at `http://localhost:5173`; the default server URL is `ws://localhost:8080`.

## Workspaces

```text
client/   Browser client
shared/   Shared ECS data and systems
server/   Authoritative game server
```

Client source files are under `client/src`, not root `src`.

Install a dependency in the owning workspace:

```bash
npm install <package> --workspace=client
npm install <package> --workspace=server
npm install <package> --workspace=shared
```

## Commands

```bash
# Client development/build/test
npm run dev
npm run build
npm test

# Server development
npm run dev --workspace=server

# One-shot checks
npx tsc --noEmit --project client/tsconfig.json
npm run typecheck --workspace=shared
npm run typecheck --workspace=server
```

Root `npm run typecheck` runs the client watch-mode checker only. It does not verify every workspace.

At present, `npm run typecheck --workspace=server` fails because `server/src/game/systems/randomWalkSystem.ts` imports `RoadDataLoader` from `../data/RoadDataLoader` instead of the correct path from `game/systems`. Fix that code issue before treating the server check as a passing verification step.

The client build output is `client/dist/`.

## Client Structure

```text
client/src/
├── controller/      # Client coordination and interaction flow
├── debug/           # Performance overlay
├── ecs/             # Replicated client ECS world
├── input/           # Keyboard input
├── loop/            # Fixed, variable, and render loop
├── network/         # WebSocket client and snapshot application
├── view/            # Map, HUD, clicks, player/NPC renderers
└── main.ts          # Application wiring
```

Use `client/src/config.ts` to choose projections and DOM/Canvas/WebGL player/NPC render paths, and to toggle terrain, buildings, collision bounds, and the performance overlay.

## Server and Shared Code

Put data structures or systems used by both processes in `shared/src` and export them from `shared/src/index.ts`. Import them using:

```ts
import { Position } from '@shared/realearthstreetwar';
```

Server-only simulation belongs under `server/src`. New server systems are called from `GameWorld.fixedUpdate()`.

The server is authoritative. Client code may capture input, mirror snapshots, interpolate, and render, but must not become a second source of game state.

## Tests and Performance

`npm test` runs the Playwright smoke test. It requests 1,000 NPCs and requires an average frame rate of at least 55 FPS. The result depends on GPU support and browser automation capabilities.

`npm run perf --workspace=client` runs the standalone performance script; start the Vite server first.

Manual verification should cover:

- Client connects to the server and receives snapshots.
- Arrow-key movement and camera controls work.
- NPCs spawn, wander, and avoid map buildings when PMTiles data is available.
- Building and NPC selection works.
- Possession succeeds within 5 m and fails outside that range.
- Reconnection behaviour is acceptable for the prototype.

## Map Assets

The map archive expected by the style and server is:

```text
public/assets/maps/tiles/nj-complete.pmtiles
```

It is intentionally not committed. Its region metadata is in `config/expansion-packs.json`; the style is in `config/offline-map-style.json`. Without it, the browser map will not have its expected local vector source.

The server currently searches legacy `assets/maps/tiles/nj-complete.pmtiles` locations rather than `public/assets/maps/tiles/nj-complete.pmtiles`. Until those paths are aligned, provision the archive at the server's expected location as well if building collision and road-aware NPC behaviour are required.

`client/src/view/MapView.ts` currently uses a remote terrain source when terrain is enabled. Disable `SHOW_TERRAIN` for offline development.

## Debug Tools

After the map has loaded, the browser exposes:

- `window.loop`: the client loop.
- `window.state`: the client game state.
- `window.spawnNpc(count?)`: asks the server to spawn NPCs.

`spawnNpc` is a development-only helper. It currently spawns around the server's configured default center, not beside the requesting player.

## Deployment Notes

Vite development and preview set these headers for cross-origin isolation:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Provide equivalent headers in production and ensure all loaded resources satisfy CORS/CORP requirements. The application does not currently provide authentication, authorization, WSS/TLS configuration, rate limiting, or public-server security controls.
