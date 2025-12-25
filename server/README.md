# RealEarthStreetWar Server

Authoritative game server for Real-Earth Street War. Manages all game state, NPC simulation, and client synchronization.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm (comes with Node.js)

### Installation

```bash
# From project root (installs all workspace dependencies)
npm install

# Or from server directory
cd server
npm install
```

### Development

```bash
# Start server with hot reload
cd server
npm run dev
```

Server starts on `ws://localhost:8080` (or `PORT` environment variable).

### Production

```bash
# Build TypeScript
cd server
npm run build

# Run compiled server
npm start
```

## 📁 Server Structure

```
server/src/
├── server.ts              # Entry point
├── config.ts             # Server configuration
├── game/
│   ├── GameWorld.ts     # Authoritative game state + ECS world
│   ├── GameLoop.ts      # Fixed-timestep game loop (60Hz)
│   └── systems/         # Server-side ECS systems
│       ├── movementSystem.ts
│       └── randomWalkSystem.ts
├── network/
│   ├── WebSocketServer.ts  # WebSocket handling
│   └── types.ts            # Message type definitions
└── players/
    └── PlayerManager.ts    # Player connection management
```

## ⚙️ Configuration

Edit `server/src/config.ts`:

```typescript
export const ServerConfig = {
  // NPC Spawning
  NPC_COUNT: 10,                    // Number of NPCs to spawn (hot-reloadable)
  DEFAULT_SPAWN_CENTER: {
    lng: -74.05682,                 // Default spawn longitude (NYC)
    lat: 40.69337,                  // Default spawn latitude (NYC)
  },
  NPC_SPAWN_RADIUS: 0.0001,        // Spawn radius in degrees
  
  // Server
  PORT: 8080,                       // WebSocket server port
};
```

**Hot-Reload**: The server watches `config.ts` for changes and automatically adjusts NPC count without restarting. Change `NPC_COUNT` and save - the server will spawn or remove NPCs to match the new count.

### Environment Variables

- `PORT`: Server port (default: 8080)

## 🎮 Game Loop

The server runs a **fixed-timestep game loop** at 60Hz:

1. **Time**: Advance game time
2. **Process Input**: Process player movement based on stored input state
3. **NPC AI**: Run `randomWalkSystem` (NPCs change direction)
4. **Movement**: Run `movementSystem` (apply velocity to position)
5. **Collision**: Rebuild spatial grid and run `entityCollisionSystem` (resolve collisions)

**State Broadcasting** (separate from game loop):
- Snapshots are created and broadcast at **60Hz** via `WebSocketServer.startBroadcasting()`
- Each snapshot contains all player and NPC state

## 🔌 WebSocket Protocol

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

### Message Flow

1. **Client connects** → Server assigns player ID and creates player entity
2. **Client sends input** → Server stores input in `PlayerManager` (processed every frame)
3. **Server broadcasts snapshots** → All clients receive updates (60Hz)

## 🧩 ECS Architecture

The server uses **bitecs** (Entity Component System):

### Components (from shared package)

- `Position`: Entity location (lng, lat)
- `Rotation`: Entity rotation angle
- `Velocity`: Entity velocity (x, y)
- `PlayerTag`: Marks player entities
- `NpcTag`: Marks NPC entities
- `SpriteRef`: Sprite reference for rendering

### Systems

**Server-side systems:**
- `movementSystem`: Applies velocity to position
- `randomWalkSystem`: Makes NPCs randomly change direction
- `entityCollisionSystem`: Resolves collisions (from shared)

### World Instance

The server maintains the **authoritative ECS world**:

```typescript
// server/src/game/GameWorld.ts
public readonly world = createWorld();
```

This world is the **single source of truth** for all game state.

## 📊 State Snapshots

Snapshots are created and broadcast at **60Hz** (separate interval from game loop):

```typescript
interface GameStateSnapshot {
  gameDate: string;        // ISO string
  players: PlayerSnapshot[];
  npcs: NpcSnapshot[];
}
```

Snapshots are broadcast to **all connected clients** via `WebSocketServer.startBroadcasting()`.

**Note**: The game loop runs at 60Hz for simulation, and snapshots are broadcast at 60Hz for responsive updates. This provides smooth client-side rendering with minimal latency.

## 🔧 Development

### Adding New Systems

1. **Create system file** (`server/src/game/systems/newSystem.ts`):
```typescript
import { defineQuery, IWorld } from 'bitecs';
import { Position } from '@shared/realearthstreetwar';

export function newSystem(world: IWorld): void {
  // System logic
}
```

2. **Add to GameWorld** (`server/src/game/GameWorld.ts`):
```typescript
import { newSystem } from './systems/newSystem';

fixedUpdate() {
  // ... existing systems
  newSystem(this.world);
}
```

### Adding New Message Types

1. **Update types** (`server/src/network/types.ts`):
```typescript
export type ClientMessage =
  | { type: 'new_message'; data: SomeData }
  | ...existing;
```

2. **Handle message** (`server/src/network/WebSocketServer.ts`):
```typescript
case 'new_message':
  handlers.onNewMessage?.(playerId, message.data);
  break;
```

3. **Add handler** (`server/src/server.ts`):
```typescript
onNewMessage: (playerId: string, data: SomeData) => {
  // Handle message
}
```

## 🐛 Debugging

### Console Logging

```typescript
console.log('[GameWorld] NPC count:', this.npcEntities.size);
console.log('[Server] Player connected:', playerId);
```

### Debug Helpers

**Spawn NPCs:**
```javascript
// From client browser console
window.spawnNpc(5);  // Requests server to spawn 5 NPCs
```

**Hot-Reload Config:**
- Edit `server/src/config.ts` and change `NPC_COUNT`
- Save the file - server automatically adjusts NPC count without restart
- Check server logs for confirmation

**Check Connections:**
- Server logs show player connections/disconnections
- Monitor WebSocket message frequency

### Common Issues

**Port already in use:**
- Change `PORT` in `config.ts` or environment variable
- Kill process using port 8080

**Module resolution errors:**
- Run `npm install` from project root
- Verify workspace linking: `npm list --workspaces`

**NPCs not spawning:**
- Check `NPC_COUNT` in `config.ts`
- Verify server started successfully
- Check server logs for errors

## 📈 Performance

### Optimization Tips

- **Broadcast rate**: 60Hz provides responsive updates (can be adjusted in `WebSocketServer.BROADCAST_RATE`)
- **Spatial grid**: Efficient collision detection (O(n) instead of O(n²))
- **Fixed timestep**: Deterministic simulation (60Hz)
- **Config hot-reload**: Server watches `config.ts` and automatically adjusts NPC count without restart

### Monitoring

- **Frame time**: Should be <16ms for 60Hz
- **Snapshot size**: Monitor bandwidth usage
- **NPC count**: Adjust `NPC_COUNT` based on performance

## 🚀 Deployment

### Production Build

```bash
cd server
npm run build
```

### Running Production Server

```bash
# Set environment variables
export PORT=8080

# Run compiled server
npm start
```

### Process Management

Use `pm2` or similar for production:

```bash
pm2 start dist/server.js --name game-server
pm2 logs game-server
```

## 📚 Related Documentation

- [Architecture Overview](../docs/architecture.md) - System architecture
- [Development Guide](../docs/development.md) - Contributing guide
- [Shared Package](../shared/) - Shared code documentation

## 🔗 Dependencies

- **bitecs**: ECS library
- **ws**: WebSocket server
- **@shared/realearthstreetwar**: Shared code package (workspace)

## 📄 License

ISC
