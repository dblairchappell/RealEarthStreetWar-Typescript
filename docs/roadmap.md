# Roadmap

## Current Baseline

The prototype already includes animated player/NPC sprites, DOM/Canvas/WebGL rendering paths, server-authoritative state snapshots, possession, building inspection, PMTiles-backed building collision, and heuristic road-aware NPC movement.

The current NPC system is not a scalable crowd simulation: road steering is heuristic, map queries are asynchronous, and performance must be measured at target population counts.

## Near-Term Priorities

1. Stabilise simulation and map integration.
   - Fix and verify server TypeScript/build paths.
   - Profile server tick duration with PMTiles road and building queries enabled.
   - Improve NPC road following, collision behaviour, and spawning placement.
   - Add deterministic tests for movement, possession, and collision rules.

2. Make the prototype operationally reliable.
   - Document and automate installation of the PMTiles archive.
   - Establish a verified production build and deployment path.
   - Add WSS/TLS deployment guidance, authentication, authorization, validation, and rate limits.
   - Replace prototype reconnect mapping with durable player/session identity.

3. Build game mechanics.
   - HQ placement and territory control.
   - Resources, jobs, influence, and NPC command mechanics.
   - Combat and consequences.
   - Persistent world/player state.

4. Scale the simulation deliberately.
   - Road-graph navigation for selected NPCs.
   - Level-of-detail updates, visibility culling, pooling, and adaptive limits.
   - Population generation informed by map/building data.
   - Performance budgets for desktop and mobile hardware.

## Success Criteria

- Server tick and snapshot performance are measured and remain stable at the intended NPC count.
- Core game actions are server-validated and covered by automated tests.
- Local map assets and production deployment can be reproduced from documentation.
- Multiplayer identity and security are suitable for the intended audience.
- Gameplay systems create meaningful progression beyond movement and possession.
