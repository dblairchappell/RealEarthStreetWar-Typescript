# Development Guide

Guide for contributing to and extending Real-Earth Street War.

## 🚀 Getting Started

### Prerequisites

- **Node.js**: 18+ with npm
- **Modern Browser**: Chrome/Edge/Firefox with WebGL support
- **Editor**: VS Code with TypeScript extension recommended

### Initial Setup

```bash
# Clone repository
git clone <repository-url>
cd RealEarthStreetWar

# Install all dependencies (workspace packages)
npm install

# Verify workspace linking
npm list --workspaces --depth=0
```

### Running Development Servers

**Terminal 1 - Start Game Server:**
```bash
cd server
npm run dev
```

**Terminal 2 - Start Client:**
```bash
# From project root
npm run dev
```

Visit `http://localhost:5173` to play!

## 📁 Workspace Structure

This project uses **npm workspaces** to manage multiple packages:

```
RealEarthStreetWar/          # Root workspace
├── package.json             # Workspace config
├── shared/                  # Shared package
│   └── package.json
├── server/                  # Server package
│   └── package.json
└── src/                     # Client (root package)
```

### Adding Dependencies

```bash
# Add to root (client)
npm install <package>

# Add to server
npm install <package> --workspace=server

# Add to shared
npm install <package> --workspace=shared
```

## 🛠️ Development Workflow

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

# Build shared (if needed)
cd shared && npm run build
```

### Hot Reload

- **Client**: Vite provides hot module replacement
- **Server**: `tsx watch` automatically restarts on file changes

## 📋 Coding Standards

### TypeScript Guidelines

- **Strict Mode**: All files use strict TypeScript checking
- **Type Safety**: Avoid `any`, prefer explicit interfaces
- **Naming**: PascalCase for classes, camelCase for variables/methods
- **Imports**: Use explicit imports from `@shared/realearthstreetwar`

**Example:**
```typescript
// Good - explicit import from shared
import { Position, Rotation, GameState } from '@shared/realearthstreetwar';

// Avoid - relative imports to old locations
import { Position } from '../model/GameState';
```

### Architecture Principles

1. **Server Authority**: All game logic runs on server
2. **Shared Code**: Use `@shared/realearthstreetwar` for common code
3. **Separation**: Client renders, server simulates
4. **Type Safety**: Shared types ensure compatibility

### File Organization

**Client (`src/`):**
```
src/
├── controller/     # Game logic coordination
├── debug/          # Debug tools (PerfOverlay)
├── view/           # Rendering and UI
│   ├── map/        # Map components (CameraController, FeatureQuery, MarkerLayer)
│   ├── CharacterView.ts      # Player sprite rendering
│   ├── NpcLayer.ts           # Canvas NPC rendering
│   ├── NpcInstancedLayer.ts  # WebGL NPC rendering
│   └── NpcController.ts      # NPC interpolation
├── network/        # WebSocket client
├── ecs/           # Client ECS world instance
├── input/         # Input handling
└── loop/          # Game loop
```

**Server (`server/src/`):**
```
server/src/
├── game/          # Game world and systems
├── network/       # WebSocket server
├── players/       # Player management
└── server.ts      # Entry point
```

**Shared (`shared/src/`):**
```
shared/src/
├── components/    # ECS components (NpcTag, SpriteRef)
├── ecs/          # ECS component definitions
├── input/        # Input types
├── model/        # Game state models
├── systems/      # ECS systems
└── utils/        # Utilities
```

## 🔧 Adding Features

### Adding a New ECS Component

1. **Define in shared** (`shared/src/ecs/components.ts`):
```typescript
export const Health = defineComponent({ value: Types.f32 });
```

2. **Export from shared** (`shared/src/index.ts`):
```typescript
export * from './ecs/components';
```

3. **Use on server**:
```typescript
import { Health } from '@shared/realearthstreetwar';
```

4. **Use on client**:
```typescript
import { Health } from '@shared/realearthstreetwar';
```

### Adding a New System

**If shared (used by both):**
1. Create `shared/src/systems/newSystem.ts`
2. Export from `shared/src/systems/index.ts`
3. Import and use on server/client

**If server-only:**
1. Create `server/src/game/systems/newSystem.ts`
2. Add to `GameWorld.fixedUpdate()`

### Adding a New Model

1. **Create in shared** (`shared/src/model/NewModel.ts`):
```typescript
export default class NewModel {
  // ...
}
```

2. **Export from shared** (`shared/src/model/index.ts`):
```typescript
export { default as NewModel } from './NewModel';
```

3. **Export from main** (`shared/src/index.ts`):
```typescript
export { NewModel } from './model';
```

4. **Use anywhere**:
```typescript
import { NewModel } from '@shared/realearthstreetwar';
```

### Adding a New Network Message

1. **Define types** (`server/src/network/types.ts` and `src/network/types.ts`):
```typescript
export type ClientMessage =
  | { type: 'new_message'; data: SomeData }
  | ...existing messages;
