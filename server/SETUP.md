# Server Setup Notes

## Module Resolution

The server imports shared code from the client's `src/` directory using relative paths (e.g., `../../src/ecs/world`). 

**Note**: TypeScript's type checker may show errors for these imports, but they will resolve correctly at runtime when using `tsx` or after compilation, as Node.js resolves relative paths correctly.

## Running the Server

### Development Mode
```bash
npm run dev
```

This uses `tsx` which handles TypeScript and module resolution at runtime.

### Production Build
```bash
npm run build
npm start
```

The compiled JavaScript will have the correct relative paths that Node.js can resolve.

## Architecture

The server shares the following with the client:
- ECS components (`Position`, `Rotation`, `Velocity`, `NpcTag`, `SpriteRef`, `PlayerTag`)
- ECS systems (`collisionSystem`)
- Game state model (`GameState`)
- Input types (`InputState`)
- Utilities (`SpatialGrid`)

This is intentional for Phase 1 - both server and client use the same game logic. In a future phase, we may extract shared code into a separate package.

