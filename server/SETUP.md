# Server Setup Notes

The server is an npm workspace and imports common code from the existing `shared` workspace. It does not import source files from the browser client.

## Install and Run

At repository root:

```bash
npm install
npm run dev --workspace=server
```

The development command uses `tsx watch src/server.ts`, so it restarts on server or shared source changes.

## Shared Imports

Server code imports shared exports by package name:

```ts
import { Position, NpcTag } from '@shared/realearthstreetwar';
```

Shared components, game state, collision systems, and utilities live in `shared/src`. Server-specific simulation belongs in `server/src`.

## Map Data

For the server's map-derived behaviour, provide the archive at a path it searches, normally:

```text
assets/maps/tiles/nj-complete.pmtiles
```

The browser currently serves its copy from `public/assets/maps/tiles/nj-complete.pmtiles`; these paths are not yet aligned. The server can start without its archive, but disables building collision and road-aware NPC constraints when it cannot locate it.

## Type Checking and Builds

Run the server checker with:

```bash
npm run typecheck --workspace=server
```

TypeScript errors are real failures and should be fixed. Do not rely on old advice to ignore missing shared-module errors.

The current check fails because `src/game/systems/randomWalkSystem.ts` imports `RoadDataLoader` from an incorrect relative path. This is a code issue, not an expected workspace-resolution limitation.

The server build/start flow has not been established as a production deployment process. Use `tsx` development mode until ESM workspace packaging has been verified for the intended deployment environment.