```

2. **Handle on server** (`server/src/network/WebSocketServer.ts`):
```typescript
case 'new_message':
  handlers.onNewMessage?.(playerId, message.data);
  break;
```

3. **Send from client** (`src/network/GameClient.ts`):
```typescript
sendNewMessage(data: SomeData): void {
  this.sendMessage({ type: 'new_message', data });
}
```

## 🐛 Debugging

### Client-Side Debugging

**Browser DevTools:**
- Console: Check for WebSocket errors
- Network: Monitor WebSocket messages
- Performance: Check frame rate

**Debug Helpers:**
```typescript
// In browser console
window.spawnNpc(5);  // Request server to spawn 5 NPCs
window.loop;         // Access game loop (pause, resume, etc.)
window.state;        // Access game state
```

**Performance Overlay:**
- Enable `SHOW_PERF_OVERLAY` in `src/config.ts` to see FPS, frame time, and CPU usage
- Enable `SHOW_COLLISION_BOUNDS` to visualize collision circles around NPCs

### Server-Side Debugging

**Console Logging:**
```typescript
console.log('[GameWorld] NPC count:', this.npcEntities.size);
```

**Debugging Tools:**
- Use `tsx watch` for automatic restarts
- Check WebSocket connection status
- Monitor snapshot frequency

### Common Issues

**"Cannot find module '@shared/realearthstreetwar'"**
- Run `npm install` to link workspaces
- Check `package.json` has `workspaces` field
- Verify `tsconfig.json` path mappings

**"Module has no default export"**
- Check shared package exports (`shared/src/index.ts`)
- Use named imports: `import { GameState } from '@shared/realearthstreetwar'`

**Server won't start**
- Check port 8080 is available
- Verify all dependencies installed
- Check server logs for errors

**Client can't connect**
- Ensure server is running first
- Check `SERVER_URL` in `src/config.ts`
- Verify WebSocket URL matches server port

## 🧪 Testing

### Manual Testing Checklist

- [ ] Client connects to server
- [ ] Player movement syncs to server
- [ ] NPCs spawn and move
- [ ] Time advances correctly
- [ ] WebSocket reconnection works
- [ ] Multiple clients can connect

### Performance Testing

**Monitor Frame Rate:**
```javascript
// In browser console
let frames = 0;
let lastTime = performance.now();
function checkFPS() {
  frames++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    console.log('FPS:', frames);
    frames = 0;
    lastTime = now;
  }
  requestAnimationFrame(checkFPS);
}
checkFPS();
```

**Monitor Network:**
- Check WebSocket message frequency (should be ~60Hz)
- Monitor snapshot size
- Check for connection drops
- Use performance overlay (`SHOW_PERF_OVERLAY` in config) for FPS monitoring

## 📝 Git Workflow

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates

### Commit Messages

```
feat: Add health component to ECS
fix: Resolve WebSocket reconnection issue
docs: Update architecture documentation
refactor: Move shared code to workspace package
```

### Pull Request Process

1. Create feature branch
2. Make changes following coding standards
3. Test thoroughly
4. Update documentation if needed
5. Submit PR with clear description

## 🚀 Deployment

### Building for Production

**Client:**
```bash
npm run build
# Output: dist/
```

**Server:**
```bash
cd server
npm run build
# Output: server/dist/
```

### Environment Variables

**Server:**
- `PORT`: Server port (default: 8080)
- Config hot-reload: Server watches `server/src/config.ts` for changes and automatically adjusts NPC count

**Client:**
- `VITE_SERVER_URL`: WebSocket server URL (default: `ws://localhost:8080`)

### Client Configuration Options

Edit `src/config.ts` for visual and debug settings:

```typescript
// Visual style
export const GTA1_STYLE_TOP_DOWN = true;   // Top-down vs 3D angled view
export const ENABLE_GLOBE = true;           // Globe projection mode
export const MAP_PROJECTION: 'mercator' | 'globe' | 'vertical-perspective' = 'mercator';

// Debug tools
export const SHOW_PERF_OVERLAY = true;      // Performance overlay
export const SHOW_COLLISION_BOUNDS = false; // Collision visualization
```

## 📚 Additional Resources

- [Architecture Overview](architecture.md) - System design details
- [Server README](../server/README.md) - Server-specific documentation
- [bitecs Documentation](https://github.com/NateTheGreatt/bitECS) - ECS library docs
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js-docs/) - Map rendering library

## 🤝 Contributing

### Code Review Checklist

- [ ] Follows TypeScript coding standards
- [ ] Uses shared package for common code
- [ ] Server-authoritative (no client-side game logic)
- [ ] Proper error handling
- [ ] Documentation updated
- [ ] Tested manually

### Questions?

- Check existing documentation
- Review code examples in similar files
- Ask in PR comments
